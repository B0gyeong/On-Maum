# 메시지당 처리 시간 단축 전후 측정

> 작성일: 2026-09-27 (10-01 D·E 단계 추가)  
> 작성자: 최보경  
> 대상 서비스: `ai/realtime-analysis-service`  
> 브랜치: `feature/ai/consumer-latency-tuning`  
> 환경: 로컬 Docker Compose(Windows 노트북, Docker Desktop), Kafka 24 partitions, cooperative-sticky, Prometheus, 실제 모델 모드, 입력 윈도우 255  
> 데이터: `load-test-results/20260926-203113` ~ `20261001-153618` (유효 15개 런, 무효 3개 런 제외)

## 1. 작업 목적

`20260924_Consumer_부하_한계_탐색_및_다음_단계.md` 7.1절에서 Consumer 수를 늘리는 대신
메시지당 직렬 처리 시간(약 60ms)을 줄이는 방향으로 전환했다. 이 문서는 그 작업을
A(개선 전) → B·C(observation_db 배치 flush) → D(activity_db 왕복 감소 + 정책 평가 주기
드리프트 교정) → E(새 한계 탐색) 순서로 기록한다. 첫 번째 대상은 `observation_db` 단계였다. 이 단계는 메시지 1건마다 `household_observation_daily`
행을 `SELECT ... FOR UPDATE`로 잠그고 `sample_count`를 1 올린 뒤 커밋하는 구조였다.
값 자체는 "오늘 몇 건 들어왔는가"라는 카운트라 실시간으로 DB에 있을 필요가 없다.

측정 목표는 다음 두 가지다.

- `observation_db` 단계를 크리티컬 패스에서 제거했을 때 단계별 p95와 메시지당 직렬 합계가
  얼마나 줄어드는지
- 그 결과 Consumer 1개의 처리 상한(msg/s)이 얼마나 올라가는지

판정 기준은 "1 Consumer × 20가구가 안정으로 바뀌는가"가 아니다. 개선 전 직렬 합계가
약 61ms이고 `observation_db`는 그중 5.4ms(9%)뿐이므로, 이 개선만으로는 20 msg/s를
넘길 수 없다는 것을 시작 전에 계산으로 확인했다. 따라서 단계별 p95와 `1000 / 직렬 합계`로
계산한 처리 상한을 기준으로 전후를 비교한다.

## 2. 변경 내용

### 2.1 인메모리 누적과 주기 flush

`SqlAlchemyApplianceActivityRepository`에 `observation_flush_seconds`를 추가했다.

| 값 | 동작 |
| --- | --- |
| `0` | 기존과 같이 메시지마다 즉시 DB에 쓴다 (`_record_observation_now`) |
| `> 0` | `(가구, 날짜) -> {count, last_observed_at}` 딕셔너리에 누적하고 `flush_observations()`에서 한 트랜잭션으로 반영한다 |

설정은 `ANALYSIS_OBSERVATION_FLUSH_SECONDS`(기본 5초)이며 `infrastructure/local/compose.yaml`과
`.env.example`에 반영했다. 같은 이미지에서 환경변수만 바꿔 전후를 비교할 수 있다.

flush는 Consumer 루프에서 다음 시점에 호출한다.

| 시점 | 동작 | 이유 |
| --- | --- | --- |
| poll 루프, `observation_flush_seconds` 주기 | flush | 정상 경로. 실패하면 예외가 루프를 벗어나 프로세스가 재시작된다 |
| `on_revoke` | reset 전에 flush | cooperative revoke에서는 librdkafka가 저장된 Offset을 커밋하므로 반납 전에 DB에 남겨야 새 소유 Consumer와 이어진다 |
| `on_lost` | flush하지 않고 해당 가구 누적값을 버림 | lost는 Offset 커밋이 보장되지 않아 새 소유 Consumer가 같은 입력을 다시 집계한다. flush하면 이중 집계가 된다 |
| 종료(`consumer.close()` 전) | flush | close가 Offset을 커밋하기 전에 반영 |

revoke와 종료 경로의 flush 실패는 로그만 남기고 Consumer를 멈추지 않는다.

### 2.2 중복 판정

기존에는 DB의 `updated_at`보다 오래된 샘플을 건너뛰어 재처리 중복을 막았다. 누적 시점에는
DB를 읽지 않으므로 다음과 같이 바꿨다.

- 가구·날짜를 처음 만날 때 한 번만 DB에서 `updated_at`과 `observation_status`를 읽어
  메모리 기준값(watermark)으로 캐시한다. 가구당 하루 1회 SELECT다.
- 이후 샘플은 메모리 기준값과 비교해 같거나 오래되면 건너뛴다. Consumer는 가구별 메시지를
  순서대로 처리하고 파티션은 한 Consumer만 소유하므로 메모리 비교로 충분하다.
- 마감된 날짜(`observation_status != COLLECTING`)는 별도 집합에 넣어 이후 샘플을 무시한다.
- `reset_household()`가 호출되면 해당 가구의 누적값과 기준값을 모두 버린다. 파티션을 다시
  받으면 DB에서 새로 읽는다.

### 2.3 flush 문장: SELECT FOR UPDATE 제거

1차 구현은 flush에서도 행마다 `SELECT ... FOR UPDATE` 후 UPDATE를 수행했다. 측정 결과
`activity_db` p95가 30.6ms에서 39.6ms로 벌어져 `household_observation_daily` 행 잠금이
`record()`의 `_get_or_create_observation` 조회와 경합한다고 판단했다.

2차 구현은 행마다 UPDATE 한 문장으로 합산한다.

```sql
UPDATE household_observation_daily
   SET sample_count   = sample_count + :n,
       coverage_ratio = CASE WHEN sample_count + :n >= expected_sample_count THEN 1.0
                             ELSE round((sample_count + :n) * 1.0 / expected_sample_count, 4) END,
       updated_at     = :last_observed_at
 WHERE household_id = :h AND observation_date = :d AND observation_status = 'COLLECTING'
```

`rowcount = 0`일 때만 행이 없는지(INSERT) 마감된 것인지(무시) 구분하는 SELECT를 한 번 한다.
정수 나눗셈을 피하기 위해 numeric 리터럴 `1.0`을 곱했고, PostgreSQL `round(numeric, int)`와
SQLite `round(real, int)` 양쪽에서 동작한다.

### 2.4 관측과 테스트

- 메트릭: `nilm_analysis_observation_pending_households` 게이지, stage `observation_flush`
  히스토그램 추가. `observation_db` stage 이름은 전후 비교를 위해 유지했다.
- `consumer_load_test.py`의 `IMPORTANT_STAGES`에 `observation_flush` 추가.
- 테스트 추가 (전체 `200 passed, 32 skipped`):
  - 저장소: flush 전 DB 미기록, 기존 행 합산과 재처리 샘플 skip, 마감일 무시, flush 실패 시
    누적값 보존 후 재시도, discard 후 DB 기준값 재로드, 상한 미만 coverage 갱신, 즉시 모드
  - Consumer: revoke가 reset보다 먼저 flush, flush 실패에도 revoke 진행, lost는 flush 안 함,
    주기 flush와 종료 flush, `0`이면 주기 flush 없음
- SQLite 외에 PostgreSQL 16에서 UPDATE 경로(1+2 → 0.7500), INSERT 경로, 상한 cap(5/4 → 1.0000),
  마감 행 skip, 8,641/86,400 → 0.1000 반올림을 직접 확인했다.

### 2.5 activity_db: 결과가 같은 왕복 두 개 제거 (D 단계)

`record()`는 추론된 메시지마다 한 트랜잭션에서 다음을 수행했다.

```text
SELECT 성공 receipt 존재 확인
(활성 가전마다) SELECT 열린 세션 FOR UPDATE → max_probability UPDATE
SELECT 변경된 세션 (updated_at == observed_at, 3테이블 JOIN)
SELECT max(attempt)
INSERT receipt, INSERT lake outbox
COMMIT
```

다음 두 가지를 바꿨다. 결과는 바뀌지 않는다.

- 성공 receipt 존재 확인과 `max(attempt)` 조회를 `_receipt_state()` 한 쿼리
  (`max(attempt)`, `max(CASE outcome='SUCCEEDED')`)로 합쳤다.
- 이 트랜잭션에서 세션을 만들거나 갱신하지 않은 메시지는 변경 세션 조회를 건너뛴다.
  `updated_at == observed_at`인 세션은 이 트랜잭션에서만 생기므로 결과는 빈 목록과 같다.
  이를 위해 `_update_max_probability()`/`_set_max_probability()`가 실제 변경 여부를 돌려준다.

대부분의 메시지(전이 없음, 확률 미상승)는 SELECT 3 + INSERT 2 + COMMIT에서
SELECT 1 + INSERT 2 + COMMIT으로 줄어든다. 계측을 위해 `activity_db` 아래에
`activity_sessions`(전이·확률 갱신)와 `activity_receipt`(receipt·outbox INSERT) 하위 stage를,
`anomaly_detection` 아래에 `anomaly_baselines`(기준선 조회)와 `anomaly_evaluate`(패턴 평가)
하위 stage를 추가했다. 부모 stage 이름은 유지해 전후 비교가 가능하다.

### 2.6 위험 이벤트 평가 주기 드리프트 발견과 교정 (D 단계)

하위 stage 계측 결과 `anomaly_evaluate`가 평균 12ms, p95 24ms로 **거의 모든 메시지**에서
DB를 치고 있었다. 코드상 `RealtimeAnomalyDetector._is_due()`는 정책의
`evaluation_interval_seconds` 최솟값(기본 60초)마다 가구별로 한 번만 평가해야 한다.

로컬 DB의 `analysis_policy`를 확인한 결과 두 정책의 값이 1이었다.

```text
PROLONGED_INACTIVITY_DEFAULT     evaluation_interval_seconds: 1   (JSON 기본값 60)
PROLONGED_APPLIANCE_USE_DEFAULT  evaluation_interval_seconds: 1   (JSON 기본값 60)
```

`inactivity_hours 0.0167`(1분)과 `limits_minutes 2`는 9/21 마이그레이션으로 반영된 시연용
값이지만, `evaluation_interval_seconds: 1`은 마이그레이션에도 `config/analysis_policies.json`에도
없는 값이다. 시연 테스트 중 DB에 직접 넣은 값이 `seed_missing()`(없는 정책만 삽입)에 잡히지
않아 계속 남아 있었고, 게이트가 최솟값을 쓰므로 1Hz 입력에서 모든 메시지가 평가 경로를 탔다.

이 값은 **9/21 이후 모든 부하 측정에 약 10~12ms씩 포함**돼 있었다. 즉 `20260924` 문서의
"메시지당 약 60ms, Consumer당 12~15 msg/s"는 시연 설정이 섞인 값이다.

교정과 재발 방지:

- 로컬 DB 두 행을 JSON 기본값 60으로 되돌렸다 (`jsonb_set`). 정책은 시작 시에만 로드되므로
  컨테이너를 recreate했다.
- `RealtimeAnomalyDetector.log_evaluation_intervals()`를 추가해 시작 시 실제 적용되는 평가
  주기를 로그로 남기고, 60초 미만이면 WARNING으로 기록한다. `__main__`에서 detector 생성 직후
  호출한다.
- 이 교정은 코드 개선이 아니라 측정 환경 교정이므로 4·5절에서 코드 개선 효과와 분리해 적는다.

### 2.7 MODEL_THREADS 실험 (채택하지 않음)

`inference` 26ms를 설정만으로 줄일 수 있는지 `ANALYSIS_MODEL_THREADS`를 1 → 2 → 4로 바꿔
측정했다(C 단계 코드, 1 Consumer × 20가구, seed 42). 결과는 4.4절. 2는 inference만 16% 줄고
DB 단계가 그만큼 느려져 합계가 같았고, 4는 모든 단계가 두 배 느려졌다. 같은 노트북에서
PostgreSQL·Kafka·Prometheus가 함께 돌아 CPU를 나눠 쓰는 환경이라 스레드 병렬화는 제로섬이다.
`20260924` 문서의 4→5 Consumer 스레드 경합과 같은 현상이며, 설정은 1로 유지한다.

## 3. 측정 조건

| 항목 | 값 |
| --- | --- |
| Consumer | 1개 (매 런 `--force-recreate`로 메모리 상태 초기화) |
| 입력 | 20가구 × 1Hz = 20 msg/s, `random` 시나리오 |
| seed | 42, 43 (각 단계 2회) |
| 안정 구간 측정 | 600초 |
| 모델 입력 윈도우 | 255 |
| 명령 | `python tools\consumer_load_test.py --consumers 1 --houses 20 --hz 1 --duration 600 --model-window-size 255 --seed {42,43}` |

세 단계를 같은 조건으로 측정했다.

| 단계 | 코드 | 런 |
| --- | --- | --- |
| A. 개선 전 | `develop` (메시지마다 즉시 쓰기) | `20260926-203113`, `20260926-211547` |
| B. 1차 | 누적 + flush(SELECT FOR UPDATE + UPDATE) | `20260926-235901`, `20260927-003100` |
| C. 2차 | 누적 + flush(UPDATE 단문) | `20260927-013758`, `20260927-022713` |
| C-T2 / C-T4 | C 코드 + `MODEL_THREADS` 2 / 4 (실험, 미채택) | `20260930-093012`, `20260930-100056` |
| D-1 | C + activity_db 왕복 감소 + 하위 stage 계측 (정책 드리프트 교정 전) | `20260930-140252` |
| D. 최종 | D-1 + 정책 평가 주기 60초로 교정 | `20260930-160049`, `20260930-163734` |
| E. 새 한계 탐색 | D 코드, **1 Consumer × 23가구** (23 msg/s) | `20260930-172317` |
| F. 경계·확장 확인 | D 코드, 1 Consumer × 22가구 / **2 Consumers × 40가구** | `20261001-140356`, `20261001-091402` |
| (무효) | 호스트 스로틀링으로 제외 — 아래 유효 런 판정 참고 | `20261001-095918`, `20261001-104059`, `20261001-153618` |

**유효 런 판정 기준.** `inference`는 DB를 타지 않는 순수 CPU 단계라 입력량·코드 변경과 무관하게
일정해야 한다. D 코드 기준 avg 25.5~28.4ms가 정상 범위다. 10/1의 세 런은 코드·설정이 같은데
inference avg 37.7~41.0ms(1.5배), activity_db·flush도 같은 비율로 느려졌고 모두 **직전 런 직후에
연달아 실행**한 것이었다. 노트북 발열 스로틀링으로 판단해 제외했으며, 이후 연속 측정은 런 사이에
10분 이상 간격을 둔다. 측정 중에는 파이프라인과 무관한 SonarQube 컨테이너를 내렸다.

주의: `--skip-build`로 기존 컨테이너를 재사용하면 이전 런에서 warm-up을 못 끝낸 가구가
`_warming_households`에 남아 `warmup_households`가 0이 되지 않고 warm-up 판정이 타임아웃까지
끝나지 않는다. 런마다 컨테이너를 recreate해야 한다 (5.3절 도구 보완 항목).

## 4. 결과

### 4.1 런별 단계 지연 (avg / p95, ms)

| 런 | 단계 | seed | observation_db | inference | activity_db | anomaly_detection | snapshot_publish_ack | observation_flush |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20260926-203113 | A | 42 | 5.45 / 9.69 | 26.20 / 47.79 | 17.19 / 32.53 | 11.99 / 24.25 | 1.02 / 4.43 | — |
| 20260926-211547 | A | 43 | 5.42 / 9.63 | 25.85 / 47.50 | 16.77 / 28.72 | 11.93 / 24.07 | 0.99 / 4.38 | — |
| 20260926-235901 | B | 42 | 0.02 / 0.10 | 27.28 / 48.98 | 18.48 / 40.30 | 11.83 / 24.38 | 1.07 / 4.53 | 25.86 / 50.00 |
| 20260927-003100 | B | 43 | 0.02 / 0.10 | 26.65 / 48.38 | 18.07 / 38.95 | 11.82 / 24.29 | 1.06 / 4.47 | 23.97 / 47.62 |
| 20260927-013758 | C | 42 | 0.02 / 0.10 | 26.16 / 47.93 | 17.38 / 35.43 | 11.06 / 23.87 | 0.99 / 4.31 | 30.25 / 57.50 |
| 20260927-022713 | C | 43 | 0.02 / 0.10 | 26.15 / 47.89 | 17.23 / 34.40 | 11.34 / 24.04 | 0.99 / 4.32 | 30.54 / 56.79 |
| 20260930-140252 | D-1 | 42 | 0.02 / 0.10 | 25.59 / 47.37 | 15.15 / 27.11 | 12.22 / 24.32 | 1.00 / 4.36 | 29.68 / 49.34 |
| 20260930-160049 | D | 42 | 0.02 / 0.10 | 27.76 / 48.84 | 13.99 / 24.97 | **0.30 / 0.38** | 1.04 / 4.44 | 34.91 / 75.21 |
| 20260930-163734 | D | 43 | 0.02 / 0.10 | 27.79 / 49.16 | 13.62 / 24.88 | **0.31 / 0.39** | 1.04 / 4.44 | 33.20 / 72.50 |
| 20260930-172317 | E (23가구) | 42 | 0.02 / 0.10 | 28.37 / 49.19 | 14.30 / 25.47 | 0.31 / 0.40 | 1.12 / 4.61 | 39.34 / 86.07 |
| 20261001-140356 | F (22가구) | 42 | 0.02 / 0.10 | 25.55 / 47.33 | 12.63 / 24.46 | 0.27 / 0.35 | 1.0 / 4.4 | 33.80 / 73.86 |
| 20261001-091402 | F (2 × 40가구) | 42 | 0.02 / 0.10 | 26.20 / 47.73 | 13.94 / 24.88 | 0.27 / 0.33 | 1.0 / 4.4 | 34.02 / 78.70 |

D 단계 하위 stage (avg / p95, ms): `activity_sessions` 5.18 / 15.60 · 5.07 / 15.13,
`activity_receipt` 1.11 / 4.68 · 1.00 / 4.56, `anomaly_baselines` 0.01 / 0.10,
`anomaly_evaluate` 0.27 · 0.28. `activity_db` 나머지 약 7.6ms는 receipt 조회와 COMMIT이다.

`observation_flush`는 5초마다 1회 실행되므로 메시지당 직렬 합계에는 포함하지 않는다.
p95가 50.00, 57.50처럼 버킷 경계값으로 찍힌 것은 히스토그램 버킷(0.05s, 0.1s) 때문이므로
avg를 기준으로 해석한다.

### 4.2 런별 처리량과 lag

| 런 | 단계 | 직렬 합계 avg | 처리 상한 (1000/합계) | Throughput avg | Throughput peak | Lag 측정 시작 → max | Lag 회복 | E2E p95 | CPU | RSS |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 20260926-203113 | A | 61.85ms | 16.17 msg/s | 15.94 | 16.55 | 142 → 2,570 | 163.3s | 201.6s | 0.69 | 315 MiB |
| 20260926-211547 | A | 60.96ms | 16.40 msg/s | 16.19 | 16.93 | 127 → 2,389 | 163.3s | 115.4s | 0.69 | 315 MiB |
| 20260926-235901 | B | 58.68ms | 17.04 msg/s | 16.73 | 18.52 | 144 → 2,073 | 133.2s | 114.0s | 0.72 | 313 MiB |
| 20260927-003100 | B | 57.61ms | 17.36 msg/s | 17.05 | 18.35 | 47 → 1,815 | 118.2s | 112.7s | 0.72 | 311 MiB |
| 20260927-013758 | C | 55.61ms | 17.98 msg/s | 17.62 | 18.83 | 117 → 1,521 | 103.2s | 108.2s | 0.72 | 311 MiB |
| 20260927-022713 | C | 55.72ms | 17.95 msg/s | 17.61 | 18.17 | 69 → 1,481 | 103.2s | 107.2s | 0.72 | 312 MiB |
| 20260930-140252 | D-1 | 53.98ms | 18.52 msg/s | 18.05 | 18.79 | 111 → 1,265 | 88.1s | 88.0s | 0.73 | 314 MiB |
| 20260930-160049 | D | **43.11ms** | **23.19 msg/s** | **19.91** | 20.23 | **18 → 31 → 0** | 13.0s | **1.23s** | 0.74 | 312 MiB |
| 20260930-163734 | D | **42.78ms** | **23.37 msg/s** | **19.91** | 20.15 | **16 → 19 → 15** | 13.0s | **1.01s** | 0.74 | 312 MiB |
| 20260930-172317 | E (23 msg/s) | 44.13ms | 22.66 msg/s | 21.58 | 24.10 | 31 → 841 | — | 48.9s | 0.83 | 313 MiB |
| 20261001-140356 | F (22 msg/s) | 39.41ms | 25.38 msg/s | **21.91** | 22.69 | **17 → 23 → 11** | 13.0s | **2.08s** | 0.76 | 314 MiB |
| 20261001-091402 | F (2 × 40 msg/s) | 41.45ms (Consumer당) | 24.13 (Consumer당) | **39.71** | 41.71 | **6 → 95 → 15** | 13.0s | **2.70s** | 1.44 | 622 MiB |

D 단계 두 런은 처리량 19.91 msg/s가 입력 20 msg/s와 같고 lag가 측정 구간 내에서 0~31에
머물러 **처음으로 1 Consumer × 20가구가 안정**으로 판정된다. `consumer_poll` 평균이
0.02ms에서 5.5~5.8ms로 늘어난 것은 메시지를 기다리는 시간이 생겼다는 뜻으로 약 20%의 여유를
나타낸다. D 단계의 Errors 1·12건은 `e2e:ClockSkew`로, `20260921` 문서에서 다룬 Windows 호스트와
Docker VM의 시계 차이로 E2E가 음수로 잡힌 측정 아티팩트다. lag가 거의 0이 되어 E2E가
밀리초 단위로 내려가면서 드러난 것이며 처리 오류·DLQ는 0이다.

모든 런에서 Errors(ClockSkew 제외), DLQ, `household_state_resets`, `lost`는 0이었다. 직렬 합계는
`observation_db + inference + activity_db + anomaly_detection + snapshot_publish_ack`의 avg 합이다.

### 4.3 단계별 평균 요약 (seed 42·43 평균, 1 Consumer × 20가구)

| 지표 | A 개선 전 | B 1차 | C 2차 | D 최종 | A → D |
| --- | ---: | ---: | ---: | ---: | ---: |
| observation_db avg / p95 | 5.44 / 9.66 ms | 0.02 / 0.10 | 0.02 / 0.10 | 0.02 / 0.10 | −99.6% |
| activity_db avg / p95 | 16.98 / 30.6 | 18.28 / 39.6 | 17.31 / 34.9 | 13.81 / 24.9 | −3.2ms (−19%) |
| inference avg | 26.0 | 27.0 | 26.2 | 27.8 | 노이즈 범위 |
| anomaly_detection avg / p95 | 11.96 / 24.2 | 11.83 / 24.3 | 11.20 / 24.0 | 0.31 / 0.39 | −11.7ms (환경 교정) |
| 메시지당 직렬 합계 | 61.4ms | 58.1ms | 55.7ms | **42.9ms** | **−18.5ms (−30%)** |
| 처리 상한 | 16.3 msg/s | 17.2 | 18.0 | **23.3 msg/s** | **+43%** |
| 실측 Throughput avg | 16.07 | 16.89 | 17.62 | **19.91 (= 입력)** | 안정 |
| max lag (600초) | 2,480 | 1,944 | 1,501 | **25** | −99% |
| E2E p95 | 158s | 113s | 108s | **1.12s** | — |
| observation_flush avg (5초당 1회) | — | 24.9ms | 30.4ms | 34.1ms | 초당 약 7ms |

A → D의 −18.5ms 중 코드 개선은 observation_db 5.4ms + activity_db 3.2ms ≈ **8.6ms(−14%)**,
측정 환경 교정(정책 평가 주기)은 **11.7ms**다. 두 값은 성질이 다르므로 발표와 문서에서 분리한다.

### 4.4 MODEL_THREADS 실험 (C 코드, seed 42)

| 지표 | THREADS=1 (`20260927-013758`) | THREADS=2 (`20260930-093012`) | THREADS=4 (`20260930-100056`) |
| --- | ---: | ---: | ---: |
| inference avg / p95 | 26.2 / 47.9 ms | 21.9 / 44.6 | 36.4 / 91.8 |
| activity_db avg / p95 | 17.4 / 35.4 | 19.1 / 41.8 | 35.1 / 88.5 |
| anomaly_detection avg / p95 | 11.1 / 23.9 | 13.0 / 24.8 | 22.8 / 49.0 |
| 직렬 합계 → 처리 상한 | 55.6ms → 18.0 msg/s | 55.1ms → 18.2 | 96.2ms → 10.4 |
| 실측 Throughput / max lag | 17.62 / 1,521 | 17.73 / 1,478 | 10.12 / 6,171 |
| CPU | 0.72 cores | 1.44 cores | 2.73 cores |

### 4.5 새 한계 탐색 (E·F, D 코드)

| Consumers | 입력 | Throughput | max lag | 측정 끝 lag | E2E p95 | 판정 |
| ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | 20가구 (20 msg/s) × 2회 | 19.91 | 19~31 | 0~15 | 1.0~1.2s | 안정 |
| 1 | 22가구 (22 msg/s) | 21.91 | 23 | 11 | 2.08s | 안정 (여유 약 15%) |
| 1 | 23가구 (23 msg/s) | 21.58 | 841 | 841 | 48.9s | 한계 초과 |
| 2 | 40가구 (40 msg/s) | 39.71 | 95 | 15 | 2.70s | 안정 |

1 Consumer의 실측 최대 처리량은 21.6~21.9 msg/s로 계산 상한(22.7~25.4)의 약 90%다.
개선 전 "1개 15 msg/s 안정 / 20 초과, 2개 25 안정 / 30 경계"가
"**1개 22 msg/s 안정 / 23 초과, 2개 40 msg/s 안정**"으로 이동했다. 2 Consumer 런에서
인스턴스별 처리량이 21.8 / 17.9로 갈린 것은 40가구가 24개 파티션에 해시로 고르게 떨어지지
않은 파티션 스큐이며, 한쪽 인스턴스가 상한 근처에서 동작해 E2E p95가 1 Consumer보다 높다.

## 5. 해석

### 5.1 개선 폭은 계산대로 약 9~10%다

`observation_db`는 개선 전 직렬 합계 61.4ms 중 5.4ms(9%)였다. 이 단계를 제거해서 얻을 수 있는
최대치가 9%이므로 최종 −9.3%는 그 상한에 도달한 결과다. 나머지 91%는 `inference` 26ms(47%)와
`activity_db` 17ms(31%)에 있으므로, 처리 상한을 더 올리려면 이 두 단계를 건드려야 한다.

같은 이유로 1 Consumer × 20가구는 여전히 한계 초과다. 처리 상한 18.0 msg/s가 입력 20 msg/s보다
낮아 lag는 계속 쌓이되, 600초 기준 2,480건에서 1,501건으로 39% 덜 쌓였다.

### 5.2 1차 구현에서 activity_db가 느려진 것은 행 잠금 경합이었다

B 단계에서 `activity_db` p95가 30.6ms → 39.6ms로 벌어졌고 순이익이 3.3ms에 그쳤다. flush가 행마다
`SELECT ... FOR UPDATE`를 잡는 동안 같은 행을 읽는 `record()`가 대기한 것으로 판단해 C 단계에서
UPDATE 한 문장으로 바꿨다. 그 결과 `activity_db`가 17.3 / 34.9ms로 거의 기준선까지 돌아왔고
순이익이 5.7ms로 늘었다. `anomaly_detection`도 0.8ms 줄었는데 두 seed에서 같게 나타나 DB 경합
감소의 부수 효과로 본다.

### 5.3 flush 비용

flush 1회(20가구 20행)는 C 단계에서 평균 30ms다. 5초마다 1회이므로 Consumer 시간의 약 0.6%다.
개선 전에는 초당 20건 × 5.4ms = 약 108ms를 관측 DB 쓰기에 썼으므로 DB 작업량은 약 95% 줄었다.

UPDATE 단문으로 바꾼 뒤 flush 자체는 25ms → 30ms로 오히려 조금 늘었다. 행마다 statement를
하나씩 보내는 구조라 SQLAlchemy 문장 구성 비용이 붙은 것으로 보인다. 처리량 영향이 작아 이번에는
그대로 두고, 필요하면 executemany로 묶는 것을 다음 단계로 남긴다.

### 5.4 재현성과 판정 주의

- seed 42와 43의 모든 지표 차이가 1% 안쪽이라 A→C 차이(9%)는 노이즈가 아니다.
- A~C 6개 런 모두 `report.md`에는 `PASS`로 기록됐지만 max lag 1,500~2,570은 한계 초과다.
  판정에 성능 기준이 없는 문제(`20260924` 문서 7.2절)는 그대로이므로, 이 문서의 안정 여부는
  max lag와 처리 상한으로 판단한 값이다.

### 5.5 D 단계: 계측이 병목을 두 번 찾았다

activity_db 하위 stage로 세션 갱신(5.1ms)과 receipt INSERT(1.1ms)를 분리하니 나머지 7.6ms가
receipt 조회와 COMMIT임을 알 수 있었고, 왕복 두 개를 제거해 17.3 → 13.8ms(−19%)를 얻었다.
같은 방식으로 anomaly_detection을 나누자 12ms가 전부 패턴 평가(`anomaly_evaluate`)에 있고
기준선 조회는 0.01ms라는 것이 드러났으며, 이것이 코드가 아니라 DB 정책 값의 드리프트라는 결론으로
이어졌다. 하위 stage 계측이 없었다면 두 병목 모두 "DB가 느리다"로 뭉개졌을 것이다.

### 5.6 이전 문서의 수치 보정

`20260924` 문서의 "메시지당 약 60ms, Consumer당 12~15 msg/s"는 정책 평가 주기 드리프트(약 10~12ms)를
포함한 값이다. 교정 후 같은 코드(C)의 순수 처리 시간은 약 44ms, D 코드는 약 43ms이며
Consumer당 실측 안정 처리량은 20 msg/s다. 다만 22개 런의 수평 확장 결론(1·2·4 Consumer가 거의
비례, 5개에서 호스트 경합)은 모든 런에 같은 오염이 포함돼 있었으므로 상대 비교로는 유효하다.

## 6. 트레이드오프와 제약

| 항목 | 내용 |
| --- | --- |
| 유실 창 | 프로세스가 비정상 종료하면 최대 `observation_flush_seconds`(5초)치 카운트가 유실될 수 있다. 다만 그 구간의 Offset이 커밋되지 않았으면 재시작 후 재처리되면서 DB 기준값 이후 샘플로 다시 집계된다. Offset 자동 커밋(5초)과 flush 주기가 같으므로 실제 유실은 두 주기가 엇갈리는 구간으로 제한된다 |
| DB 반영 지연 | `sample_count`와 `coverage_ratio`가 최대 5초 늦게 반영된다. 이 값을 읽는 `has_usable_observation()`(60초 주기 평가)과 일일 마감 배치(00:10)에는 영향이 없다 |
| lost 파티션 | 누적값을 버린다. 새 소유 Consumer가 커밋되지 않은 Offset부터 재처리하므로 카운트는 회복되며, flush했다면 오히려 이중 집계가 된다 |
| 마감 이후 샘플 | UPDATE의 `observation_status = 'COLLECTING'` 조건으로 기존과 같이 무시된다 |
| at-least-once | 변경 없음. 처리 실패 시 `store_offsets()`를 호출하지 않는 계약은 그대로다 |
| 메모리 | 가구·날짜 키당 수십 바이트이며, flush 시 2일 이전 키를 정리한다 |
| activity_db 변경 세션 조회 생략 | 세션을 만들거나 갱신한 트랜잭션에서는 기존과 같이 조회한다. 생략은 `sessions_changed`가 False일 때만이며 이 경우 기존 결과도 빈 목록이었다 |
| 정책 평가 주기 | 로컬 DB만 교정했다. 운영 DB는 JSON 기본값(60)으로 시드되므로 해당 없음. 시연에서 1초 평가가 필요하면 `PROLONGED_INACTIVITY` 한 정책만 바꾸되, 게이트가 최솟값을 쓰므로 세 패턴 모두 1초마다 평가된다는 점을 알고 써야 한다 |

## 7. 다음 단계

1. **배치 추론** — D 단계 이후 남은 43ms 중 `inference` 27.8ms(65%)가 압도적이다. poll에서
   받은 여러 가구의 윈도우를 모델당 forward 1회로 묶는다. Consumer 루프를 배치 단위로 바꿔야
   해 범위가 크지만, 다음으로 의미 있는 개선은 여기서만 나온다. MODEL_THREADS 실험(4.4절)이
   보여주듯 스레드 병렬화는 이 환경에서 대안이 아니다.
2. **activity_sessions 5ms** — 활성 가전마다 3테이블 JOIN `FOR UPDATE`를 수행한다. 열린 세션
   id를 메모리에 캐시하면 JOIN 없이 PK로 잠글 수 있다. 예상 2~3ms.
3. **flush executemany** — 5.3절. 처리량 영향은 0.7% 미만이므로 우선순위는 낮다.
4. **정책 게이트 패턴별 분리** — `_is_due()`가 세 정책의 최솟값을 쓰므로 한 정책을 1초로 두면
   나머지도 1초마다 평가된다. 패턴별 마지막 평가 시각을 따로 두면 시연 설정이 다른 패턴 비용에
   번지지 않는다.
5. **도구 보완** — `consumer_load_test.py` pre-check에 `warmup_households == 0` 확인과
   `analysis_policy.evaluation_interval_seconds` 확인(또는 서비스 로그의
   `Risk event evaluation interval` WARNING 감지)을 추가한다. 판정에 `lag_max`, `e2e_p95`
   기준 추가는 그대로 남아 있다.

## 8. 결론

```text
실제 모델, 1 Consumer × 20가구 × 600초, seed 42·43 평균
                        A 개선 전      D 최종
observation_db p95:     9.66ms    →   0.10ms   (인메모리 누적 + 5초 flush)
activity_db avg:        16.98ms   →   13.81ms  (왕복 2개 제거)
anomaly_detection avg:  11.96ms   →   0.31ms   (DB 정책 평가 주기 1초 → 60초 교정, 환경 교정)
메시지당 직렬 합계:      61.4ms    →   42.9ms   (−30%; 코드 −8.6ms, 환경 교정 −11.7ms)
Consumer당 처리 상한:    16.3      →   23.3 msg/s
실측:                   16.1 msg/s(lag 2,480 누적) → 19.91 msg/s(= 입력, lag 0~31)
새 한계 (1 Consumer):   22 msg/s 안정, 23 msg/s 한계 초과 (개선 전 15 안정 / 20 초과, +47%)
새 한계 (2 Consumers):  40 msg/s 안정 (개선 전 25 안정 / 30 경계, +60%)
MODEL_THREADS 2·4:      합계 변화 없음 / 2배 악화 → 1 유지
오류/DLQ:               유효 15개 런 0 (ClockSkew 측정 아티팩트 제외)
남은 병목:              inference 27.8ms(65%) > activity_db 13.8ms(32%) > 발행 1.0ms
```

관측 DB 쓰기는 크리티컬 패스에서 제거됐고, activity_db는 결과를 바꾸지 않는 범위에서 19%
줄었으며, 단계별 계측 덕분에 9/21부터 모든 측정에 섞여 있던 시연 설정 오염을 찾아 교정했다.
그 결과 1 Consumer 안정 입력이 15에서 22 msg/s로, 2 Consumer가 25에서 40 msg/s로 올라갔고
단일 Consumer 개선이 수평 확장에 그대로 전파됨을 확인했다. Consumer 필요 수 기준은
`ceil(목표 msg/s ÷ 12)`에서 `ceil(목표 msg/s ÷ 20)`로 상향할 수 있으나, 운영 서버에서
재측정하기 전까지는 보수적으로 `÷ 18`을 제안한다. 다음 개선은 배치 추론이다.
