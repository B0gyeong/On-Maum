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

const series = demo.createSeries();
assert.strictEqual(series.normal.length, 121);
assert.strictEqual(series.anomaly.length, 121);
assert.strictEqual(series.expected.length, 121);

// 08:09~08:10에는 정상 파형만 전자레인지 부하가 나타나야 한다.
assert.ok(series.normal[30] > 1000, '전자레인지 기동 피크가 1kW를 넘어야 합니다.');
assert.ok(series.normal[60] > 900, '정상 사용 구간의 부하가 유지되어야 합니다.');
assert.ok(series.anomaly[30] < 100, '이상 파형은 기대 사용 시각에도 대기전력이어야 합니다.');
assert.ok(series.anomaly[60] < 100, '이상 파형의 대기전력이 지속되어야 합니다.');
assert.ok(series.normal[90] < 100, '08:10에는 정상 파형도 대기전력으로 복귀해야 합니다.');

assert.strictEqual(demo.formatTime(0), '08:08:30');
assert.strictEqual(demo.formatTime(30), '08:09:00');
assert.strictEqual(demo.formatTime(90), '08:10:00');
assert.strictEqual(demo.storyFor(0).index, '01 / 03');
assert.strictEqual(demo.storyFor(30).index, '02 / 03');
assert.strictEqual(demo.storyFor(90).index, '03 / 03');

console.log('routine demo UI tests passed');
