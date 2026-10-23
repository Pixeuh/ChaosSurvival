import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Progression } from '../src/story/progression.js';
import { resetGameToInitialState as resetSession } from '../src/story/reset-game.js';
import { createMusicToggle } from '../src/ui/music-toggle.js';
import { applyPlayerIdentity, playerIdentity, resetPlayerIdentity } from '../src/ui/player-identity.js';

const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url)));
const mainSource = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const electronMainSource = readFileSync(new URL('../electron/main.cjs', import.meta.url), 'utf8');

function extractResetFunction() {
  const start = mainSource.indexOf('async function resetGameToInitialState() {');
  const end = mainSource.indexOf('\nasync function setFullscreen', start);
  assert.notEqual(start, -1, 'main reset function exists');
  assert.notEqual(end, -1, 'main reset function has a clear boundary');
  return mainSource.slice(start, end);
}

test('the complete New Game reset rebuilds systems and launches level 1 without stale globals', async () => {
  const calls = [];
  const storage = {
    values: new Map(),
    get length() { return this.values.size; },
    getItem(key) { return this.values.get(key) ?? null; },
    setItem(key, value) { this.values.set(key, String(value)); },
    removeItem(key) { this.values.delete(key); },
    key(index) { return [...this.values.keys()][index] ?? null; },
  };
  const progression = new Progression(story, storage);
  progression.setPlayerIdentity({ nickname: 'StaleName', gender: 'female' });
  applyPlayerIdentity(progression.data.playerIdentity);
  progression.begin();
  progression.complete('arcade-1', { score: 123 });
  let nativeFullscreen = true;
  const manager = { clear: () => calls.push('windows.clear'), sequence: 8, z: 90 };
  const miniGameLauncher = { reset: () => calls.push('minigames.reset') };
  const notifications = { clear: () => calls.push('notifications.clear') };
  const audio = {
    muted: true,
    stop: () => calls.push('audio.stop'),
    setMuted(value) {
      this.muted = value;
      calls.push(`audio.muted:${value}`);
    },
  };
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      addEventListener() {},
      setAttribute() {},
    }),
  };
  let musicToggle;
  try {
    musicToggle = createMusicToggle({ querySelector: () => ({ append() {} }) }, audio);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
  const context = {
    resetPlayerIdentity,
    resettingGame: false,
    resetSession,
    progression,
    phase: 'menu',
    buddy: { setActive: () => calls.push('buddy.stop'), restore: () => calls.push('buddy.restore') },
    pauseGeneration: 0,
    frame: 1,
    cancelAnimationFrame() {},
    audio,
    musicToggle: {
      render: () => {
        musicToggle.render();
        calls.push('music-toggle.render');
      },
    },
    menuMusic: { stop: () => calls.push('music.stop'), start: () => calls.push('music.start') },
    cancelVictory() {},
    rules: { hide() {} },
    setStartMenuOpen() {},
    desktopIcons: { cancel() {}, reset: () => calls.push('icons.reset') },
    taskbarOrder: { cancel() {}, reset: () => calls.push('taskbar.reset') },
    manager,
    miniGameLauncher,
    notifications,
    action: () => {},
    secondaryAction: () => {},
    clearEffects() {},
    browser: { reset: () => calls.push('virtual-files.reset') },
    settings: {
      data: { fullscreen: false },
      reset() {
        this.data.fullscreen = false;
        calls.push('settings.reset');
      },
      update(values) {
        Object.assign(this.data, values);
        calls.push(`settings.update:${values.fullscreen}`);
      },
      defaults: { musicVolume: 0.5 },
    },
    messenger: {
      conversations: new Map([['old', {}]]),
      views: new Map([['old', {}]]),
      roster: {},
    },
    pixelgirlDialogue: {},
    activeDialogue: null,
    createConversation: () => ({ messages: [] }),
    conversation: null,
    state: { reset: () => calls.push('game-state.reset') },
    timeline: { reset: () => calls.push('timeline.reset') },
    director: { reset: () => calls.push('director.reset') },
    best: 99,
    syncOffset: 1,
    lastTime: 2,
    maxLateness: 3,
    lastLateness: 4,
    duration: 99,
    chart: { durationSeconds: 60 },
    arcadeSequenceId: 'old-sequence',
    story: { start: 'arcade-1' },
    arcadeReplay: true,
    ui: {
      best: { textContent: '000099' },
      desktop: {
        style: { backgroundImage: 'old' },
        classList: { remove: (...classes) => calls.push(`desktop.remove:${classes.join(',')}`) },
      },
    },
    desktopApplications: { instances: new Map([['old', {}]]) },
    startMenuOrder: { reset: () => calls.push('start-menu.reset') },
    renderDesktopFiles: () => calls.push('files.render'),
    previousVolume: 0.8,
    setVolume: (volume) => calls.push(`volume:${volume}`),
    menu: { syncSettings: () => calls.push('menu.sync') },
    renderStats: () => calls.push('stats.render'),
    window: { chaosWindow: { getFullscreen: async () => nativeFullscreen } },
    document: { fullscreenElement: null },
    continueFromMenu: () => {
      progression.begin();
      context.phase = 'playing';
      calls.push('level-1.start');
    },
  };

  await vm.runInNewContext(`'use strict'; ${extractResetFunction()}\nresetGameToInitialState();`, context);

  assert.deepEqual(progression.data.completed, []);
  assert.equal(progression.data.playerIdentity.nickname, 'Moi');
  assert.equal(playerIdentity.nickname, 'Moi');
  assert.equal(progression.data.started, true);
  assert.equal(progression.current.id, 'arcade-1');
  assert.equal(context.phase, 'playing');
  assert.equal(context.resettingGame, false);
  assert.equal(context.messenger.conversations.size, 0);
  assert.equal(context.messenger.views.size, 0);
  assert.equal(context.messenger.roster, null);
  assert.equal(context.manager.sequence, 0);
  assert.equal(context.manager.z, 10);
  assert.equal(context.desktopApplications.instances.size, 0);
  assert.equal(context.miniGameLauncher, miniGameLauncher);
  assert.equal(context.ui.desktop.style.backgroundImage, '');
  assert.ok(calls.includes('notifications.clear'));
  assert.ok(calls.includes('virtual-files.reset'));
  assert.ok(calls.includes('minigames.reset'));
  assert.ok(calls.includes('level-1.start'));
  assert.equal(context.settings.data.fullscreen, true, 'New Game preserves the active native fullscreen mode');
  assert.ok(calls.includes('settings.update:true'));
  assert.equal(calls.includes('fullscreen.reset'), false, 'New Game never toggles the window display mode');
  assert.equal(audio.muted, false);
  assert.ok(calls.includes('music-toggle.render'));
  assert.equal('notifiedMessages' in context, false);

  nativeFullscreen = false;
  context.phase = 'menu';
  calls.length = 0;
  await vm.runInNewContext(`'use strict'; ${extractResetFunction()}\nresetGameToInitialState();`, context);
  assert.equal(context.settings.data.fullscreen, false, 'New Game also preserves a voluntarily windowed state');
  assert.equal(calls.includes('fullscreen.reset'), false);
});

test('Electron creates Chaos Survival in native fullscreen while retaining fullscreen exit commands', () => {
  const options = electronMainSource.match(/new BrowserWindow\(\{([\s\S]*?)webPreferences:/)?.[1] ?? '';
  assert.match(options, /fullscreen:\s*true/);
  assert.match(electronMainSource, /window\.setFullScreen\(!window\.isFullScreen\(\)\)/);
});
