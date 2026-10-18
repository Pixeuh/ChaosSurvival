import test from 'node:test';
import assert from 'node:assert/strict';
import { StartMenuOrder, resolveStartMenuOrder } from '../src/ui/start-menu-order.js';
import { UserSettings } from '../src/settings.js';
import { mountDesktop } from '../src/ui/desktop.js';

test('Start menu application order stays fixed independently from its footer actions', () => {
  const root = { querySelector: () => ({}), querySelectorAll: () => [] };
  mountDesktop(root, 0);
  const html = root.innerHTML.slice(root.innerHTML.indexOf('id="start-menu"'));
  assert.doesNotMatch(html, /desktop-menu-play|Continuer \/ nouvelle partie/);
  assert.match(html, /id="start-menu-main"[\s\S]*?Menu principal/);
  assert.match(html, /id="start-menu-quit"[\s\S]*?Quitter le jeu/);
  assert.equal([...html.matchAll(/Menu principal/g)].length, 1);
  assert.doesNotMatch(html, /Fermer la session|Arrêter l'ordinateur/);
  const defaults = [
    ...html.matchAll(/data-start-app="([^"]+)"|data-system-app="([^"]+)"|id="menu-messenger"/g),
  ].map((match) => match[1] ?? match[2] ?? 'menu-messenger');
  assert.deepEqual(defaults, ['buddy', 'menu-messenger', 'browser', 'computer', 'folder', 'bin']);
  assert.equal([...html.matchAll(/id="menu-buddy"/g)].length, 1);
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  const preferences = new UserSettings(storage);
  assert.deepEqual(resolveStartMenuOrder(preferences.data.startMenuOrder, defaults), defaults);
  const custom = ['folder', 'menu-messenger', 'computer', 'buddy', 'bin'];
  preferences.update({ startMenuOrder: custom });
  const restored = new UserSettings(storage);
  assert.deepEqual(resolveStartMenuOrder(restored.data.startMenuOrder, defaults), [
    ...custom,
    'browser',
  ]);
  restored.reset();
  assert.deepEqual(resolveStartMenuOrder(restored.data.startMenuOrder, defaults), defaults);
});

test('saved start applications keep their order, ignore obsolete/duplicate IDs and append new applications', () => {
  assert.deepEqual(
    resolveStartMenuOrder(
      ['bin', 'removed', 'bin', 'messenger'],
      ['messenger', 'computer', 'bin', 'new-app'],
    ),
    ['bin', 'messenger', 'computer', 'new-app'],
  );
  assert.deepEqual(resolveStartMenuOrder(null, ['a', 'b']), ['a', 'b']);
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
  };
  const preferences = new UserSettings(storage);
  preferences.update({ startMenuOrder: ['bin', null, 'computer', 'bin'], musicVolume: 0.3 });
  assert.deepEqual(new UserSettings(storage).data.startMenuOrder, ['bin', 'computer']);
  assert.equal(new UserSettings(storage).data.musicVolume, 0.3);
});

test('start menu moves original buttons through fixed slots, distinguishes click/drag and cancels cleanly', (t) => {
  const previous = globalThis.document;
  const handlers = {};
  const element = (id) => ({
    dataset: id ? { startApp: id } : {},
    style: {},
    handlers: {},
    classList: { add() {}, remove() {} },
    addEventListener(type, fn) {
      this.handlers[type] = fn;
    },
    closest() {
      return this;
    },
    setAttribute() {},
    removeAttribute() {},
    cloneNode() {
      return element();
    },
    replaceWith(other) {
      const i = menu.children.indexOf(this);
      menu.children[i] = other;
    },
    remove() {
      menu.children.splice(menu.children.indexOf(this), 1);
    },
    getBoundingClientRect() {
      return { left: 0, top: menu.children.indexOf(this) * 40, width: 200, height: 40 };
    },
  });
  const fixed = element(),
    footer = element();
  const buttons = ['a', 'b', 'c'].map(element);
  const menu = {
    ...element(),
    children: [fixed, ...buttons, footer],
    querySelectorAll: () => buttons,
    append(item) {
      this.children.push(item);
    },
    setPointerCapture() {},
    hasPointerCapture: () => false,
    getBoundingClientRect: () => ({ top: 0, left: 0 }),
  };
  globalThis.document = {
    createComment: () => element(),
    addEventListener(type, fn) {
      handlers[type] = fn;
    },
  };
  t.after(() => {
    globalThis.document = previous;
  });
  const settings = {
    data: { startMenuOrder: ['c', 'a', 'b'] },
    update(value) {
      Object.assign(this.data, value);
    },
  };
  const controller = new StartMenuOrder(menu, settings);
  assert.deepEqual(controller.order(), ['c', 'a', 'b']);
  assert.equal(menu.children[0], fixed);
  assert.equal(menu.children[4], footer);
  const event = (button, x, y) => ({
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    target: button,
    preventDefault() {},
  });
  menu.handlers.pointerdown(event(buttons[2], 20, 60));
  handlers.pointermove(event(buttons[2], 22, 62));
  assert.equal(controller.drag.active, undefined);
  handlers.pointerup(event(buttons[2], 22, 62));
  assert.equal(controller.suppressClick, false);
  menu.handlers.pointerdown(event(buttons[2], 20, 60));
  handlers.pointermove(event(buttons[2], 20, 210));
  assert.deepEqual(controller.order(), ['a', 'b', 'c']);
  handlers.pointerup(event(buttons[2], 20, 210));
  assert.deepEqual(settings.data.startMenuOrder, ['a', 'b', 'c']);
  let stopped = false;
  menu.handlers.click({
    detail: 1,
    preventDefault() {},
    stopImmediatePropagation() {
      stopped = true;
    },
  });
  assert.equal(stopped, true);
  menu.handlers.pointerdown(event(buttons[2], 20, 140));
  handlers.pointermove(event(buttons[2], 20, 40));
  assert.deepEqual(controller.order(), ['c', 'a', 'b']);
  controller.cancel();
  assert.deepEqual(controller.order(), ['a', 'b', 'c']);
  assert.equal(menu.children[0], fixed);
  assert.equal(menu.children[4], footer);
  assert.equal(menu.children.length, 5);
  const stable = controller.order();
  menu.handlers.pointerdown(event(buttons[0], 20, 60));
  handlers.pointermove({ ...event(buttons[0], 20, 210), buttons: 0 });
  assert.deepEqual(controller.order(), stable);
  assert.equal(controller.drag, null, 'hover after a missed release never starts a drag');
  menu.handlers.pointerdown(event(buttons[0], 20, 60));
  handlers.pointermove({ ...event(buttons[0], 20, 210), buttons: 1 });
  handlers.pointermove({ ...event(buttons[0], 20, 10), buttons: 0 });
  assert.deepEqual(
    controller.order(),
    stable,
    'interrupted drags roll back without replacing preferences',
  );
  assert.deepEqual(settings.data.startMenuOrder, stable);
});
