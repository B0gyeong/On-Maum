# Monitoring: Kafka 이벤트와 Web Push

## 이번 구현 범위

- `analysis.event.v1`을 수신하고 JSON 필수 값과 점수 범위를 검증한다.
- 가구별 대상자를 잠금 조회한 뒤 이벤트 ID로 중복 처리를 방지한다.
- 이벤트와 대상자의 안전 확인 알림을 같은 트랜잭션에서 저장한다.
- 저장 커밋 후 Web Push를 전송하고 별도 트랜잭션으로 발송 결과를 반영한다.
- 외출/모니터링 중지/정상 점수 이벤트는 이력만 저장한다.
- 담당자 알림 정책·대시보드 CRUD는 이번 구현 범위에 포함하지 않는다.

## 실행 설정

Kafka와 DB만 확인할 때는 `WEB_PUSH_ENABLED=false`(기본값)로 실행한다.
VAPID 키 없이 서버를 시작할 수 있다. Kafka까지 끄려면
`KAFKA_CONSUMER_ENABLED=false`를 설정한다.

실제 푸시 테스트:

| 환경변수 | 값 |
| --- | --- |
| SPRING_PROFILES_ACTIVE | local |
| WEB_PUSH_ENABLED | true |
| WEB_PUSH_VAPID_PUBLIC_KEY | 프론트 구독 시 사용한 공개키 |
| WEB_PUSH_VAPID_PRIVATE_KEY | 해당 공개키와 짝인 비밀키 |
| WEB_PUSH_SUBJECT | mailto:운영자이메일 |
| PUSH_TEST_AUTH_SUB | 기본값 test-subject-3 |

`WEB_PUSH_VAPID_SUBJECT`도 이전 설정 호환용으로 지원하며
`WEB_PUSH_SUBJECT`가 우선한다.

프론트에서 구독 등록 후 `POST /api/monitoring/push-test`를 호출한다.
요청 본문은 없다. 이 API는 local 프로필과 푸시 활성화가 모두 필요하다.
구독과 테스트 알림은 동일한 PUSH_TEST_AUTH_SUB를 사용한다.
기존 구독이 auth_sub='3'이면 PUSH_TEST_AUTH_SUB=3으로 맞출 수 있다.

## Kafka 실제 이벤트 처리

`TEST_DATA_ENABLED=true`로 실행하면 Flyway 완료 후 Kafka 수신 전에
IoT Device Service의 실제 회원가입·로그인·가구 등록 API를 호출한다.

- `subject01@nilm.local` ~ `subject10@nilm.local`: `H001` ~ `H010`을 등록하고
  `subjects.auth_sub`에 Keycloak user ID를 연결한다.
- `manager01@nilm.local` ~ `manager10@nilm.local`: 기관 담당자로 가입하고
  `managers.auth_sub`에 Keycloak user ID를 연결한다.
- 각 대상자는 같은 번호의 담당자에게 1:1로 배정된다.
- 비밀번호는 `TEST_ACCOUNT_PASSWORD`, API 주소는 `IOT_DEVICE_SERVICE_URL`로
  주입한다. 테스트 데이터가 켜져 있는데 비밀번호가 비어 있으면 시작을 실패한다.

재시작 시 기존 계정은 로그인으로 복구하고, 이미 소유한 가구와 로컬 row는
재사용한다. 같은 가구 ID나 auth_sub가 다른 사용자와 충돌하면 기존 데이터를
덮어쓰지 않고 시작을 실패한다.

- 해당 household_id를 가진 대상자가 subjects에 정확히 한 명 있어야 한다.
- 대상자 auth_sub와 브라우저 구독 auth_sub가 같아야 실제 전송된다.
- 임계치 기본값은 주의 70, 위험 90이며 RISK_WARNING_THRESHOLD,
  RISK_DANGER_THRESHOLD로 조정한다. 현재는 공통 정책을 사용한다.
- 기존 Python 계약에 없는 event_type/appliance_type은 NULL로 저장한다.
  생산자가 해당 필드를 추가하면 그대로 보존한다.
- 대상자가 등록되지 않은 가구의 이벤트는 WARN 로그(`대상자가 등록되지 않은 가구의 이벤트 건너뜀`)를
  남기고 건너뛴다. 시뮬레이터 테스트 가구 한 건이 다른 가구의 알림을 끊지 않게 하기 위함이다.
- Kafka 리스너 오류 처리(`KafkaConsumerConfig`): 계약 위반·역직렬화 실패·상태 위반은 즉시,
  그 밖의 예외는 1초 간격 2회 재시도 후 건너뛴다. 건너뛴 레코드는 원문 포함 ERROR 로그로 남아
  수동 재발행이 가능하다. 어떤 예외도 소비 컨테이너를 중지시키지 않는다.
- 리스너 컨테이너 상태는 `/actuator/health/readiness`의 `kafkaListeners` 항목에 노출된다.
  자동 시작 리스너가 멈춰 있으면 readiness가 DOWN이 되고 어느 리스너인지 details에 보인다.
  로그의 원인을 해결한 뒤 서비스를 재시작한다. 실패 메시지를 조용히 건너뛰지 않는다.
- 같은 그룹의 저장된 offset이 있으면 earliest도 그다음부터 시작한다.
- 위험 이벤트를 Kafka에서 다시 받아도 같은 ID의 알림은 추가 생성되지 않는다.

## 외출 이벤트 발행

외출 설정 API(`PUT /api/monitoring/my-dashboard/away-mode`)와 예약 발효
스케줄러가 외출 여부를 뒤집을 때 `monitoring.household-presence.v1`으로
이벤트를 발행한다. 토픽은 `KAFKA_OUTING_EVENT_TOPIC`으로 바꿀 수 있다.

| 항목 | 값 |
| --- | --- |
| Key | `household_id` |
| Value | `event_id`, `household_id`, `event_type`, `occurred_at` (UTF-8 JSON) |
| event_type | `OUTING_STARTED`, `OUTING_ENDED` |

- 예약만 걸어 둔 시점이나 외출 중 구간만 바꾼 재설정처럼 상태가 그대로면
  같은 의미의 이벤트를 다시 보내지 않는다.
- `occurred_at`은 발행 시각이 아니라 상태가 바뀐 시각이다. API로 바꾸면
  요청을 처리한 시각, 스케줄러가 발효시키면 예약된 경계 시각을 싣는다.
- DB 커밋 이후에 발행하므로 롤백된 외출이 AI로 나가지는 않는다. 반대로
  발행에 실패한 변경은 로그만 남기고 유실된다. 외출 설정 API는 실패하지
  않는다. 유실까지 막으려면 Transactional Outbox가 필요하다.
- 브로커가 죽어 있을 때 API가 오래 붙잡히지 않도록 메타데이터 대기를
  `KAFKA_PRODUCER_MAX_BLOCK_MS`(기본 3초)로 제한한다.

## Gold 생활 프로필 수신

`gold.household-profile.v1`을 별도 소비 그룹으로 받아 가구 프로필을 버전 단위로 쌓는다.
Key는 `household_id`이고 가구·버전당 메시지는 한 건이다. 이 계약은 모니터링이 소유한다.
필드 이름은 Gold 배치(`routine_baseline.py`, `statistical_profile.py`)의 산출 컬럼명을 그대로 쓴다.

```json
{
  "schema_version": 1,
  "household_id": "house-001",
  "profile_version": "<gold run_id>",
  "as_of_date": "2026-09-19",
  "window_start_date": "2026-08-23",
  "window_end_date": "2026-09-19",
  "effective_from": "2026-09-20T00:00:00+09:00",
  "published_at": "2026-09-20T03:12:40Z",
  "input_snapshot_id": "...",
  "rule_version": "gold-profile-v1",
  "statistic_rule_version": "household-statistics-v1-nearest-rank",
  "quality_status": "READY | INPUT_INCOMPLETE",
  "routine_baselines": [
    {"appliance_type": "KETTLE", "baseline_scope": "OVERALL | WEEKDAY", "weekday": null,
     "sample_days": 26, "active_days": 22, "daily_use_probability": 0.8462,
     "reliability_weight": 1.0, "first_use_time_p50_second": 30600,
     "expected_until_second": 33000, "preferred_window_start_second": 27000,
     "preferred_window_end_second": 33000, "quality_status": "READY", "enabled": true}
  ],
  "statistics": [
    {"metric_name": "CUMULATIVE_ACTIVITY_START_COUNT | INACTIVITY_ELAPSED | LOGICAL_USE_ACTIVE_DURATION | RECENT_ACTIVITY_COUNT_DELTA",
     "appliance_type": null, "weekday_group": "ALL | WEEKDAY | WEEKEND | MON..SUN",
     "time_bucket": "09:00-09:30", "sample_count": 20, "eligible_day_count": 20,
     "p50": 1.0, "p90": 3.0, "mad": 0.5, "unit": "count", "quality_status": "READY"}
  ]
}
```

수신 규칙(`HouseholdProfileService.receive`):

- 모르는 필드는 무시한다. 배치가 열을 추가해도 소비가 멈추지 않는다.
- `household_id`·`profile_version`·`as_of_date`·`effective_from`이 빠지면 경고 로그 후 건너뛴다.
  어떤 경로로도 예외를 올리지 않는다. 오류 핸들러가 건너뛰기 전 재시도를 하므로,
  결과가 바뀌지 않는 검증 실패를 예외로 올리면 같은 레코드를 헛되이 다시 읽게 된다.
- 등록되지 않은 가구는 조용히 건너뛴다.
- 같은 `(household_id, profile_version)`이 다시 오면 아무것도 하지 않는다. 발행 측은 재시도해도 된다.
- `quality_status`가 `READY`가 아니거나 기준선·통계가 모두 비어 있으면 `REJECTED`로 기록하고
  ACTIVE를 바꾸지 않는다. 사유는 `rejection_reason`에 남는다.
- 현재 ACTIVE보다 `as_of_date`가 이르거나 같으면 `SUPERSEDED`로 이력만 남긴다.
  backfill이나 늦게 도착한 구버전이 최신 프로필을 덮어쓰지 못한다.
- 그 밖에는 새 행을 ACTIVE로 올리고 기존 ACTIVE를 `SUPERSEDED`로 내린다.
  두 갱신은 `SubjectRepository.findHouseholdForUpdate`로 가구 행 락을 잡은 한 트랜잭션에서 한다.
  가구당 ACTIVE가 최대 1행이라는 불변식은 부분 유니크 인덱스(H2 미지원) 대신 이 락으로 지킨다.
- 반영이 끝나면 `subjects.state_version`을 올리고
  `SubjectStateChanged(PROFILE_UPDATED)`를 발행해 대시보드가 갱신을 알아차리게 한다.

선택 규칙(`HouseholdProfileService.resolveActive`):

- ACTIVE이면서 `effective_from <= 평가 시각`인 프로필만 돌려준다.
- 평가 시각의 KST 날짜를 D라 할 때 `as_of_date <= D-1`이어야 한다.
  배치가 넣는 `effective_from`은 배치 실행 시각이라 믿지 않고 이 규칙을 직접 검사한다.
- `app.profile.max-age-days`(기본 3)를 넘긴 프로필은 버리지 않고 `stale = true`로 표시만 한다.
  쓸지 말지는 후속 평가 로직이 정한다.
- 돌려주는 `ResolvedProfile`은 값 한 벌이다. 평가 도중 새 프로필이 도착해도 근거가 바뀌지 않는다.

`GET /api/monitoring/subjects/{subjectId}/profile`로 지금 반영된 프로필의 머리말과
가전별 OVERALL 기준선 요약을 확인한다. 권한은 기존 `SubjectAccessGuard`를 쓰고,
아직 프로필이 없으면 204로 답한다.

점수 계산·등급·알림은 이번 범위가 아니다. 후속 평가 로직은 `resolveActive` 한 메서드로
평가에 쓸 프로필을 가져간다. Gold 쪽 Kafka 발행기와 outbox도 아직 없어
현재 이 토픽에는 아무도 발행하지 않는다.

## 마이그레이션

V2는 기존 구독 테이블 생성문을 유지했다. V3는 notifications,
V4는 subjects/analysis_events를 생성한다.
V12는 Gold 생활 프로필 3개 테이블(household_profiles,
household_routine_baselines, household_profile_statistics)을 생성한다.
V16은 가전별 논리 사용(appliance_usage_episodes)을 만들고
household_observations에 관측 커버리지 칼럼을 더한다. 기존 행의 커버리지는 비어 있고,
그 상태는 0초가 아니라 "모른다"는 뜻이라 첫 스냅샷부터 다시 쌓는다.
V17은 notifications에 created_at/updated_at을 더한다. 기존 행은 응답·담당자 처리 시각이 있으면
그중 이른 값을 생성 시각으로, 늦은 값을 갱신 시각으로 채우고, 없으면 마이그레이션 시각으로 채운다.
이미 수정된 V2를 DB에 적용했거나 수동으로 같은 테이블을 만든 환경은
이력과 스키마를 먼저 확인해야 한다. 자동 repair나 데이터 삭제는 하지 않는다.

## 위험 평가의 현재 입력 계약

평가가 프로필과 맞대는 값은 Gold와 같은 뜻이어야 한다. 세 가지를 맞춰 두었다.

**비교 기준 시각.** 프로필의 시간대별 통계는 구간 **끝 시각**에서 잰 값이다
(배치의 `evaluation_epoch`). 그래서 평가는 `now` 이하의 가장 최근 30분 경계를 기준 시각으로
삼고 현재 관측값도 그 시각에서 계산한다(`EvaluationPoint`). 12:10에는 "12:30"이 아니라
"12:00"과 비교한다. 경계 정각은 그 경계에 속하고(12:30 정각부터 "12:30"), 자정 경계는
전날의 마지막 구간인 "24:00"이라 00:00~00:29에는 전날 하루치 누적과 전날 분포를 비교한다.
타이머는 1분마다 돌지만 기준 시각은 30분마다 움직인다. 구간 사이는 보간하지 않는다.

**유효 사용.** 스냅샷의 OFF→ON 전환을 그대로 세지 않는다. 가전별 병합 간격
(전기포트·전자레인지·헤어드라이어·청소기 60초, 인덕션 120초, 다리미 300초, 그 밖 60초)
안에서 다시 켜지면 한 번의 사용으로 묶고, 실제 사용시간 합계가 10초 이상일 때만 센다
(정확히 10초는 유효). 규칙과 상수는 `ValidUseContract`에 있고 배치의
`power_silver/appliance_usage.py`, `gold_profile/logical_uses.py`와 같은 값이다.
진행 중인 사용도 관측이 쌓여 10초를 넘기면 그 자리에서 유효로 확정한다.
자정을 넘겨 이어진 사용은 **시작한 날의 시작 횟수**에만 들고, 새 날에는 시작으로 세지
않으면서 "그 날 썼다"는 사실로만 남는다. 처음 본 순간 이미 켜져 있던 사용은 시작 시각을
모르므로 시작 횟수에서 뺀다(`start_imputed`).

**관측 품질.** 마지막 관측 시각만으로는 그 앞 구간을 보고 있었다고 말할 수 없다.
`household_observations`에 끊김 없는 관측의 시작(`continuous_since`)과 영업일별 실제 관측
초(`covered_seconds`)를 함께 적는다. 스냅샷 간격이 `app.risk.observation-gap-threshold`
(120초, 분석 서비스의 데이터 공백 기준과 같은 값)를 넘으면 그 사이는 보지 못한 구간이다.
하루 커버리지가 `app.risk.min-observation-coverage`(0.95, Gold가 기준선 표본으로 받아들이는
관측일의 하한과 같은 값)에 못 미치면 "오늘 한 번도 쓰지 않았다"를 확정하지 않고
루틴 미사용(M)과 활동 감소(A)를 제외한다. 무활동(I)은 경과로 세려는 구간에 공백이 있으면
제외한다. 제외는 0점이 아니다. 등급도 내지 않는다.

**통합 지점.** 위 입력은 `CurrentStateProvider.of(householdId, away, now)`가 만든다.
`RiskAssessmentService`의 `CurrentState state = currentState(subject, now);`를
`CurrentState state = currentStates.of(subject.getHouseholdId(), subject.isAwayAt(now), now);`로
바꾸면 세 지표가 모두 산다. 그 전까지 옛 경로는 관측 커버리지와 유효 사용을 확인할 수 없어
M과 A를 `USAGE_UNVERIFIED`로 제외하고 무활동만 계산한다.

## 현재 동작의 한계

응답 기한은 알림 생성 시점부터 30초이며 브라우저 표시 시각 기준이 아니다.
SENT는 한 개 이상의 푸시 서비스 접수 성공이며 사용자 열람을 뜻하지 않는다.
푸시 비활성화 중 생성한 알림을 나중에 자동 발송하지 않는다.
커밋 직후 프로세스 종료 및 전송 실패의 자동 재발송은 아직 구현하지 않았다.
푸시 실패 시 이벤트는 유지되며 일반 발송 실패는 FAILED로 기록한다.
auth_sub가 없는 대상자는 이벤트만 저장하고 알림 생성 생략 로그를 남긴다.
관측이 끊긴 동안 켜져 있던 가전의 사용시간은 공백까지 포함해 세어져 실제보다 길어진다.
그 구간은 커버리지가 낮아 M·A가 제외되고, 사용시간이 길어지는 방향은 위험을 낮추는 쪽이다.
스냅샷 계약에 분석 측 품질·커버리지 필드가 없어 모니터링은 자기가 본 것만으로 판정한다.
