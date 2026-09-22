// The live SSE is emitted only after MQTT publication has settled. It is not
// evidence that the analysis server received or processed the sample. The
// diagram intentionally ends at the broker.
let powerflowGeneration = 0;
let powerflowTimers = [];
let powerflowRunId = null;
let powerflowHouse = null;

function powerflowElement(id) {
  return document.getElementById(id);
}

function powerflowAnnounce(message) {
  const full = `${message}. MQTT 브로커 발행 확인까지 표시`;
  const panel = powerflowElement('powerflowPanel');
  if (panel) panel.setAttribute('aria-label', `계측 데이터 전송 흐름: ${full}`);
  const live = powerflowElement('powerflowA11yStatus');
  if (live && live.textContent !== full) live.textContent = full;
}

function powerflowLater(callback, delay) {
  const id = setTimeout(() => {
    powerflowTimers = powerflowTimers.filter(timer => timer !== id);
    callback();
  }, delay);
  powerflowTimers.push(id);
}

function powerflowClearMotion() {
  powerflowGeneration += 1;
  powerflowTimers.forEach(clearTimeout);
  powerflowTimers = [];
  const lane = powerflowElement('powerflowMqttLane');
  if (lane) {
    Array.from(lane.children).forEach(child => {
      if (child.className === 'flow-packet') lane.removeChild(child);
    });
  }
  const board = powerflowElement('powerflowBoard');
  const broker = powerflowElement('powerflowBroker');
  if (board) board.className = 'flow-device flow-board';
  if (broker) broker.className = 'flow-device flow-broker';
}

function powerflowReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function powerflowSetRing(percent) {
  const ring = powerflowElement('powerflowBurstRing');
  if (!ring) return;
  if (ring.style.setProperty) ring.style.setProperty('--burst-progress', percent);
  else ring.style['--burst-progress'] = percent;
}

function powerflowPulse() {
  const panel = powerflowElement('powerflowPanel');
  const lane = powerflowElement('powerflowMqttLane');
  if (!panel || !lane || powerflowReducedMotion()) return;
  const generation = powerflowGeneration;
  const board = powerflowElement('powerflowBoard');
  const broker = powerflowElement('powerflowBroker');
  const packet = document.createElement('span');
  packet.className = 'flow-packet';
  packet.setAttribute('aria-hidden', 'true');
  lane.appendChild(packet);
  const packets = Array.from(lane.children).filter(child => child.className === 'flow-packet');
  if (packets.length > 8) lane.removeChild(packets[0]);
  if (board) board.className = 'flow-device flow-board flow-react';
  powerflowLater(() => {
    if (generation === powerflowGeneration && board) board.className = 'flow-device flow-board';
  }, 500);
  powerflowLater(() => {
    if (generation === powerflowGeneration && broker) {
      broker.className = 'flow-device flow-broker';
      void broker.offsetWidth;
      broker.className = 'flow-device flow-broker flow-react';
    }
  }, 800);
  powerflowLater(() => {
    if (generation !== powerflowGeneration) return;
    if (packet.parentNode === lane) lane.removeChild(packet);
    if (broker) broker.className = 'flow-device flow-broker';
  }, 1150);
}

function powerflowSetMode(mode) {
  const panel = powerflowElement('powerflowPanel');
  if (!panel) return;
  if (panel.getAttribute('data-mode') !== mode) powerflowClearMotion();
  panel.setAttribute('data-mode', mode === 'burst' ? 'burst' : 'live');
}

function powerflowSetRunState(state) {
  const panel = powerflowElement('powerflowPanel');
  if (!panel) return;
  const next = ['running', 'paused', 'completed'].includes(state) ? state : 'idle';
  const previous = panel.getAttribute('data-run-state');
  panel.setAttribute('data-run-state', next);
  if (next !== 'running') {
    powerflowClearMotion();
    panel.setAttribute('data-confirmed', '0');
  }
  if (next === 'paused') {
    panel.setAttribute('data-visual-state', 'paused');
    powerflowAnnounce('일시정지');
  } else if (next === 'completed') {
    panel.setAttribute('data-visual-state', 'completed');
    powerflowAnnounce('종료');
  } else if (next === 'idle') {
    panel.setAttribute('data-visual-state', 'idle');
    panel.setAttribute('data-confirmed', '0');
    powerflowAnnounce('대기');
  } else if (previous !== 'running' || panel.getAttribute('data-visual-state') !== 'confirmed') {
    panel.setAttribute('data-confirmed', '0');
    panel.setAttribute('data-visual-state', 'waiting');
    powerflowAnnounce('발행 대기');
  }
}

function powerflowReset() {
  powerflowClearMotion();
  powerflowRunId = null;
  powerflowHouse = null;
  const panel = powerflowElement('powerflowPanel');
  if (!panel) return;
  panel.setAttribute('data-mode', 'live');
  panel.setAttribute('data-fault', '0');
  panel.setAttribute('data-confirmed', '0');
  panel.setAttribute('data-visual-state', 'idle');
  panel.setAttribute('data-run-state', 'idle');
  powerflowSetRing('0%');
  const burst = powerflowElement('powerflowBurst');
  if (burst) burst.setAttribute('aria-label', 'MQTT 발행 0건 / 계획 0건');
  powerflowAnnounce('대기');
}

function powerflowBeginRun(runId) {
  powerflowReset();
  powerflowRunId = runId || null;
  powerflowSetRunState('running');
}

function powerflowSetObservedHouse(house) {
  powerflowHouse = house;
  powerflowClearMotion();
  const panel = powerflowElement('powerflowPanel');
  if (!panel) return;
  panel.setAttribute('data-confirmed', '0');
  panel.setAttribute('data-fault', '0');
  powerflowSetRing('0%');
  const gauge = powerflowElement('powerflowBurst');
  if (gauge) gauge.setAttribute('aria-label', 'MQTT 발행 0건 / 계획 0건');
  if (panel.getAttribute('data-run-state') === 'running') {
    panel.setAttribute('data-visual-state', 'waiting');
    powerflowAnnounce('발행 대기');
  }
}

function powerflowApplyRealtime(metric) {
  const panel = powerflowElement('powerflowPanel');
  if (!panel || panel.getAttribute('data-mode') !== 'live') return;
  if (metric.house !== powerflowHouse && powerflowHouse !== null) return;
  if (metric.source === 'E2E') {
    if (!powerflowRunId || metric.run_id !== powerflowRunId) return;
  } else if (powerflowRunId) {
    return;
  }
  if (metric.status === 'completed' || metric.status === 'stopped') {
    powerflowSetRunState('completed');
    return;
  }
  if (panel.getAttribute('data-run-state') !== 'running') return;
  const missing = metric.sensorFault || metric.measurementAvailable === false;
  const published = !missing && metric.status === 'running' &&
    (metric.source !== 'E2E' || metric.measurementAvailable === true) &&
    typeof metric.totalP === 'number' && Number.isFinite(metric.totalP);
  if (!published) {
    powerflowClearMotion();
    panel.setAttribute('data-fault', missing ? '1' : '0');
    panel.setAttribute('data-confirmed', '0');
    panel.setAttribute('data-visual-state', missing ? 'missing' : 'waiting');
    powerflowAnnounce(missing ? '계측 결측, 발행 중단' : '발행 대기');
    return;
  }
  panel.setAttribute('data-fault', '0');
  panel.setAttribute('data-confirmed', '1');
  panel.setAttribute('data-visual-state', 'confirmed');
  powerflowAnnounce('MQTT 브로커 발행 확인');
  powerflowPulse();
}

function powerflowRenderE2E(snapshot) {
  const panel = powerflowElement('powerflowPanel');
  if (!panel || !snapshot) return;
  const runId = snapshot.run_id || null;
  if (runId !== powerflowRunId) powerflowBeginRun(runId);
  const burst = snapshot.execution_mode === 'BURST';
  powerflowSetMode(burst ? 'burst' : 'live');
  const status = snapshot.overall_status || snapshot.overall_state || 'IDLE';
  const house = (snapshot.households || []).find(item => item.household_id === (powerflowHouse || observedHouse));
  const visualStatus = house && house.state ? house.state : status;
  const state = ['RUNNING', 'STARTING'].includes(visualStatus) ? 'running' :
    ['PAUSED', 'PAUSING', 'STOPPING'].includes(visualStatus) ? 'paused' :
      ['COMPLETED', 'STOPPED', 'FAILED', 'PARTIAL_FAILED'].includes(visualStatus) ? 'completed' : 'idle';
  powerflowSetRunState(state);
  if (!burst) return;
  const published = Math.max(0, Number(house && house.published_samples) || 0);
  const planned = Math.max(0, Number(house && house.planned_publish_samples) || 0);
  const percent = planned > 0 ? Math.min(100, published / planned * 100) : 0;
  powerflowSetRing(`${percent}%`);
  const gauge = powerflowElement('powerflowBurst');
  if (gauge) gauge.setAttribute('aria-label', `MQTT 발행 ${published}건 / 계획 ${planned}건`);
  panel.setAttribute('data-confirmed', state === 'running' && published > 0 ? '1' : '0');
  if (state === 'running') {
    panel.setAttribute('data-visual-state', published > 0 ? 'confirmed' : 'waiting');
    powerflowAnnounce(`MQTT 발행 ${published}건 / 계획 ${planned}건`);
  }
}
