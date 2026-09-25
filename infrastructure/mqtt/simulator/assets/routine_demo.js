(function () {
  'use strict';

  // 위 카드: 평소 점심 전자레인지 사용(12:00부터 약 90초)을 보여 주는 발표용 결정적 재생. 발행하지 않는다.
  const TOTAL_SECONDS = 180;
  const USE_START = 30;
  const USE_END = 120;
  const LIMIT_AT = 150;
  const START_SECONDS = 11 * 3600 + 59 * 60 + 30;

  // 아래 카드: 시뮬레이터가 실제로 발행하는 H001 prolonged_use 실행 (scenarios.ProlongedUseScenario)
  const LIVE_HOUSE = 'H001';
  const LIVE_SCENARIO = 'prolonged_use';
  const LIVE_APPLIANCE = 'microwave';
  const LIVE_TOTAL = 630;
  const LIVE_ON = 301;
  const LIVE_OFF = 601;
  const USUAL_USE_SEC = 90;
  const ALLOWED_USE_SEC = 120;
  // 서버 기본 시작 시각은 11:55:00이고 1번째 표본이 sec=1이므로, sec=0 기준은 11:54:59이다.
  const LIVE_DEFAULT_START = 11 * 3600 + 54 * 60 + 59;
  const POWER_MAX = 1200;
  // 아래 그래프는 위 기록 재생과 같은 11:59:30~12:02:30 구간(sec 271~451)으로 시작하고,
  // 발행이 12:02:30을 넘으면 같은 폭 안에서 오른쪽 끝을 늘려 12:05:29(sec 630)까지 보여 준다.
  const LIVE_VIEW_FROM = LIVE_ON - USE_START;
  const LIVE_VIEW_TO = LIVE_VIEW_FROM + TOTAL_SECONDS;

  const COLORS = { normal: '#d95e12', anomaly: '#b91c1c', grid: 'rgba(214, 211, 209, .55)', tick: '#78716c', band: 'rgba(243, 121, 41, .10)', marker: '#b91c1c' };

  function seededNoise(index, salt) {
    const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return (value - Math.floor(value)) * 2 - 1;
  }

  function standbyPower(index, salt) {
    return 56 + Math.sin(index / 9 + salt) * 2.4 + Math.sin(index / 23) * 1.5 + seededNoise(index, salt) * 1.6;
  }

  // 전자레인지 연속 블록(약 940W, 켤 때 2초 돌입 전류, engine/profiles.py 중앙값)을 결정적으로 재현한다.
  function createSeries() {
    const normal = [];
    for (let second = 0; second <= TOTAL_SECONDS; second += 1) {
      let appliance = 0;
      if (second >= USE_START && second < USE_END) {
        const inrush = second === USE_START ? 330 : second === USE_START + 1 ? 180 : 0;
        appliance = 940 + inrush + seededNoise(second, 8) * 4;
      }
      normal.push(Math.round((standbyPower(second, 1) + appliance) * 10) / 10);
    }
    return { normal };
  }

  function formatDuration(seconds) {
    const safe = Math.max(0, Math.round(seconds));
    return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
  }

  function formatClock(absolute) {
    const hours = Math.floor(absolute / 3600) % 24;
    const minutes = Math.floor((absolute % 3600) / 60);
    const seconds = absolute % 60;
    return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
  }

  function formatTime(offset) {
    return formatClock(START_SECONDS + offset);
  }

  function parseClock(text) {
    const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(String(text || ''));
    if (!match) return null;
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }

  function storyFor(position) {
    if (position < USE_START) {
      return {
        index: '01 / 03', eyebrow: '대기전력 관찰',
        title: '점심 준비 전에는 대기전력만 흐릅니다.',
        body: '공유기·셋톱박스·냉장고 등에서 발생하는 약 50–65W의 기저부하가 유지됩니다.'
      };
    }
    if (position < USE_END) {
      return {
        index: '02 / 03', eyebrow: '평소 사용',
        title: '평소에는 12:00에 전자레인지로 약 90초 데웁니다.',
        body: '전자레인지는 켜는 순간 돌입 전류로 잠깐 튄 뒤 약 940W를 끊김 없이 유지합니다. 끄면 바로 대기전력으로 돌아옵니다.'
      };
    }
    return {
      index: '03 / 03', eyebrow: '오늘과 비교',
      title: '평소에는 1분 30초 만에 끄지만, 오늘은 계속 켜져 있습니다.',
      body: '아래 실시간 그래프에서 전자레인지가 켜진 뒤 허용 사용시간 2분을 넘겨 5분간 이어집니다. 사용시간 초과 판정은 AI 분석 서비스가 수행합니다.'
    };
  }

  // ---- 실시간 발행 상태 (DOM과 분리된 순수 함수: 테스트 대상) ----
  function createLiveState() {
    return { power: new Array(LIVE_TOTAL + 1).fill(null), lastSec: 0, received: 0, baseSeconds: null, simTime: null, simDate: null, status: 'idle', onSec: null, offSec: null, applianceOn: false };
  }

  function applyLiveSample(state, sample) {
    if (!sample || sample.house !== LIVE_HOUSE || sample.scenario !== LIVE_SCENARIO) return false;
    const sec = Number(sample.sec);
    if (!Number.isInteger(sec) || sec < 0 || sec > LIVE_TOTAL) return false;
    if (state.power[sec] === null) state.received += 1;
    state.power[sec] = sample.measurementAvailable === false ? null : Number(sample.totalP);
    state.lastSec = Math.max(state.lastSec, sec);
    const clock = parseClock(sample.simTimeKst);
    if (clock !== null) {
      if (state.baseSeconds === null) state.baseSeconds = clock - sec;
      state.simTime = sample.simTimeKst;
    }
    if (sample.simDateKst) state.simDate = sample.simDateKst;
    if (sample.status) state.status = sample.status;
    const appliance = sample.devices && sample.devices[LIVE_APPLIANCE];
    if (appliance && sec >= state.lastSec) {
      if (appliance.enabled && state.onSec === null) state.onSec = sec;
      if (!appliance.enabled && state.applianceOn && state.offSec === null) state.offSec = sec;
      state.applianceOn = Boolean(appliance.enabled);
    }
    return true;
  }

  // 켠 시각부터 흐른 초 (분석 서비스와 같은 started_at 기준 경과 시간). 꺼진 뒤에는 꺼진 시각까지.
  function liveUsageSeconds(state) {
    if (state.onSec === null) return 0;
    const end = state.offSec !== null ? state.offSec : state.lastSec;
    return Math.max(0, end - state.onSec);
  }

  function liveTimeLabel(state, sec) {
    const base = state.baseSeconds === null ? LIVE_DEFAULT_START : state.baseSeconds;
    return formatClock(((base + sec) % 86400 + 86400) % 86400);
  }

  function liveViewEnd(state) {
    return Math.min(LIVE_TOTAL, Math.max(LIVE_VIEW_TO, state.lastSec));
  }

  // 눈금 후보. 앞쪽일수록 우선하며, 좁아서 겹치는 눈금은 그리기에서 뺀다.
  // 축이 늘어나 12:00:00이 왼쪽 끝(11:59:30)과 가까워지면 12:00:00을 남긴다.
  function liveTicks(end) {
    const ticks = [LIVE_ON, LIVE_ON + ALLOWED_USE_SEC, end, LIVE_VIEW_FROM];
    if (end === LIVE_VIEW_TO) ticks.push(LIVE_ON + USUAL_USE_SEC);
    if (end >= LIVE_OFF) ticks.push(LIVE_OFF);
    return ticks;
  }

  function liveStatusText(state) {
    const used = liveUsageSeconds(state);
    if (state.lastSec >= LIVE_TOTAL || state.status === 'completed') return `MQTT 발행 ${LIVE_TOTAL}건 완료 · 전자레인지 ${formatDuration(used)} 연속 사용 기록`;
    if (state.onSec === null) return `사용 전 대기전력 발행 중 (${state.lastSec}/${LIVE_ON - 1})`;
    if (state.offSec !== null) return `전자레인지 ${formatDuration(used)} 연속 사용 후 꺼짐 · 대기전력 복귀`;
    if (used < USUAL_USE_SEC) return `전자레인지 사용 중 · 연속 ${formatDuration(used)} (평소 ${formatDuration(USUAL_USE_SEC)})`;
    if (used < ALLOWED_USE_SEC) return `평소 사용시간 ${formatDuration(USUAL_USE_SEC)} 초과 · 연속 ${formatDuration(used)}`;
    return `허용 사용시간 ${formatDuration(ALLOWED_USE_SEC)} 초과 · 연속 ${formatDuration(used)} — AI 사용시간 초과 판정 대상`;
  }

  // ---- 그리기 ----
  function getCanvasMetrics(canvas) {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(120, Math.round(rect.height));
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const context = canvas.getContext('2d');
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width, height };
  }

  function drawFrame(canvas, from, to, timeTicks, labelFor) {
    const { context: ctx, width, height } = getCanvasMetrics(canvas);
    const pad = { left: 46, right: 16, top: 12, bottom: 24 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const xAt = index => pad.left + ((index - from) / (to - from)) * plotWidth;
    const yAt = power => pad.top + (1 - Math.min(POWER_MAX, Math.max(0, power)) / POWER_MAX) * plotHeight;

    ctx.clearRect(0, 0, width, height);
    ctx.font = '10px Pretendard, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    [0, 400, 800, 1200].forEach(power => {
      const y = yAt(power);
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = COLORS.tick;
      ctx.fillText(power === POWER_MAX ? '1.2kW' : String(power), pad.left - 8, y);
    });

    // 눈금은 주어진 순서(우선순위)대로 그리고, 이미 그린 눈금과 겹치면 뺀다. 양 끝 눈금은 안쪽으로 정렬한다.
    const drawn = [];
    timeTicks.forEach(second => {
      if (second < from || second > to) return;
      const label = labelFor(second);
      const textWidth = ctx.measureText(label).width;
      const x = xAt(second);
      const left = second === from ? x : second === to ? x - textWidth : x - textWidth / 2;
      const right = left + textWidth;
      if (drawn.some(span => left < span.right + 8 && right > span.left - 8)) return;
      drawn.push({ left, right });
      ctx.fillStyle = COLORS.tick;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, left, height - 2);
    });

    return { ctx, pad, plotHeight, xAt, yAt, from, to };
  }

  function plotLine(frame, line, color, limit) {
    const { ctx, xAt, yAt, from, to } = frame;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let penDown = false;
    for (let index = from; index <= Math.min(limit, to); index += 1) {
      const value = line[index];
      if (value === null || value === undefined || Number.isNaN(value)) { penDown = false; continue; }
      if (penDown) ctx.lineTo(xAt(index), yAt(value)); else ctx.moveTo(xAt(index), yAt(value));
      penDown = true;
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawCursor(frame, x, y, color) {
    const { ctx, pad, plotHeight } = frame;
    ctx.strokeStyle = color;
    ctx.globalAlpha = .38;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotHeight);
    ctx.stroke();
    ctx.globalAlpha = 1;
    if (y === null) return;
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawBand(frame, from, to) {
    const { ctx, pad, plotHeight, xAt } = frame;
    ctx.fillStyle = COLORS.band;
    ctx.fillRect(xAt(from), pad.top, xAt(to) - xAt(from), plotHeight);
  }

  function drawMarker(frame, at) {
    const { ctx, pad, plotHeight, xAt } = frame;
    ctx.save();
    ctx.strokeStyle = COLORS.marker;
    ctx.globalAlpha = .7;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xAt(at), pad.top);
    ctx.lineTo(xAt(at), pad.top + plotHeight);
    ctx.stroke();
    ctx.restore();
  }

  function drawReplay(canvas, data, position) {
    const frame = drawFrame(canvas, 0, TOTAL_SECONDS, [USE_START, LIMIT_AT, TOTAL_SECONDS, 0, USE_END], formatTime);
    const { xAt, yAt } = frame;
    drawBand(frame, USE_START, USE_END);
    drawMarker(frame, LIMIT_AT);
    plotLine(frame, data, COLORS.normal, position);
    drawCursor(frame, xAt(position), yAt(data[position]), COLORS.normal);
  }

  function drawLive(canvas, state) {
    const end = liveViewEnd(state);
    const frame = drawFrame(canvas, LIVE_VIEW_FROM, end, liveTicks(end), sec => liveTimeLabel(state, sec));
    const { xAt, yAt } = frame;
    drawBand(frame, LIVE_ON, LIVE_ON + USUAL_USE_SEC);
    drawMarker(frame, LIVE_ON + ALLOWED_USE_SEC);
    plotLine(frame, state.power, COLORS.anomaly, state.lastSec);
    if (state.lastSec >= LIVE_VIEW_FROM) {
      const value = state.power[state.lastSec];
      drawCursor(frame, xAt(state.lastSec), value === null ? null : yAt(value), COLORS.anomaly);
    }
  }

  // ---- 서버 연동 ----
  async function requestJson(method, url, body) {
    const response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    let payload = null;
    try { payload = await response.json(); } catch (err) { payload = null; }
    if (!response.ok) {
      const message = payload && payload.message ? payload.message : `HTTP ${response.status}`;
      throw new Error(message);
    }
    return payload || {};
  }

  function initLive() {
    const canvas = document.getElementById('anomalyChart');
    const el = {
      card: document.getElementById('liveCard'),
      badge: document.getElementById('liveBadge'),
      clock: document.getElementById('liveClock'),
      power: document.getElementById('livePower'),
      progress: document.getElementById('liveProgress'),
      start: document.getElementById('liveStartButton'),
      stop: document.getElementById('liveStopButton'),
      speed: document.getElementById('liveSpeedSelect'),
      message: document.getElementById('liveMessage'),
      usage: document.getElementById('liveUsage')
    };
    let state = createLiveState();
    let phase = 'idle'; // idle | starting | running | completed | stopped | error
    let stream = null;
    let watchdog = null;

    function setPhase(next, message) {
      phase = next;
      el.card.dataset.state = next;
      const busy = next === 'starting' || next === 'running';
      el.start.disabled = busy;
      el.stop.disabled = !busy;
      el.speed.disabled = busy;
      el.start.textContent = next === 'completed' || next === 'stopped' || next === 'error' ? '↻ 다시 실행' : '▶ 실시간 실행';
      const badge = {
        idle: ['실행 전', 'status-waiting'],
        starting: ['연결 중', 'status-active'],
        running: ['발행 중', 'status-active'],
        completed: ['발행 완료', 'status-alert'],
        stopped: ['중지됨', 'status-waiting'],
        error: ['실행 실패', 'status-alert']
      }[next];
      el.badge.textContent = badge[0];
      el.badge.className = 'status-badge ' + badge[1];
      if (message) el.message.textContent = message;
      if (next === 'running' && !watchdog) watchdog = window.setInterval(checkServer, 3000);
      if (next !== 'running' && next !== 'starting' && watchdog) { window.clearInterval(watchdog); watchdog = null; }
    }

    function finish() {
      closeStream();
      setPhase('completed', `${state.simDate || ''} ${liveTimeLabel(state, 1)}부터 ${LIVE_TOTAL}건을 MQTT로 발행했습니다. 전자레인지는 ${formatDuration(liveUsageSeconds(state))} 연속 사용되었습니다. Kafka 적재와 AI 판정 결과는 브리지·분석 서비스에서 확인합니다.`.trim());
    }

    // SSE 큐가 가득 차면 서버가 표본을 버리고, 다른 화면에서 중지하면 알림이 오지 않으므로 상태를 주기적으로 대조한다.
    async function checkServer() {
      if (phase !== 'running') return;
      try {
        const status = await requestJson('GET', '/api/status');
        const house = status.active_households && status.active_households[LIVE_HOUSE];
        if (house && house.scenario === LIVE_SCENARIO && house.status === 'running') return;
        if (phase !== 'running') return;
        if (house && house.scenario === LIVE_SCENARIO && house.status === 'completed') {
          const last = status.last_metrics_by_house && status.last_metrics_by_house[LIVE_HOUSE];
          if (last) applyLiveSample(state, last);
          finish();
        } else {
          closeStream();
          setPhase('stopped', `${state.lastSec}건 발행 후 실행이 종료되었습니다. 다른 화면에서 중지했거나 다른 시나리오가 시작되었습니다.`);
        }
        render();
      } catch (err) { /* 일시적인 조회 실패는 다음 주기에 다시 확인한다 */ }
    }

    function render() {
      drawLive(canvas, state);
      el.clock.textContent = state.simTime || '--:--:--';
      const value = state.power[state.lastSec];
      el.power.textContent = state.lastSec > 0 && value !== null ? Math.round(value).toLocaleString('ko-KR') : '—';
      el.progress.textContent = `발행 ${state.lastSec} / ${LIVE_TOTAL}`;
      el.usage.textContent = state.onSec === null ? '—' : formatDuration(liveUsageSeconds(state));
      if (phase === 'running') {
        const over = state.onSec !== null && liveUsageSeconds(state) >= ALLOWED_USE_SEC;
        el.badge.textContent = over ? '사용시간 초과' : state.applianceOn ? '전자레인지 사용 중' : '발행 중';
        el.badge.className = 'status-badge ' + (over ? 'status-alert' : 'status-active');
      }
    }

    function closeStream() {
      if (stream) { stream.close(); stream = null; }
    }

    function openStream() {
      closeStream();
      stream = new EventSource('/api/stream');
      stream.onmessage = function (event) {
        let sample;
        try { sample = JSON.parse(event.data); } catch (err) { return; }
        if (phase !== 'running' && phase !== 'starting') return;
        if (!applyLiveSample(state, sample)) return;
        if (state.status === 'completed' || state.lastSec >= LIVE_TOTAL) {
          finish();
        } else if (phase === 'running') {
          el.message.textContent = liveStatusText(state);
        }
        render();
      };
    }

    async function start() {
      setPhase('starting', '시뮬레이터 상태를 확인하는 중입니다.');
      try {
        const status = await requestJson('GET', '/api/status');
        if (status.is_running) {
          const ok = window.confirm(`시뮬레이터에서 '${status.current_mode || '다른'}' 실행이 진행 중입니다.\n중지하고 H001 전자레인지 사용시간 초과(prolonged_use) 실시간 발행을 시작할까요?`);
          if (!ok) { setPhase('idle', '실행을 취소했습니다. 진행 중인 시뮬레이션은 그대로 유지됩니다.'); return; }
        }
        state = createLiveState();
        render();
        openStream();
        const speed = Number(el.speed.value) || 1;
        const started = await requestJson('POST', '/api/start', { house: LIVE_HOUSE, scenario: LIVE_SCENARIO, interval: Math.round(1000 / speed) / 1000 });
        const resolved = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/.exec(started.resolved_start_time || '');
        setPhase('running', `발행 시작 · 가상 시작 시각 ${resolved ? resolved[1] + ' ' + resolved[2] : '11:55:00'} KST`);
      } catch (err) {
        closeStream();
        setPhase('error', `실행하지 못했습니다: ${err.message}`);
      }
    }

    async function stop() {
      el.stop.disabled = true;
      closeStream();
      try {
        await requestJson('POST', '/api/stop');
        setPhase('stopped', `${state.lastSec}건 발행 후 중지했습니다.`);
      } catch (err) {
        setPhase('error', `중지 요청이 실패했습니다: ${err.message}`);
      }
      render();
    }

    // 이미 진행 중인 prolonged_use 실행이 있으면 이어서 표시한다 (새로고침·다른 탭에서 시작한 경우).
    async function attachIfRunning() {
      try {
        const status = await requestJson('GET', '/api/status');
        const house = status.active_households && status.active_households[LIVE_HOUSE];
        if (!house || house.scenario !== LIVE_SCENARIO || house.status !== 'running') return;
        const last = status.last_metrics_by_house && status.last_metrics_by_house[LIVE_HOUSE];
        if (last) applyLiveSample(state, last);
        setPhase('running', '진행 중인 실행에 연결했습니다. 연결 이전 구간은 비어 있습니다.');
        openStream();
        render();
      } catch (err) { /* 상태 조회 실패 시 실행 전 상태로 둔다 */ }
    }

    el.start.addEventListener('click', start);
    el.stop.addEventListener('click', stop);
    // SSE는 브라우저 연결 풀을 점유하므로 페이지를 떠날 때 닫는다. 다른 탭으로 전환하는 동안에는 유지한다.
    window.addEventListener('pagehide', closeStream);
    window.addEventListener('pageshow', function (event) {
      if (event.persisted && phase === 'running') openStream();
    });
    window.addEventListener('resize', render);
    setPhase('idle');
    render();
    attachIfRunning();
  }

  function initReplay() {
    const canvas = document.getElementById('normalChart');
    const series = createSeries();
    const elements = {
      clock: document.getElementById('demoClock'),
      normalPower: document.getElementById('normalPower'),
      normalBadge: document.getElementById('normalBadge'),
      play: document.getElementById('playButton'),
      reset: document.getElementById('resetButton'),
      speed: document.getElementById('speedSelect'),
      scrubber: document.getElementById('demoScrubber'),
      storyIndex: document.getElementById('storyIndex'),
      storyEyebrow: document.getElementById('storyEyebrow'),
      storyTitle: document.getElementById('storyTitle'),
      storyBody: document.getElementById('storyBody')
    };
    let position = 0;
    let playing = false;
    let lastTick = 0;
    let accumulator = 0;

    function render() {
      drawReplay(canvas, series.normal, position);
      elements.clock.textContent = formatTime(position);
      elements.normalPower.textContent = Math.round(series.normal[position]).toLocaleString('ko-KR');
      elements.scrubber.value = String(position);

      const usingAppliance = position >= USE_START && position < USE_END;
      elements.normalBadge.textContent = usingAppliance ? '전자레인지 사용 중' : position >= USE_END ? '사용 종료' : '대기전력';
      elements.normalBadge.className = 'status-badge ' + (usingAppliance ? 'status-active' : 'status-normal');

      const story = storyFor(position);
      elements.storyIndex.textContent = story.index;
      elements.storyEyebrow.textContent = story.eyebrow;
      elements.storyTitle.textContent = story.title;
      elements.storyBody.textContent = story.body;
    }

    function setPlaying(next) {
      playing = next;
      lastTick = 0;
      accumulator = 0;
      elements.play.textContent = playing ? 'Ⅱ 일시정지' : position >= TOTAL_SECONDS ? '↻ 다시 재생' : '▶ 재생';
      if (playing) window.requestAnimationFrame(tick);
    }

    function tick(timestamp) {
      if (!playing) return;
      if (!lastTick) lastTick = timestamp;
      const elapsed = Math.min(250, timestamp - lastTick);
      lastTick = timestamp;
      accumulator += elapsed * Number(elements.speed.value) / 1000;
      const advance = Math.floor(accumulator);
      if (advance > 0) {
        accumulator -= advance;
        position = Math.min(TOTAL_SECONDS, position + advance);
        render();
      }
      if (position >= TOTAL_SECONDS) setPlaying(false);
      else window.requestAnimationFrame(tick);
    }

    elements.play.addEventListener('click', function () {
      if (!playing && position >= TOTAL_SECONDS) position = 0;
      setPlaying(!playing);
      render();
    });
    elements.reset.addEventListener('click', function () {
      setPlaying(false);
      position = 0;
      render();
    });
    elements.scrubber.addEventListener('input', function () {
      setPlaying(false);
      position = Number(elements.scrubber.value);
      render();
    });
    window.addEventListener('resize', render);
    render();
  }

  function init() {
    if (!document.getElementById('normalChart') || !document.getElementById('anomalyChart')) return;
    initReplay();
    initLive();
  }

  window.RoutineDemo = {
    createSeries, formatTime, storyFor,
    createLiveState, applyLiveSample, liveTimeLabel, liveViewEnd, liveTicks, liveStatusText, liveUsageSeconds, formatDuration,
    constants: { TOTAL_SECONDS, USE_START, USE_END, LIMIT_AT, LIVE_TOTAL, LIVE_ON, LIVE_OFF, LIVE_VIEW_FROM, LIVE_VIEW_TO, USUAL_USE_SEC, ALLOWED_USE_SEC, LIVE_HOUSE, LIVE_SCENARIO, LIVE_APPLIANCE }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
