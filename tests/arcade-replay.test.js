import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import {
  recordArcadeCompletion,
  queueArcadeVictory,
  pendingArcadeVictory,
  acknowledgeArcadeVictory,
} from '../src/story/arcade.js';
import { runInNewContext } from 'node:vm';
import { mountDesktop, updateRhythmHud } from '../src/ui/desktop.js';
import { installDevelopmentVictoryShortcut } from '../src/dev/finish-shortcut.js';
import { celebrateVictory } from '../src/ui/victory.js';
const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url)));

test('victory survives restart and first contact waits for a saved acknowledgement', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.begin();
  queueArcadeVictory(progression, 'arcade-1', { score: 1200, closed: 12, newRecord: true });
  const reopened = new Progression(story, storage);
  let arrivals = 0;
  reopened.register('conversation', () => arrivals++);
  assert.equal(pendingArcadeVictory(reopened).score, 1200);
  assert.equal(arrivals, 0);
  assert.equal(acknowledgeArcadeVictory(reopened).firstCompletion, true);
  await reopened.enterCurrent();
  assert.equal(arrivals, 1);
  assert.equal(acknowledgeArcadeVictory(reopened), null);
  assert.equal(pendingArcadeVictory(new Progression(story, storage)), null);
  queueArcadeVictory(reopened, 'arcade-1', { score: 1400, closed: 14, newRecord: true });
  assert.equal(acknowledgeArcadeVictory(reopened).firstCompletion, false);
  assert.equal(arrivals, 1);
});

test('corrupt pending results and failed acknowledgement do not erase progression', () => {
  const progression = new Progression(story);
  progression.begin();
  progression.data.pendingVictory = { score: 'invalid' };
  assert.equal(pendingArcadeVictory(progression), null);
  queueArcadeVictory(progression, 'arcade-1', { score: 100, closed: 1, newRecord: false });
  const pending = structuredClone(progression.data.pendingVictory);
  progression.storage = {
    setItem() {
      throw new Error('disk full');
    },
  };
  assert.throws(() => acknowledgeArcadeVictory(progression));
  assert.deepEqual(progression.data.pendingVictory, pending);
});

test('victory never times out, both manual controls return once and cancellation returns nothing', (t) => {
  const previous = globalThis.document;
  const create = () => ({
    style: { setProperty() {} },
    classList: { toggle() {} },
    handlers: {},
    children: [],
    setAttribute() {},
    append(child) {
      this.children.push(child);
    },
    addEventListener(type, callback) {
      this.handlers[type] = callback;
    },
    focus() {},
    remove() {
      this.removed = true;
    },
    querySelector(selector) {
      this.elements ??= {};
      return (this.elements[selector] ??= create());
    },
  });
  globalThis.document = {
    createElement: create,
    addEventListener() {},
    removeEventListener() {},
    hidden: false,
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  for (const control of ['#victory-continue', '#victory-close']) {
    const desktop = create();
    const background = create();
    background.inert = false;
    desktop.append(background);
    let returns = 0;
    const cleanup = celebrateVictory(
      desktop,
      { score: 100, closed: 1 },
      { play() {} },
      () => returns++,
    );
    t.mock.timers.tick(60000);
    assert.equal(returns, 0);
    assert.equal(background.inert, true);
    const layer = desktop.children.at(-1);
    assert.notEqual(layer.removed, true);
    layer.querySelector(control).handlers.click();
    layer.querySelector(control).handlers.click();
    assert.equal(returns, 1);
    assert.equal(background.inert, false);
    cleanup();
    assert.equal(returns, 1);
  }
  let returned = false;
  celebrateVictory(create(), { score: 0, closed: 0 }, { play() {} }, () => {
    returned = true;
  })();
  assert.equal(returned, false);
});
test('first arcade success unlocks PixelGirl once; replays preserve every narrative field', () => {
  const progression = new Progression(story);
  progression.begin();
  assert.equal(recordArcadeCompletion(progression, 'arcade-1', { score: 100 }), true);
  progression.data.choices.push({ key: 'choice', choice: 'a', unselected: [{ id: 'b' }] });
  const saved = structuredClone(progression.data);
  for (let replay = 0; replay < 3; replay++)
    assert.equal(recordArcadeCompletion(progression, 'arcade-1', { score: 999 }), false);
  assert.deepEqual(progression.data, saved);
  assert.equal(progression.current.id, 'pixelgirl-hello');
  progression.complete('pixelgirl-hello');
  progression.complete('super-mega-game');
  const finished = structuredClone(progression.data);
  assert.equal(recordArcadeCompletion(progression, 'arcade-1', { score: 999 }), false);
  assert.deepEqual(progression.data, finished);
});

test('rhythm HUD follows the real phase through loading, pauses, results, desktop and replay', () => {
  const nodes = new Map();
  const classes = new Set();
  const root = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, {});
      return nodes.get(selector);
    },
    querySelectorAll() {
      return [];
    },
  };
  const ui = mountDesktop(root, 0);
  assert.doesNotMatch(root.innerHTML, /session-info|session-label|window-count|session-dot/);
  assert.match(root.innerHTML, /<header class="hud" hidden /);
  ui.desktop.classList = {
    toggle(name, enabled) {
      enabled ? classes.add(name) : classes.delete(name);
    },
  };
  // Execute the actual central phase transition without starting audio or Electron.
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const setter = main.match(/function setPhase\(next\) \{[\s\S]*?\n\}/)[0];
  let buddyActive;
  const context = {
    ui,
    updateRhythmHud,
    buddy: {
      setActive(active) {
        buddyActive = active;
      },
    },
  };
  runInNewContext(`let phase = 'idle'; ${setter}; this.transition = setPhase;`, context);
  // No transition can bypass the HUD update via a direct assignment.
  assert.deepEqual(main.match(/^[\t ]*phase = .*;/gm), ['  phase = next;']);
  for (const [phase, visible] of [
    ['menu', false],
    ['idle', false],
    ['loading', true],
    ['playing', true],
    ['paused', true],
    ['resuming', true],
    ['playing', true],
    ['ended', true],
    ['desktop', false],
    ['loading', true],
    ['playing', true],
    ['desktop', false],
    ['menu', false],
    ['ended', true],
    ['desktop', false],
    ['loading', true],
    ['idle', false],
  ]) {
    context.transition(phase);
    assert.equal(buddyActive, phase !== 'menu');
    assert.equal(ui.hud.hidden, !visible, phase);
    assert.equal(classes.has('rhythm-active'), visible, phase);
  }
});

test('development shortcut uses arcade victory and never duplicates results or starts PixelGirl early', async () => {
  const progression = new Progression(story);
  progression.begin();
  let keydown;
  let stops = 0;
  let celebrations = 0;
  let arrivals = 0;
  progression.register('conversation', () => arrivals++);
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const finish = main.match(/function finishGame\(won\) \{[\s\S]*?\n\}/)[0];
  const registration = main.match(
    /installDevelopmentVictoryShortcut\(document, \(\) => \{[\s\S]*?\n    \}\);/,
  )[0];
  const foregroundGroupConversation = main.match(
    /const foregroundGroupConversation = \(\) => \{[\s\S]*?\n    \};/,
  )[0];
  const context = {
    progression,
    queueArcadeVictory,
    installDevelopmentVictoryShortcut,
    miniGameLauncher: { active: null },
    browser: { currentPage: null },
    manager: { windows: new Map() },
    messenger: { conversations: new Map() },
    rules: { active: false },
    state: { score: 1200, closed: 12 },
    audio: {
      stop() {
        stops++;
      },
    },
    ui: {
      pauseButton: {},
      playfield: {},
      desktop: { classList: { remove() {} } },
      best: {},
    },
    debug: { render() {} },
    localStorage: { setItem() {} },
    document: {
      addEventListener(type, handler) {
        keydown = handler;
      },
    },
    cancelAnimationFrame() {},
    clearEffects() {},
    showArcadeVictory() {
      celebrations++;
    },
  };
  runInNewContext(
    `let phase = 'desktop', pauseGeneration = 0, frame = 0, best = 0;
    const BEST_SCORE_KEY = 'test'; const arcadeSequenceId = 'arcade-1';
    function setPhase(next) { phase = next; }
    ${finish}
    ${foregroundGroupConversation}
    ${registration}
    this.setPhase = setPhase;`,
    context,
  );
  const key = { key: 'D', ctrlKey: true, shiftKey: true, preventDefault() {} };
  keydown(key);
  assert.equal(stops, 0);
  context.setPhase('playing');
  keydown(key);
  assert.equal(stops, 1);
  assert.equal(celebrations, 1);
  assert.equal(pendingArcadeVictory(progression).score, 1200);
  assert.equal(arrivals, 0);
  keydown(key);
  assert.equal(celebrations, 1);
  assert.equal(acknowledgeArcadeVictory(progression).firstCompletion, true);
  await progression.enterCurrent();
  assert.equal(arrivals, 1);
  context.setPhase('paused');
  keydown(key);
  assert.equal(celebrations, 2);
  assert.equal(pendingArcadeVictory(progression).firstCompletion, false);
});
