import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MainMenu } from '../src/ui/main-menu.js';
import { Progression } from '../src/story/progression.js';
import { resetGameToInitialState } from '../src/story/reset-game.js';

const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url)));
const menuConfig = JSON.parse(readFileSync(new URL('../src/config/menu.json', import.meta.url)));
const STORAGE_KEY = 'chaos-survival-story-v1';

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
  };
}

function showInitialMenu(progression) {
  const elements = new Map();
  for (const selector of [
    '.menu-logo', '.menu-tagline', '#menu-play', '#menu-new-game', '#menu-options',
    '.menu-checkpoint', '.menu-status', '#option-music', '#music-output',
    '#option-effects', '#effects-output', '#option-fullscreen', '.menu-home',
    '.menu-options-panel',
  ]) {
    elements.set(selector, {
      hidden: false,
      textContent: '',
      setAttribute() {},
      focus() {},
    });
  }
  const menu = Object.assign(Object.create(MainMenu.prototype), {
    progression,
    settings: { data: { musicVolume: 0.5, effectsVolume: 0.75, fullscreen: false } },
    element: { hidden: true, dataset: {} },
    find: (selector) => elements.get(selector),
    syncDesktopIcons() {},
  });
  menu.show();
  return { menu, elements };
}

test('first menu show renders the configured labels with and without a saved game', () => {
  const fresh = new Progression(story, memoryStorage());
  const freshMenu = showInitialMenu(fresh);
  assert.equal(freshMenu.elements.get('#menu-play').textContent, menuConfig.labels.play);
  assert.equal(freshMenu.elements.get('#menu-options').textContent, menuConfig.labels.options);
  assert.equal(freshMenu.elements.get('#menu-new-game').textContent, menuConfig.labels.newGame);
  assert.equal(freshMenu.elements.get('#menu-new-game').hidden, true);
  assert.equal(freshMenu.menu.element.hidden, false);

  fresh.begin();
  const savedMenu = showInitialMenu(fresh);
  assert.equal(savedMenu.elements.get('#menu-play').textContent, menuConfig.labels.continue);
  assert.equal(savedMenu.elements.get('#menu-options').textContent, menuConfig.labels.options);
  assert.equal(savedMenu.elements.get('#menu-new-game').textContent, menuConfig.labels.newGame);
  assert.equal(savedMenu.elements.get('#menu-new-game').hidden, false);
  assert.equal(savedMenu.menu.element.hidden, false);
});

function menuFixture(t, actions = {}) {
  const previousDocument = globalThis.document;
  const listeners = new Map();
  const elements = new Map();
  const makeElement = (selector) => {
    const element = {
      selector,
      hidden: selector === '.menu-confirm-layer',
      inert: false,
      disabled: false,
      isConnected: true,
      textContent: '',
      addEventListener(type, callback) {
        const key = `${selector}:${type}`;
        const registered = listeners.get(key) ?? [];
        registered.push(callback);
        listeners.set(key, registered);
      },
      focus() {
        globalThis.document.activeElement = this;
      },
      click() {
        for (const callback of listeners.get(`${selector}:click`) ?? []) callback({ target: this });
      },
      querySelectorAll() {
        return [];
      },
    };
    elements.set(selector, element);
    return element;
  };
  const selectors = [
    '#menu-new-game',
    '#menu-confirm-yes',
    '#menu-confirm-no',
    '#menu-confirm-title',
    '.menu-confirm p',
    '.menu-confirm-layer',
    '.menu-shell',
    '.menu-status',
    '#menu-play',
  ];
  selectors.forEach(makeElement);
  const buttons = ['#menu-new-game', '#menu-confirm-yes', '#menu-confirm-no', '#menu-play'].map(
    (selector) => elements.get(selector),
  );
  const root = {
    hidden: false,
    querySelectorAll: () => buttons,
  };
  globalThis.document = { activeElement: elements.get('#menu-new-game') };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const menu = Object.create(MainMenu.prototype);
  Object.assign(menu, {
    element: root,
    actions,
    find: (selector) => elements.get(selector),
    busy: false,
  });
  menu.bindConfirmationEvents();
  return { menu, elements, listeners };
}

test('New Game confirmation closes immediately on No and reopens without duplicate handlers', (t) => {
  const progression = new Progression(story, memoryStorage());
  progression.begin();
  progression.complete('arcade-1', { score: 55 });
  const savedBeforeCancel = progression.storage.getItem(STORAGE_KEY);
  let resetCalls = 0;
  const { menu, elements, listeners } = menuFixture(t, {
    newGame: () => {
      resetCalls++;
      progression.newGame();
    },
  });

  elements.get('#menu-new-game').click();
  assert.equal(elements.get('.menu-confirm-layer').hidden, false);
  assert.equal(elements.get('#menu-confirm-title').textContent, 'Commencer une nouvelle partie ?');
  assert.equal(elements.get('.menu-confirm p').textContent,
    'Commencer une nouvelle partie ? Toute votre progression et vos modifications seront perdues.');
  elements.get('#menu-confirm-no').click();
  assert.equal(elements.get('.menu-confirm-layer').hidden, true);
  assert.equal(elements.get('.menu-shell').inert, false);
  assert.equal(globalThis.document.activeElement, elements.get('#menu-new-game'));
  assert.equal(resetCalls, 0);
  assert.equal(progression.storage.getItem(STORAGE_KEY), savedBeforeCancel);
  assert.equal(progression.current.id, 'pixelgirl-hello');

  elements.get('#menu-new-game').click();
  assert.equal(elements.get('.menu-confirm-layer').hidden, false);
  assert.equal(listeners.get('#menu-new-game:click').length, 1);
  assert.equal(listeners.get('#menu-confirm-no:click').length, 1);
  assert.equal(listeners.get('#menu-confirm-yes:click').length, 1);
  elements.get('#menu-confirm-no').click();
  assert.equal(elements.get('.menu-confirm-layer').hidden, true);
});

test('New Game confirmation closes before the asynchronous reset and launch action', async (t) => {
  const progression = new Progression(story, memoryStorage());
  progression.begin();
  progression.complete('arcade-1', { score: 55 });
  let releaseRebuild;
  let started = false;
  let finishLaunch;
  const rebuildGate = new Promise((resolve) => {
    releaseRebuild = resolve;
  });
  const launchComplete = new Promise((resolve) => {
    finishLaunch = resolve;
  });
  const { menu, elements } = menuFixture(t, {
    newGame: () => resetGameToInitialState({
      progression,
      stop: async () => {},
      rebuild: async () => rebuildGate,
      restart: () => {
        progression.begin();
        started = true;
        finishLaunch();
      },
    }),
  });

  elements.get('#menu-new-game').click();
  elements.get('#menu-confirm-yes').click();

  assert.equal(elements.get('.menu-confirm-layer').hidden, true);
  assert.equal(elements.get('.menu-shell').inert, false);
  assert.equal(menu.busy, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(progression.data.completed, []);
  assert.equal(progression.current.id, 'arcade-1');
  assert.equal(started, false);

  releaseRebuild();
  await launchComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(started, true);
  assert.equal(menu.busy, false);
  assert.equal(progression.data.started, true);
  assert.equal(progression.current.id, 'arcade-1');
});
