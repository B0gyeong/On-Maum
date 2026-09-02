# bigdata — 분산 데이터 인프라 (Kafka · HDFS · MQTT)

리플레이 시뮬레이터 → Kafka → (적재 예정) HDFS 파이프라인과 센서 수집용 MQTT 브로커.

## 구성

| 서비스 | 컨테이너 | 포트 | 용도 |
| --- | --- | --- | --- |
| Kafka (KRaft) | nilm-kafka | 9092 | 메시지 큐 — `power-raw` 토픽(파티션 8, 가구 ID 키) |
| Kafka UI | nilm-kafka-ui | **8089** | 토픽/메시지 육안 확인 (8081은 iot-device-service 사용 중) |
| HDFS NameNode | nilm-namenode | 9870(UI), 9000(RPC) | 데이터 레이크 — 복제 계수 1 |
| HDFS DataNode | nilm-datanode | 9864 | 블록 저장 |
| Mosquitto | nilm-mosquitto | 1883 | ESP32 센서 수집 (개발용 무인증) |

모든 컨테이너는 루트 compose가 만드는 `nilm-net` 네트워크에 합류한다.

## 실행

```bash
# 1. 루트에서 네트워크+postgres 먼저 (팀 공통)
cd D201 && docker compose up -d

# 2. bigdata 스택
cd bigdata && docker compose up -d

# 3. 리플레이 시뮬레이터 (합성 데이터, 10가구 1Hz)
pip install -r requirements.txt
python replay/producer.py --houses 10 --hz 1
#   배속: --speed 10 / CSV 재생: --csv data/xxx.csv (timestamp,house,power_w)

# 4. 수신 검증 (별도 터미널)
python replay/consumer_check.py --seconds 15
```

## HDFS 데이터 레이크 구조

```
/data/raw/         공개 데이터셋 원본 (AI-Hub, ENERTALK)
/data/stream/      Kafka에서 적재되는 측정 스트림 (house=/date= 파티션, Parquet)
/data/processed/   Spark 전처리 산출물 (피처, 윈도우)
/data/events/      감지된 온오프 이벤트 누적 (루틴 학습 재료)
```

HDFS 명령은 NameNode 컨테이너에서: `docker exec nilm-namenode hdfs dfs -ls /data`

## 검증 기록

- 2026-09-01 Kafka: 10가구 리플레이 → 유실 0, 가구별 균등, 파티션 7/8 분배, 동일 가구=동일 파티션
- 2026-09-02 HDFS: /data 4개 디렉토리 생성, put/get 왕복 성공, Live datanodes 1
- 2026-09-02 MQTT: `home/H001/power` pub → `home/+/power` sub 왕복 성공
- 2026-09-02 이관: wattsup 프로토타입 → 팀 컨벤션(nilm-*, nilm-net)으로 이식, Kafka 라운드트립 재확인

## 트러블슈팅

### Docker Desktop이 "unexpected error"로 죽을 때 (교육장 PC 공통)

PC 강제 로그오프가 남긴 유닉스 소켓 찌꺼기 때문. **Reset to factory defaults 금지.**

```powershell
Get-Process "*docker*" | Stop-Process -Force
Rename-Item "$env:LOCALAPPDATA\Docker\run" "run_stale_날짜"
New-Item -ItemType Directory "$env:LOCALAPPDATA\Docker\run"
# 에러가 다른 경로(docker-secrets-engine 등)를 가리키면 그 폴더도 동일 처리
Start-Process "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe"
```

### Kafka "advertised.listeners cannot use 0.0.0.0"

apache/kafka 이미지는 바인드 주소를 `//:포트`(빈 호스트)로 써야 함 — compose.yaml 반영됨.

## 다음 작업

- [ ] Kafka→HDFS 적재 잡 (Parquet, house=/date= 파티션, 1분 트리거) — MVP DoD
- [ ] MQTT→Kafka 브릿지 (ESP32 실측 경로)
- [ ] Spark 컨테이너 추가 및 HDFS 연동
