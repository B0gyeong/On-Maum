const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(
  path.join(__dirname, '..', 'assets', 'routine_demo.js'),
  'utf8'
);

const context = {
  window: {},
  document: {
    readyState: 'loading',
    addEventListener() {}
  }
};
vm.createContext(context);
vm.runInContext(code, context);

const demo = context.window.RoutineDemo;
assert.ok(demo, 'RoutineDemo 공개 API가 있어야 합니다.');

// ---- 위 카드: 평소 점심 전자레인지 90초 사용 기록 재생 ----
const series = demo.createSeries();
assert.strictEqual(series.normal.length, 181);
assert.ok(series.normal[0] < 100, '재생 시작은 대기전력이어야 합니다.');
assert.ok(series.normal[29] < 100, '12:00 직전까지 대기전력이어야 합니다.');
assert.ok(series.normal[30] > 1200, '12:00에 켤 때 돌입 전류 피크가 나타나야 합니다.');
assert.ok(series.normal.slice(30, 120).every(value => value > 900), '켜진 90초 동안 약 940W가 끊김 없이 유지되어야 합니다.');
assert.ok(series.normal.slice(32, 120).every(value => value < 1100), '돌입 이후에는 정격 전력으로 내려와야 합니다.');
assert.ok(series.normal[120] < 100, '약 90초 뒤(12:01:30) 전자레인지를 꺼야 합니다.');
assert.ok(series.normal.slice(120).every(value => value < 100), '끈 뒤에는 대기전력만 이어져야 합니다.');

assert.strictEqual(demo.formatTime(0), '11:59:30');
assert.strictEqual(demo.formatTime(30), '12:00:00');
assert.strictEqual(demo.formatTime(120), '12:01:30');
assert.strictEqual(demo.formatTime(demo.constants.LIMIT_AT), '12:02:00');
assert.strictEqual(demo.storyFor(0).index, '01 / 03');
assert.strictEqual(demo.storyFor(30).index, '02 / 03');
assert.strictEqual(demo.storyFor(120).index, '03 / 03');

// 아래 실시간 그래프는 위 기록 재생과 같은 11:59:30~12:02:30 구간(sec 271~451)으로 시작해 발행을 따라 늘어난다.
assert.strictEqual(demo.constants.LIVE_VIEW_FROM, 271);
assert.strictEqual(demo.constants.LIVE_VIEW_TO, 451);
for (const offset of [0, 30, 120, 150, 180]) {
  assert.strictEqual(
    demo.liveTimeLabel(demo.createLiveState(), demo.constants.LIVE_VIEW_FROM + offset),
    demo.formatTime(offset),
    `offset=${offset} 시각이 두 카드에서 같아야 합니다.`
  );
}
const viewState = demo.createLiveState();
assert.strictEqual(demo.liveViewEnd(viewState), 451, '발행 전에는 위 카드와 같은 12:02:30에서 끝납니다.');
viewState.lastSec = 400;
assert.strictEqual(demo.liveViewEnd(viewState), 451, '12:02:30 전에는 축이 늘어나지 않습니다.');
viewState.lastSec = 500;
assert.strictEqual(demo.liveViewEnd(viewState), 500, '12:02:30을 넘으면 마지막 표본까지 축이 늘어납니다.');
viewState.lastSec = 630;
assert.strictEqual(demo.liveViewEnd(viewState), 630);
assert.deepStrictEqual(Array.from(demo.liveTicks(451)).sort((a, b) => a - b), [271, 301, 391, 421, 451]);
assert.deepStrictEqual(Array.from(demo.liveTicks(630)).sort((a, b) => a - b), [271, 301, 421, 601, 630], '늘어난 뒤에는 12:05:00 OFF 눈금을 보여 줍니다.');
assert.strictEqual(demo.formatDuration(0), '0:00');
assert.strictEqual(demo.formatDuration(90), '1:30');
assert.strictEqual(demo.formatDuration(300), '5:00');

// ---- 아래 카드: 서버 prolonged_use 계약(H001, 630건, 301 ON, 601 OFF)을 따른다 ----
assert.strictEqual(demo.constants.LIVE_HOUSE, 'H001');
assert.strictEqual(demo.constants.LIVE_SCENARIO, 'prolonged_use');
assert.strictEqual(demo.constants.LIVE_APPLIANCE, 'microwave');
assert.strictEqual(demo.constants.LIVE_TOTAL, 630);
assert.strictEqual(demo.constants.LIVE_ON, 301);
assert.strictEqual(demo.constants.LIVE_OFF, 601);
assert.strictEqual(demo.constants.ALLOWED_USE_SEC, 120);

const live = demo.createLiveState();
assert.strictEqual(demo.liveTimeLabel(live, 1), '11:55:00', '표본 수신 전 축은 서버 기본 시작 시각(11:55:00)을 씁니다.');
assert.strictEqual(demo.liveTimeLabel(live, 301), '12:00:00');

// 다른 가구·시나리오(E2E 외부 방송 포함)의 SSE 표본은 무시한다.
assert.strictEqual(demo.applyLiveSample(live, { house: 'H002', scenario: 'prolonged_use', sec: 1, totalP: 50 }), false);
assert.strictEqual(demo.applyLiveSample(live, { house: 'H001', scenario: 'routine_missed', sec: 1, totalP: 50 }), false);
assert.strictEqual(demo.applyLiveSample(live, { house: 'H001', scenario: 'prolonged_use', sec: 631, totalP: 50 }), false);
assert.strictEqual(live.lastSec, 0);

const pad = n => String(n).padStart(2, '0');
const sample = (sec, applianceOn, status = 'running') => {
  const t = 11 * 3600 + 54 * 60 + 59 + sec;
  return {
    house: 'H001', scenario: 'prolonged_use', sec, status,
    measurementAvailable: true, totalP: applianceOn ? 995.5 : 55.5,
    simTimeKst: `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t % 3600 / 60))}:${pad(t % 60)}`,
    simDateKst: '2026-09-24',
    devices: { microwave: { state: applianceOn ? 'RUNNING' : 'OFF', enabled: applianceOn, manualHold: applianceOn } }
  };
};

assert.strictEqual(demo.applyLiveSample(live, sample(1, false)), true);
assert.strictEqual(demo.applyLiveSample(live, sample(3, false)), true);
assert.strictEqual(live.lastSec, 3);
assert.strictEqual(live.received, 2);
assert.strictEqual(live.power[2], null, '누락된 표본은 보간하지 않고 비워 둡니다.');
assert.strictEqual(live.simTime, '11:55:02');
assert.strictEqual(demo.liveTimeLabel(live, 301), '12:00:00');
assert.strictEqual(demo.liveTimeLabel(live, 601), '12:05:00');
assert.strictEqual(demo.liveUsageSeconds(live), 0);
assert.strictEqual(demo.liveStatusText(live), '사용 전 대기전력 발행 중 (3/300)');

// 같은 초가 다시 와도 수신 건수는 늘지 않는다.
demo.applyLiveSample(live, sample(3, false));
assert.strictEqual(live.received, 2);

// 전자레인지 ON: 연속 사용 시간은 켠 시각부터 흐른 초로 센다.
demo.applyLiveSample(live, sample(301, true));
assert.strictEqual(live.onSec, 301);
assert.strictEqual(demo.liveUsageSeconds(live), 0);
demo.applyLiveSample(live, sample(361, true));
assert.strictEqual(demo.liveUsageSeconds(live), 60);
assert.ok(demo.liveStatusText(live).startsWith('전자레인지 사용 중 · 연속 1:00'));
demo.applyLiveSample(live, sample(401, true));
assert.ok(demo.liveStatusText(live).startsWith('평소 사용시간 1:30 초과'));
demo.applyLiveSample(live, sample(421, true));
assert.strictEqual(demo.liveUsageSeconds(live), 120);
assert.ok(demo.liveStatusText(live).startsWith('허용 사용시간 2:00 초과'));

// 늦게 도착한 과거 표본은 가전 상태를 되돌리지 않는다.
demo.applyLiveSample(live, sample(310, false));
assert.strictEqual(live.applianceOn, true);
assert.strictEqual(live.offSec, null);

// 12:05 OFF 이후에는 꺼진 시각까지의 사용시간(5분)으로 고정된다.
demo.applyLiveSample(live, sample(601, false));
assert.strictEqual(live.offSec, 601);
demo.applyLiveSample(live, sample(620, false));
assert.strictEqual(demo.liveUsageSeconds(live), 300);
assert.ok(demo.liveStatusText(live).startsWith('전자레인지 5:00 연속 사용 후 꺼짐'));

demo.applyLiveSample(live, sample(630, false, 'completed'));
assert.strictEqual(live.status, 'completed');
assert.ok(demo.liveStatusText(live).startsWith('MQTT 발행 630건 완료 · 전자레인지 5:00'));

console.log('routine demo UI tests passed');
