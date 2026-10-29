import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { GameState } from '../src/game/state.js';
import { BeginnerDirector } from '../src/game/director.js';
import { Timeline, compileChart, isOnBeat } from '../src/game/timeline.js';
import { musicAt } from '../src/game/music.js';
import { WINDOW_TYPES } from '../src/config/popups.js';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const chart = JSON.parse(read('../src/config/chart.json'));
const music = JSON.parse(read('../src/config/music-lvl1.analysis.json'));
const main = read('../src/main.js');
const section = (start, end) => main.slice(main.indexOf(start), main.indexOf(end));
function harness() {
  const frames = new Map();
  let id = 0,
    windowId = 0;
  const node = () => ({
    hidden: false,
    disabled: false,
    style: { setProperty() {} },
    classList: { toggle() {}, remove() {}, add() {} },
  });
  const ctx = {
    state: new GameState(chart.gameplay),
    director: new BeginnerDirector(chart.gameplay),
    timeline: new Timeline(compileChart(chart, music)),
    chart,
    music,
    musicAt,
    isOnBeat,
    WINDOW_TYPES,
    selectMsnPopupIndex: () => 0,
    msnQuarterCounts: [0, 0, 0, 0],
    phase: 'playing',
    duration: chart.durationSeconds,
    lastTime: 0,
    syncOffset: 0,
    frame: 0,
    pauseGeneration: 0,
    toastUntil: 0,
    storyToastKind: null,
    storyToastContactId: null,
    wizzUntil: 0,
    sparkleUntil: -Infinity,
    lastLateness: null,
    maxLateness: 0,
    formatTime: (time) => String(time),
    audio: { time: 0, async pause() {}, async resume() {} },
    document: { hidden: false },
    ui: Object.fromEntries(
      [
        'desktop',
        'toast',
        'wizzLabel',
        'trackFill',
        'trackTime',
        'playfield',
        'modalLayer',
        'dialogAction',
        'dialogCopy',
      ].map((key) => [key, node()]),
    ),
    requestAnimationFrame: (fn) => {
      frames.set(++id, fn);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    renderStats() {},
    feedback() {},
    notify() {},
    wizz() {},
    debug: { render() {} },
    setPhase(next) {
      ctx.phase = next;
    },
    showDialog() {
      ctx.ui.modalLayer.hidden = false;
    },
    restartGame() {},
    finishGame(won) {
      ctx.phase = 'ended';
      ctx.won = won;
      frames.delete(ctx.frame);
    },
    manager: {
      windows: new Map(),
      reposition() {},
      spawn(type, entry) {
        this.windows.set(++windowId, { type, ...entry });
        return windowId;
      },
      close(id) {
        const entry = this.windows.get(id);
        if (!entry) return;
        this.windows.delete(id);
        ctx.api.closed({ ...entry, preview: Boolean(entry.preview) });
      },
    },
  };
  const closure = section(
    'const manager = new WindowManager(ui.playfield, ',
    '\nlet activeDialogue',
  )
    .replace('const manager = new WindowManager(ui.playfield, ', 'const closed = ')
    .replace(/\);\s*$/, ';');
  runInNewContext(
    `${closure}\n${section('function tick()', 'function renderStats()')}\n${section('async function pauseGame()', 'function finishGame(')}\nglobalThis.api={closed,tick,pauseGame,resumeGame};`,
    ctx,
  );
  return {
    ctx,
    frames,
    step(delta) {
      if (ctx.phase !== 'playing') return;
      ctx.audio.time += delta;
      frames.clear();
      ctx.api.tick();
      assert.ok(frames.size <= 1, 'only one arcade frame loop');
      assert.equal(
        ctx.state.open,
        [...ctx.manager.windows.values()].filter((item) => !item.preview).length,
        'pressure counts actual arcade windows only',
      );
    },
  };
}

test('closing arcade windows during application pause and resume never leaves phantom pressure', async () => {
  const { ctx, step, frames } = harness();
  step(0.04);
  ctx.manager.spawn('msn', { openedAt: 0 });
  ctx.state.spawn();
  await ctx.api.pauseGame();
  assert.equal(frames.size, 0);
  const before = ctx.state.chaos;
  ctx.ui.playfield.inert = false; // Existing application-open behavior.
  ctx.manager.close(1);
  assert.equal(ctx.state.open, 0);
  assert.equal(ctx.state.closed, 1);
  assert.ok(ctx.state.chaos <= before);
  const preview = ctx.manager.spawn('desktopapp', { preview: true });
  const score = ctx.state.score;
  ctx.manager.close(preview);
  assert.equal(ctx.state.score, score);
  ctx.manager.spawn('msn', { openedAt: 0 });
  ctx.state.spawn();
  const resume = ctx.api.resumeGame();
  assert.equal(ctx.phase, 'resuming');
  ctx.manager.close(3);
  await resume;
  assert.equal(ctx.state.open, 0);
  assert.equal(frames.size, 1);
  await Promise.all([ctx.api.resumeGame(), ctx.api.resumeGame()]);
  assert.equal(frames.size, 1);
  step(0.1);
  assert.equal(ctx.state.chaos, 0);
});

test('several minutes of complete runs with repeated application pauses preserve scheduling and victory', async () => {
  for (let run = 0; run < 4; run++) {
    const { ctx, step, frames } = harness();
    let pauses = 0;
    while (ctx.phase === 'playing') {
      step(0.04);
      if (ctx.manager.windows.size) {
        if (pauses < 10) {
          await ctx.api.pauseGame();
          const time = ctx.audio.time,
            chaos = ctx.state.chaos;
          ctx.ui.playfield.inert = false;
          for (const id of [...ctx.manager.windows.keys()]) ctx.manager.close(id);
          assert.equal(ctx.state.open, 0);
          assert.equal(ctx.audio.time, time);
          assert.ok(ctx.state.chaos <= chaos);
          await ctx.api.resumeGame();
          pauses++;
        } else for (const id of [...ctx.manager.windows.keys()]) ctx.manager.close(id);
      }
    }
    assert.equal(ctx.won, true);
    assert.ok(ctx.state.closed > 50);
    assert.equal(pauses, 10);
    assert.equal(frames.size, 0);
  }
  const { ctx, step } = harness();
  while (ctx.phase === 'playing') step(0.04); // Ignoring real windows still causes the normal defeat.
  assert.equal(ctx.won, false);
  assert.equal(ctx.state.chaos, 100);
});
