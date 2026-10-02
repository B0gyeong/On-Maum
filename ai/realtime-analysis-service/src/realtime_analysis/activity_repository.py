"""가전 사용 세션과 일일 활동을 트랜잭션으로 저장한다."""

import logging
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import AbstractSet, Protocol
from zoneinfo import ZoneInfo

from sqlalchemy import Numeric, case, func, literal, select, update
from sqlalchemy.orm import Session, sessionmaker

from realtime_analysis.metrics import METRICS, AnalysisMetrics
from realtime_analysis.pipeline_timing import stage
from realtime_analysis.models import (
    AnalysisProcessingReceipt,
    AnalysisReceiptLakeOutbox,
    ApplianceUsageSession,
    HouseholdActivityDaily,
    HouseholdObservationDaily,
)
from realtime_analysis.processing_receipt import ProcessingReceipt
from realtime_analysis.schemas import (
    ApplianceState,
    ApplianceStateTransition,
    ApplianceTransitionType,
)

# SQLAlchemy 기반 저장 Repository

logger = logging.getLogger(__name__)

EXPECTED_SAMPLES_PER_DAY = 86_400
PROBABILITY_QUANTUM = Decimal("0.0001")
COVERAGE_QUANTUM = Decimal("0.0001")
# 아직 DB 행이 없는 가구·날짜의 중복 판정 기준. 어떤 실제 관측 시각보다도 이르다.
_NO_OBSERVATION_YET = datetime.min.replace(tzinfo=timezone.utc)
# flush 후 며칠 지난 가구·날짜의 메모리 기준값을 정리할지 결정한다.
_WATERMARK_RETENTION_DAYS = 2

ObservationKey = tuple[str, date]


@dataclass
class _PendingObservation:
    """아직 DB에 반영하지 않은 가구·날짜별 정상 샘플 누적값."""

    count: int
    last_observed_at: datetime


class ApplianceActivityRepository(Protocol):
    """Handler와 DB 구현을 분리하기 위한 저장소 인터페이스."""

    def record_observation(
        self,
        household_id: str,
        observed_at: datetime,
    ) -> None: ...

    def flush_observations(self) -> int: ...

    def discard_pending_observations(self, household_id: str) -> None: ...

    def record(
        self,
        household_id: str,
        observed_at: datetime,
        states: Sequence[ApplianceState],
        transitions: Sequence[ApplianceStateTransition],
        active_appliance_types: AbstractSet[str],
        processing_receipt: ProcessingReceipt | None = None,
    ) -> None: ...

    def record_processing_outcome(self, receipt: ProcessingReceipt) -> None: ...

    def close_open_sessions(
        self,
        household_id: str,
        ended_at: datetime,
    ) -> None: ...


class SqlAlchemyApplianceActivityRepository:
    """상태 변화와 세션 확률을 SQLAlchemy로 원자적으로 저장한다."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        timezone_name: str,
        expected_samples_per_day: int = EXPECTED_SAMPLES_PER_DAY,
        observation_flush_seconds: float = 0.0,
        metrics: AnalysisMetrics = METRICS,
    ) -> None:
        if expected_samples_per_day < 1:
            raise ValueError("expected_samples_per_day must be greater than zero")
        if observation_flush_seconds < 0:
            raise ValueError("observation_flush_seconds must be non-negative")
        self._session_factory = session_factory
        self._timezone = ZoneInfo(timezone_name)
        self._expected_samples_per_day = expected_samples_per_day
        self._observation_flush_seconds = observation_flush_seconds
        self._metrics = metrics
        # observation_flush_seconds > 0 이면 일일 관측 샘플 수를 메모리에 누적하고
        # flush_observations()에서 한 번에 DB에 반영한다. 0이면 메시지마다 즉시 쓴다.
        self._pending_observations: dict[ObservationKey, _PendingObservation] = {}
        # 가구·날짜별로 마지막으로 집계한 관측 시각(UTC). 재처리된 오래된 샘플을 걸러낸다.
        self._observation_watermarks: dict[ObservationKey, datetime] = {}
        # 일일 마감이 끝나 더 이상 집계하지 않는 가구·날짜.
        self._finalized_observations: set[ObservationKey] = set()

    @property
    def buffers_observations(self) -> bool:
        return self._observation_flush_seconds > 0

    @property
    def pending_observation_count(self) -> int:
        return len(self._pending_observations)

    def record_observation(
        self,
        household_id: str,
        observed_at: datetime,
    ) -> None:
        """정상 입력 한 건을 일일 샘플 수와 수집률에 반영한다."""

        observation_date = observed_at.astimezone(self._timezone).date()
        if not self.buffers_observations:
            self._record_observation_now(household_id, observation_date, observed_at)
            return
        self._accumulate_observation(household_id, observation_date, observed_at)

    def _accumulate_observation(
        self,
        household_id: str,
        observation_date: date,
        observed_at: datetime,
    ) -> None:
        key = (household_id, observation_date)
        if key in self._finalized_observations:
            return
        watermark = self._observation_watermarks.get(key)
        if watermark is None:
            # 가구·날짜를 처음 만나는 시점에만 DB를 한 번 읽어 중복 판정 기준을 가져온다.
            watermark = self._load_observation_watermark(key)
            if watermark is None:
                return
        observed_at_utc = observed_at.astimezone(timezone.utc)
        # Consumer는 가구별 메시지를 순서대로 처리한다. Snapshot 발행 후 Offset 커밋
        # 전에 재시작되어 같은 입력이 재처리되면 마지막 집계 시각 기준으로 건너뛴다.
        if observed_at_utc <= watermark:
            return
        pending = self._pending_observations.get(key)
        if pending is None:
            self._pending_observations[key] = _PendingObservation(
                count=1,
                last_observed_at=observed_at,
            )
        else:
            pending.count += 1
            pending.last_observed_at = observed_at
        self._observation_watermarks[key] = observed_at_utc
        self._metrics.set_pending_observations(len(self._pending_observations))

    def _load_observation_watermark(self, key: ObservationKey) -> datetime | None:
        """DB 행의 updated_at을 UTC로 돌려준다. 마감된 날짜면 None."""

        household_id, observation_date = key
        with self._session_factory() as session:
            row = session.execute(
                select(
                    HouseholdObservationDaily.updated_at,
                    HouseholdObservationDaily.observation_status,
                ).where(
                    HouseholdObservationDaily.household_id == household_id,
                    HouseholdObservationDaily.observation_date == observation_date,
                )
            ).one_or_none()
        if row is None:
            self._observation_watermarks[key] = _NO_OBSERVATION_YET
            return _NO_OBSERVATION_YET
        updated_at, status = row
        if status != "COLLECTING":
            self._finalized_observations.add(key)
            return None
        watermark = self._as_utc(updated_at)
        self._observation_watermarks[key] = watermark
        return watermark

    def flush_observations(self) -> int:
        """메모리에 누적한 관측 샘플 수를 한 트랜잭션으로 DB에 반영한다.

        반영한 가구·날짜 수를 돌려준다. DB 오류가 나면 누적값을 되돌려 두고
        예외를 그대로 올린다. 다음 flush에서 다시 시도한다.
        """

        if not self._pending_observations:
            return 0
        pending = self._pending_observations
        self._pending_observations = {}
        started_ns = time.perf_counter_ns()
        try:
            with self._session_factory.begin() as session:
                for key, item in pending.items():
                    self._apply_pending_observation(session, key, item)
        except Exception:
            for key, item in pending.items():
                current = self._pending_observations.get(key)
                if current is None:
                    self._pending_observations[key] = item
                else:
                    current.count += item.count
                    current.last_observed_at = max(
                        current.last_observed_at, item.last_observed_at
                    )
            self._metrics.set_pending_observations(len(self._pending_observations))
            raise
        finally:
            self._metrics.observe_stage(
                "observation_flush", time.perf_counter_ns() - started_ns
            )
        self._prune_observation_watermarks()
        self._metrics.set_pending_observations(len(self._pending_observations))
        return len(pending)

    def discard_pending_observations(self, household_id: str) -> None:
        """파티션 소유권을 잃은 가구의 누적값과 중복 판정 기준을 버린다.

        lost 파티션은 Offset이 커밋되지 않았으므로 새 소유 Consumer가 같은 입력을
        다시 집계한다. 여기서 flush하면 이중 집계가 되므로 버리는 쪽이 안전하다.
        """

        for key in [key for key in self._pending_observations if key[0] == household_id]:
            del self._pending_observations[key]
        for key in [key for key in self._observation_watermarks if key[0] == household_id]:
            del self._observation_watermarks[key]
        self._finalized_observations = {
            key for key in self._finalized_observations if key[0] != household_id
        }
        self._metrics.set_pending_observations(len(self._pending_observations))

    def _apply_pending_observation(
        self,
        session: Session,
        key: ObservationKey,
        item: _PendingObservation,
    ) -> None:
        household_id, observation_date = key
        # SELECT ... FOR UPDATE 후 UPDATE 대신 UPDATE 한 문장으로 합산한다. 왕복이 절반이고
        # 행 잠금이 statement 실행 시간만큼만 유지되어 activity_db 쓰기와의 경합이 줄어든다.
        # 중복 판정은 누적 시점에 메모리 기준값으로 끝났으므로 여기서는 합산만 한다.
        new_count = HouseholdObservationDaily.sample_count + item.count
        expected = HouseholdObservationDaily.expected_sample_count
        # numeric 리터럴을 곱해 정수 나눗셈을 피한다. PostgreSQL round(numeric, int)와
        # SQLite round(real, int) 양쪽에서 동작한다.
        one = literal(Decimal("1.0"), Numeric(12, 4))
        result = session.execute(
            update(HouseholdObservationDaily)
            .where(
                HouseholdObservationDaily.household_id == household_id,
                HouseholdObservationDaily.observation_date == observation_date,
                # 00:10 일일 마감 이후 도착한 지연 샘플은 이미 발행한 지수를 바꾸지 않는다.
                HouseholdObservationDaily.observation_status == "COLLECTING",
            )
            .values(
                sample_count=new_count,
                coverage_ratio=case(
                    (new_count >= expected, one),
                    else_=func.round(new_count * one / expected, 4),
                ),
                # 가구별 순서 처리라 누적한 마지막 관측 시각이 항상 최신이다.
                updated_at=item.last_observed_at,
            )
            .execution_options(synchronize_session=False)
        )
        if result.rowcount == 1:
            return
        status = session.scalar(
            select(HouseholdObservationDaily.observation_status).where(
                HouseholdObservationDaily.household_id == household_id,
                HouseholdObservationDaily.observation_date == observation_date,
            )
        )
        if status is None:
            session.add(
                HouseholdObservationDaily(
                    household_id=household_id,
                    observation_date=observation_date,
                    sample_count=item.count,
                    expected_sample_count=self._expected_samples_per_day,
                    coverage_ratio=self._coverage_ratio(item.count),
                    observation_status="COLLECTING",
                    updated_at=item.last_observed_at,
                )
            )
            return
        self._finalized_observations.add(key)

    def _prune_observation_watermarks(self) -> None:
        cutoff = datetime.now(self._timezone).date() - timedelta(
            days=_WATERMARK_RETENTION_DAYS
        )
        for key in [key for key in self._observation_watermarks if key[1] < cutoff]:
            del self._observation_watermarks[key]
        self._finalized_observations = {
            key for key in self._finalized_observations if key[1] >= cutoff
        }

    def _record_observation_now(
        self,
        household_id: str,
        observation_date: date,
        observed_at: datetime,
    ) -> None:
        """메시지마다 즉시 DB에 반영하는 기존 경로 (observation_flush_seconds=0)."""

        with self._session_factory.begin() as session:
            observation = session.scalar(
                select(HouseholdObservationDaily)
                .where(
                    HouseholdObservationDaily.household_id == household_id,
                    HouseholdObservationDaily.observation_date == observation_date,
                )
                .with_for_update()
            )
            if observation is None:
                observation = HouseholdObservationDaily(
                    household_id=household_id,
                    observation_date=observation_date,
                    sample_count=1,
                    expected_sample_count=self._expected_samples_per_day,
                    coverage_ratio=self._coverage_ratio(1),
                    observation_status="COLLECTING",
                    updated_at=observed_at,
                )
                session.add(observation)
                return

            # 00:10 일일 마감 이후 도착한 지연 샘플은 이미 발행한 지수를 바꾸지 않는다.
            if observation.observation_status != "COLLECTING":
                return

            # Consumer는 가구별 메시지를 순서대로 처리한다. Snapshot 발행 후 Offset 커밋
            # 전에 재시작되어 같은 입력이 재처리되면 updated_at을 기준으로 중복 집계하지 않는다.
            if not self._is_newer_than_last_update(observed_at, observation.updated_at):
                return

            observation.sample_count += 1
            observation.coverage_ratio = self._coverage_ratio(
                observation.sample_count,
                observation.expected_sample_count,
            )
            observation.updated_at = observed_at

    def record(
        self,
        household_id: str,
        observed_at: datetime,
        states: Sequence[ApplianceState],
        transitions: Sequence[ApplianceStateTransition],
        active_appliance_types: AbstractSet[str],
        processing_receipt: ProcessingReceipt | None = None,
    ) -> None:
        if not transitions and not active_appliance_types and processing_receipt is None:
            return

        state_by_appliance = {state.appliance_type: state for state in states}

        # 이 블록 안의 INSERT/UPDATE는 모두 같은 DB 트랜잭션에 포함된다.
        # 정상 종료하면 한 번에 COMMIT하고, 하나라도 실패하면 전부 ROLLBACK한다.
        with self._session_factory.begin() as session:
            attempt = 0
            if processing_receipt is not None:
                # 성공 receipt 존재 여부와 다음 attempt 번호를 한 번의 조회로 가져온다.
                succeeded, attempt = self._receipt_state(session, processing_receipt)
                if succeeded:
                    return

            with stage("activity_sessions"):
                sessions_changed = False
                # OFF → ON: 일일 관측/활동 행을 준비하고 새 사용 세션을 생성한다.
                for transition in transitions:
                    if transition.transition_type == ApplianceTransitionType.TURNED_ON:
                        self._start_session(session, transition)
                        sessions_changed = True

                # 확정 상태가 ON인 동안 열린 세션의 최대 모델 확률을 갱신한다.
                # 히스테리시스 구간이어도 확정 상태가 ON이면 이 처리에 포함된다.
                for appliance_type in active_appliance_types:
                    state = state_by_appliance.get(appliance_type)
                    if state is not None and self._update_max_probability(
                        session,
                        household_id,
                        appliance_type,
                        state.probability,
                        observed_at,
                    ):
                        sessions_changed = True

                # ON → OFF: 해당 가구·가전의 열린 세션에 종료 시각을 기록한다.
                for transition in transitions:
                    if transition.transition_type == ApplianceTransitionType.TURNED_OFF:
                        self._finish_session(session, transition)
                        sessions_changed = True

            if processing_receipt is not None:
                with stage("activity_receipt"):
                    refs: list[dict[str, object]] = []
                    # 이 트랜잭션에서 세션을 만들거나 갱신하지 않았으면 updated_at == observed_at인
                    # 세션이 있을 수 없으므로 변경 세션 조회를 생략한다 (결과는 빈 목록과 같다).
                    if sessions_changed:
                        session.flush()
                        refs = self._changed_session_refs(
                            session, household_id, observed_at
                        )
                    self._add_receipt(session, processing_receipt, refs, attempt=attempt)

    def record_processing_outcome(self, receipt: ProcessingReceipt) -> None:
        """Persist a non-success outcome and its lake outbox idempotently."""

        with self._session_factory.begin() as session:
            succeeded, attempt = self._receipt_state(session, receipt)
            if receipt.outcome.value == "SUCCEEDED" and succeeded:
                return
            self._add_receipt(session, receipt, [], attempt=attempt)

    @staticmethod
    def _receipt_state(
        session: Session,
        receipt: ProcessingReceipt,
    ) -> tuple[bool, int]:
        """같은 메시지·run의 성공 receipt 존재 여부와 다음 attempt 번호를 한 조회로 얻는다."""

        row = session.execute(
            select(
                func.coalesce(func.max(AnalysisProcessingReceipt.attempt), 0),
                func.coalesce(
                    func.max(
                        case(
                            (AnalysisProcessingReceipt.outcome == "SUCCEEDED", 1),
                            else_=0,
                        )
                    ),
                    0,
                ),
            ).where(
                AnalysisProcessingReceipt.message_id == receipt.message_id,
                AnalysisProcessingReceipt.analysis_run_id == receipt.analysis_run_id,
            )
        ).one()
        max_attempt, succeeded = row
        return bool(succeeded), int(max_attempt or 0) + 1

    @staticmethod
    def _changed_session_refs(
        session: Session,
        household_id: str,
        observed_at: datetime,
    ) -> list[dict[str, object]]:
        changed = session.scalars(
            select(ApplianceUsageSession)
            .join(
                HouseholdActivityDaily,
                HouseholdActivityDaily.id == ApplianceUsageSession.activity_daily_id,
            )
            .join(
                HouseholdObservationDaily,
                HouseholdObservationDaily.id == HouseholdActivityDaily.observation_daily_id,
            )
            .where(
                HouseholdObservationDaily.household_id == household_id,
                ApplianceUsageSession.updated_at == observed_at,
            )
        ).all()
        return [
            {"session_id": str(item.id), "session_version": int(item.lake_version)}
            for item in changed
        ]

    @staticmethod
    def _add_receipt(
        session: Session,
        receipt: ProcessingReceipt,
        session_change_refs: list[dict[str, object]],
        *,
        attempt: int | None = None,
    ) -> None:
        appliance_types = sorted(set(receipt.appliance_types))
        if attempt is None:
            attempt = int(
                session.scalar(
                    select(func.coalesce(func.max(AnalysisProcessingReceipt.attempt), 0)).where(
                        AnalysisProcessingReceipt.message_id == receipt.message_id,
                        AnalysisProcessingReceipt.analysis_run_id == receipt.analysis_run_id,
                    )
                )
                or 0
            ) + 1
        row = AnalysisProcessingReceipt(
            receipt_id=receipt.receipt_id,
            message_id=receipt.message_id,
            household_id=receipt.household_id,
            device_id=receipt.device_id,
            source_topic=receipt.source.topic,
            source_partition=receipt.source.partition,
            source_offset=receipt.source.offset,
            measured_at=receipt.measured_at,
            processed_at=receipt.processed_at,
            analysis_run_id=receipt.analysis_run_id,
            attempt=attempt,
            model_version=receipt.model_version,
            pipeline_version=receipt.pipeline_version,
            state_epoch=receipt.state_epoch,
            outcome=receipt.outcome.value,
            appliance_types=appliance_types,
            session_change_refs=session_change_refs,
            error_type=receipt.error_type,
        )
        payload = {
            "receipt_id": str(receipt.receipt_id),
            "message_id": str(receipt.message_id),
            "household_id": receipt.household_id,
            "device_id": receipt.device_id,
            "source_topic": receipt.source.topic,
            "source_partition": receipt.source.partition,
            "source_offset": receipt.source.offset,
            "measured_at": receipt.measured_at.isoformat(),
            "processed_at": receipt.processed_at.isoformat(),
            "analysis_run_id": receipt.analysis_run_id,
            "attempt": attempt,
            "model_version": receipt.model_version,
            "pipeline_version": receipt.pipeline_version,
            "state_epoch": str(receipt.state_epoch),
            "outcome": receipt.outcome.value,
            "appliance_types": appliance_types,
            "session_change_refs": session_change_refs,
            "error_type": receipt.error_type,
        }
        session.add(row)
        session.add(
            AnalysisReceiptLakeOutbox(
                receipt_id=receipt.receipt_id,
                payload=payload,
                changed_at=receipt.processed_at,
                delivery_status="PENDING",
            )
        )

    def close_open_sessions(
        self,
        household_id: str,
        ended_at: datetime,
    ) -> None:
        """Close sessions whose continuity can no longer be proven after a gap."""

        with self._session_factory.begin() as session:
            open_sessions = session.scalars(
                select(ApplianceUsageSession)
                .join(
                    HouseholdActivityDaily,
                    HouseholdActivityDaily.id
                    == ApplianceUsageSession.activity_daily_id,
                )
                .join(
                    HouseholdObservationDaily,
                    HouseholdObservationDaily.id
                    == HouseholdActivityDaily.observation_daily_id,
                )
                .where(
                    HouseholdObservationDaily.household_id == household_id,
                    ApplianceUsageSession.ended_at.is_(None),
                )
                .with_for_update()
            ).all()
            for usage_session in open_sessions:
                session_start = usage_session.started_at
                if session_start.tzinfo is None:
                    session_start = session_start.replace(tzinfo=self._timezone)
                safe_end = ended_at
                if (
                    session_start.astimezone(timezone.utc)
                    > ended_at.astimezone(timezone.utc)
                ):
                    safe_end = usage_session.started_at
                usage_session.ended_at = safe_end
                usage_session.updated_at = safe_end

    # OFF -> ON
    def _start_session(
        self,
        session: Session,
        transition: ApplianceStateTransition,
    ) -> None:
        probability = _as_probability(transition.probability)

        # 서비스 재처리 등으로 이미 열린 세션이 있으면 새 세션을 만들지 않는다.
        existing_open = self._find_open_session(
            session,
            transition.household_id,
            transition.appliance_type,
        )
        if existing_open is not None:
            self._set_max_probability(
                existing_open,
                probability,
                transition.confirmed_at,
            )
            return

        # 세션이 시작된 시각을 서비스 기준 시간대로 변환해 일일 집계 날짜를 정한다.
        activity_date = transition.occurred_at.astimezone(self._timezone).date()
        observation = self._get_or_create_observation(
            session,
            transition.household_id,
            activity_date,
            transition.confirmed_at,
        )
        if observation.observation_status != "COLLECTING":
            return
        activity = self._get_or_create_activity(
            session,
            observation,
            transition.appliance_type,
            transition.confirmed_at,
        )

        # 동일한 세션 시작 이벤트가 Kafka에서 다시 전달돼도 중복 INSERT하지 않는다.
        existing = session.scalar(
            select(ApplianceUsageSession).where(
                ApplianceUsageSession.activity_daily_id == activity.id,
                ApplianceUsageSession.started_at == transition.occurred_at,
            )
        )
        if existing is not None:
            self._set_max_probability(
                existing,
                probability,
                transition.confirmed_at,
            )
            return

        usage_session = ApplianceUsageSession(
            activity_daily_id=activity.id,
            started_at=transition.occurred_at,
            ended_at=None,
            max_probability=probability,
            decision_threshold=_as_probability(transition.threshold),
            updated_at=transition.confirmed_at,
        )
        session.add(usage_session)
        session.flush()

        # 세션 INSERT가 성공한 경우에만 사용 횟수를 증가시킨다.
        # 아래 변경도 같은 트랜잭션이므로 이후 오류가 나면 세션과 함께 롤백된다.
        activity.event_count += 1
        activity.updated_at = transition.confirmed_at

    # ON 유지
    def _update_max_probability(
        self,
        session: Session,
        household_id: str,
        appliance_type: str,
        probability: float,
        observed_at: datetime,
    ) -> bool:
        """열린 세션의 max_probability를 갱신하고 실제로 값이 바뀌었는지 돌려준다."""

        usage_session = self._find_open_session(
            session,
            household_id,
            appliance_type,
        )
        # 열린 세션이 없으면 갱신할 대상이 없으므로 아무 작업도 하지 않는다.
        if usage_session is None:
            return False
        return self._set_max_probability(
            usage_session,
            _as_probability(probability),
            observed_at,
        )

    # ON -> OFF
    def _finish_session(
        self,
        session: Session,
        transition: ApplianceStateTransition,
    ) -> None:
        usage_session = self._find_open_session(
            session,
            transition.household_id,
            transition.appliance_type,
        )
        if usage_session is None:
            return

        # 연속 OFF 판정이 시작된 시각을 실제 사용 종료 시각으로 저장한다.
        usage_session.ended_at = transition.occurred_at
        usage_session.updated_at = transition.confirmed_at

    def _get_or_create_observation(
        self,
        session: Session,
        household_id: str,
        activity_date: date,
        updated_at: datetime,
    ) -> HouseholdObservationDaily:
        # 가구와 날짜의 UNIQUE 조건을 기준으로 기존 일일 관측 행을 조회한다.
        observation = session.scalar(
            select(HouseholdObservationDaily).where(
                HouseholdObservationDaily.household_id == household_id,
                HouseholdObservationDaily.observation_date == activity_date,
            )
        )
        if observation is not None:
            return observation

        # 정상 Handler 흐름에서는 record_observation이 먼저 부모 행을 만든다.
        # 직접 세션 저장을 호출하는 복구 경로를 위해 여기서도 부모 행 생성을 보장한다.
        observation = HouseholdObservationDaily(
            household_id=household_id,
            observation_date=activity_date,
            sample_count=0,
            expected_sample_count=self._expected_samples_per_day,
            coverage_ratio=Decimal("0.0000"),
            observation_status="COLLECTING",
            updated_at=updated_at,
        )
        session.add(observation)
        session.flush()
        return observation

    def _coverage_ratio(
        self,
        sample_count: int,
        expected_sample_count: int | None = None,
    ) -> Decimal:
        expected = expected_sample_count or self._expected_samples_per_day
        ratio = Decimal(sample_count) / Decimal(expected)
        return min(Decimal("1.0000"), ratio.quantize(COVERAGE_QUANTUM))

    def _is_newer_than_last_update(
        self,
        observed_at: datetime,
        updated_at: datetime,
    ) -> bool:
        return observed_at.astimezone(timezone.utc) > self._as_utc(updated_at)

    def _as_utc(self, value: datetime) -> datetime:
        # SQLite 등 tz 정보를 잃는 저장소에서 읽은 값은 서비스 타임존으로 간주한다.
        if value.tzinfo is None:
            value = value.replace(tzinfo=self._timezone)
        return value.astimezone(timezone.utc)

    @staticmethod
    def _get_or_create_activity(
        session: Session,
        observation: HouseholdObservationDaily,
        appliance_type: str,
        updated_at: datetime,
    ) -> HouseholdActivityDaily:
        # 같은 일일 관측 결과와 가전 조합은 하나의 활동 행만 사용한다.
        activity = session.scalar(
            select(HouseholdActivityDaily).where(
                HouseholdActivityDaily.observation_daily_id == observation.id,
                HouseholdActivityDaily.appliance_type == appliance_type,
            )
        )
        if activity is not None:
            return activity

        activity = HouseholdActivityDaily(
            observation_daily_id=observation.id,
            appliance_type=appliance_type,
            event_count=0,
            updated_at=updated_at,
        )
        session.add(activity)
        session.flush()
        return activity

    @staticmethod
    def _find_open_session(
        session: Session,
        household_id: str,
        appliance_type: str,
    ) -> ApplianceUsageSession | None:
        # 부모 테이블을 JOIN해 가구·가전 기준의 종료되지 않은 세션을 찾는다.
        # FOR UPDATE로 조회해 현재 트랜잭션이 끝날 때까지 갱신 대상을 잠근다.
        return session.scalar(
            select(ApplianceUsageSession)
            .join(
                HouseholdActivityDaily,
                HouseholdActivityDaily.id
                == ApplianceUsageSession.activity_daily_id,
            )
            .join(
                HouseholdObservationDaily,
                HouseholdObservationDaily.id
                == HouseholdActivityDaily.observation_daily_id,
            )
            .where(
                HouseholdObservationDaily.household_id == household_id,
                HouseholdActivityDaily.appliance_type == appliance_type,
                ApplianceUsageSession.ended_at.is_(None),
            )
            .order_by(ApplianceUsageSession.started_at.desc())
            .with_for_update()
        )

    @staticmethod
    def _set_max_probability(
        usage_session: ApplianceUsageSession,
        probability: Decimal,
        updated_at: datetime,
    ) -> bool:
        # max_probability이므로 기존 값보다 큰 확률만 저장한다.
        if probability > usage_session.max_probability:
            usage_session.max_probability = probability
            usage_session.updated_at = updated_at
            return True
        return False


def _as_probability(value: float) -> Decimal:
    # DB의 NUMERIC(5, 4)에 맞춰 부동소수점 값을 소수점 넷째 자리로 변환한다.
    return Decimal(str(value)).quantize(PROBABILITY_QUANTUM)
