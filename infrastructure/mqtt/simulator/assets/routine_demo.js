(function () {
  'use strict';

  const TOTAL_SECONDS = 120;
  const USE_START = 30;
  const USE_END = 90;
  const START_SECONDS = 8 * 3600 + 8 * 60 + 30;

  function seededNoise(index, salt) {
    const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
    return (value - Math.floor(value)) * 2 - 1;
  }

  function standbyPower(index, salt) {
    return 56 + Math.sin(index / 9 + salt) * 2.4 + Math.sin(index / 23) * 1.5 + seededNoise(index, salt) * 1.6;
  }

  function createSeries() {
    const normal = [];
    const anomaly = [];
    const expected = [];
    for (let second = 0; second <= TOTAL_SECONDS; second += 1) {
      const normalBase = standbyPower(second, 1);
      const anomalyBase = standbyPower(second, 4);
      let appliance = 0;
      if (second >= USE_START && second < USE_END) {
        const inrush = second === USE_START ? 132 : second === USE_START + 1 ? 68 : 0;
        appliance = 940 + inrush + seededNoise(second, 8) * 4;
      }
      normal.push(Math.round((normalBase + appliance) * 10) / 10);
      anomaly.push(Math.round(anomalyBase * 10) / 10);
      expected.push(Math.round((anomalyBase + appliance) * 10) / 10);
    }
    return { normal, anomaly, expected };
  }

  function formatTime(offset) {
    const absolute = START_SECONDS + offset;
    const hours = Math.floor(absolute / 3600) % 24;
    const minutes = Math.floor((absolute % 3600) / 60);
    const seconds = absolute % 60;
    return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
  }

  function storyFor(position) {
    if (position < USE_START) {
      return {
        index: '01 / 03', eyebrow: '대기전력 관찰',
        title: '두 파형 모두 평온하게 시작합니다.',
        body: '공유기·셋톱박스·냉장고 등에서 발생하는 약 50–65W의 기저부하가 유지됩니다.'
      };
    }
    if (position < USE_END) {
      return {
        index: '02 / 03', eyebrow: '루틴 비교',
        title: '평소에는 생기던 전력 변화가 오늘은 없습니다.',
        body: '위 그래프는 전자레인지 사용으로 약 1,000W까지 상승하지만, 아래 그래프는 기대 구간에도 대기전력에 머뭅니다.'
      };
    }
    return {
      index: '03 / 03', eyebrow: '루틴 누락 후보',
      title: '사용 시간은 지났지만 가전은 켜지지 않았습니다.',
      body: '단순한 저전력이 아니라 학습된 시간대의 행동이 사라진 상황입니다. 분석 윈도우가 충족되면 이상 감지 판정 대상으로 전달됩니다.'
    };
  }

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

  function drawChart(canvas, data, expected, position, color) {
    const { context: ctx, width, height } = getCanvasMetrics(canvas);
    const pad = { left: 46, right: 16, top: 12, bottom: 24 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const xAt = index => pad.left + (index / TOTAL_SECONDS) * plotWidth;
    const yAt = power => pad.top + (1 - Math.min(1200, Math.max(0, power)) / 1200) * plotHeight;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'rgba(243, 121, 41, .08)';
    ctx.fillRect(xAt(USE_START), pad.top, xAt(USE_END) - xAt(USE_START), plotHeight);

    ctx.font = '10px Pretendard, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    [0, 400, 800, 1200].forEach(power => {
      const y = yAt(power);
      ctx.strokeStyle = 'rgba(214, 211, 209, .55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = '#78716c';
      ctx.fillText(power === 1200 ? '1.2kW' : String(power), pad.left - 8, y);
    });

    [0, 30, 60, 90, 120].forEach(second => {
      ctx.fillStyle = '#78716c';
      ctx.textAlign = second === 0 ? 'left' : second === 120 ? 'right' : 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(formatTime(second), xAt(second), height - 2);
    });

    function plot(line, strokeStyle, dashed, limit) {
      ctx.save();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = dashed ? 1.5 : 2.25;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash(dashed ? [6, 5] : []);
      ctx.beginPath();
      for (let index = 0; index <= limit; index += 1) {
        const x = xAt(index);
        const y = yAt(line[index]);
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    if (expected) plot(expected, '#a8a29e', true, Math.min(TOTAL_SECONDS, position));
    plot(data, color, false, position);

    const cursorX = xAt(position);
    ctx.strokeStyle = color;
    ctx.globalAlpha = .38;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cursorX, pad.top);
    ctx.lineTo(cursorX, pad.top + plotHeight);
    ctx.stroke();
    ctx.globalAlpha = 1;

    const cursorY = yAt(data[position]);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cursorX, cursorY, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function init() {
    const normalCanvas = document.getElementById('normalChart');
    const anomalyCanvas = document.getElementById('anomalyChart');
    if (!normalCanvas || !anomalyCanvas) return;

    const series = createSeries();
    const elements = {
      clock: document.getElementById('demoClock'),
      normalPower: document.getElementById('normalPower'),
      anomalyPower: document.getElementById('anomalyPower'),
      normalBadge: document.getElementById('normalBadge'),
      anomalyBadge: document.getElementById('anomalyBadge'),
      anomalyCaption: document.getElementById('anomalyCaption'),
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
      drawChart(normalCanvas, series.normal, null, position, '#d95e12');
      drawChart(anomalyCanvas, series.anomaly, series.expected, position, '#b91c1c');
      elements.clock.textContent = formatTime(position);
      elements.normalPower.textContent = Math.round(series.normal[position]).toLocaleString('ko-KR');
      elements.anomalyPower.textContent = Math.round(series.anomaly[position]).toLocaleString('ko-KR');
      elements.scrubber.value = String(position);

      const usingAppliance = position >= USE_START && position < USE_END;
      const missed = position >= USE_END;
      elements.normalBadge.textContent = usingAppliance ? '전자레인지 사용 중' : '대기전력';
      elements.normalBadge.className = 'status-badge ' + (usingAppliance ? 'status-active' : 'status-normal');
      elements.anomalyBadge.textContent = missed ? '예상 사용 누락' : usingAppliance ? '변화 없음' : '대기전력';
      elements.anomalyBadge.className = 'status-badge ' + (missed ? 'status-alert' : 'status-waiting');
      elements.anomalyCaption.textContent = missed ? '루틴 누락 후보' : usingAppliance ? '기대 파형과 불일치' : '관찰 중';

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
      elements.play.textContent = playing ? 'Ⅱ 일시정지' : position >= TOTAL_SECONDS ? '↻ 다시 재생' : '▶ 시연 시작';
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

  window.RoutineDemo = { createSeries, formatTime, storyFor, constants: { TOTAL_SECONDS, USE_START, USE_END } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}());
