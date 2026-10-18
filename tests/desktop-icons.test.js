import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DesktopIcons,
  discardLegacyAutomaticPositions,
  groupIconCells,
  iconCellLeft,
  iconCellTop,
  rectanglesTouch,
  iconGrid,
  layoutIconCells,
  nearestIconCell,
  nearestFreeIconCell,
} from '../src/ui/desktop-icons.js';
import { Progression } from '../src/story/progression.js';
import { VirtualFilesystem, virtualFileId } from '../src/story/virtual-filesystem.js';
const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url)));
function memory() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('the arcade EXE keeps the legacy music shortcut position without changing other saved icon IDs', () => {
  assert.equal(
    DesktopIcons.prototype.id.call({}, { dataset: { shortcut: 'arcade' } }),
    'shortcut:music',
  );
  assert.equal(
    DesktopIcons.prototype.id.call({}, { dataset: { shortcut: 'computer' } }),
    'shortcut:computer',
  );
  assert.equal(
    DesktopIcons.prototype.id.call({}, { dataset: { fileId: 'smiley' } }),
    'file:smiley',
  );
});

test('context selection keeps a selected group and replaces it for an unselected target', () => {
  const makeButton = (shortcut) => ({
    dataset: { shortcut },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  });
  const first = makeButton('msn');
  const second = makeButton('browser');
  const outside = makeButton('windows-media-play');
  const icons = Object.create(DesktopIcons.prototype);
  Object.assign(icons, {
    selectedIds: new Set(['shortcut:msn', 'shortcut:browser']),
    buttons: () => [first, second, outside],
  });
  assert.deepEqual(icons.contextSelection(second), [first, second]);
  assert.deepEqual(icons.contextSelection(outside), [outside]);
  assert.deepEqual(icons.selectedIds, new Set(['shortcut:windows-media-play']));
});

test('removing a shortcut persists its tombstone, pins remaining positions and New Game restores defaults', () => {
  const storage = memory();
  const progression = new Progression(story, storage);
  const filesystem = new VirtualFilesystem(progression);
  const mediaExecutable = virtualFileId('media-files', 'media-play.exe');
  assert.equal(filesystem.exists(mediaExecutable), true);
  const icons = Object.create(DesktopIcons.prototype);
  Object.assign(icons, {
    progression,
    saved: {},
    cells: new Map([
      ['shortcut:computer', { col: 0, row: 0 }],
      ['shortcut:msn', { col: 0, row: 1 }],
      ['shortcut:browser', { col: 0, row: 2 }],
    ]),
    selectedIds: new Set(['shortcut:msn']),
    refresh() {},
  });
  const button = { dataset: { shortcut: 'msn' } };
  assert.equal(icons.remove(button), true);
  assert.deepEqual(progression.data.desktopIconsRemoved, ['shortcut:msn']);
  assert.deepEqual(progression.data.desktopIcons, {
    'shortcut:computer': { col: 0, row: 0, custom: true },
    'shortcut:msn': { col: 0, row: 1, custom: true },
    'shortcut:browser': { col: 0, row: 2, custom: true },
  });
  assert.equal(icons.selectedIds.has('shortcut:msn'), false);
  assert.equal(filesystem.exists(mediaExecutable), true, 'removing a launcher never removes its executable');
  const restored = new Progression(story, storage);
  assert.deepEqual(restored.data.desktopIconsRemoved, ['shortcut:msn']);
  assert.deepEqual(restored.data.desktopIcons, progression.data.desktopIcons);
  restored.newGame();
  assert.deepEqual(restored.data.desktopIconsRemoved, []);
  assert.equal(restored.data.desktopIcons, undefined);
});

test('removing multiple shortcuts persists them together without deleting their executable targets or system icons', () => {
  const storage = memory();
  const progression = new Progression(story, storage);
  const filesystem = new VirtualFilesystem(progression);
  const icons = Object.create(DesktopIcons.prototype);
  Object.assign(icons, {
    progression,
    saved: {},
    cells: new Map([
      ['shortcut:computer', { col: 0, row: 0 }],
      ['shortcut:msn', { col: 0, row: 1 }],
      ['shortcut:windows-media-play', { col: 0, row: 2 }],
    ]),
    selectedIds: new Set(['shortcut:computer', 'shortcut:msn', 'shortcut:windows-media-play']),
    refresh() {},
  });
  const computer = { dataset: { shortcut: 'computer' } };
  const messenger = { dataset: { shortcut: 'msn' } };
  const media = { dataset: { shortcut: 'windows-media-play' } };
  const messengerExecutable = virtualFileId('messenger-files', 'love-messenger.exe');
  const mediaExecutable = virtualFileId('media-files', 'media-play.exe');

  assert.equal(icons.removeMany([computer, messenger, media]), true);
  assert.deepEqual(progression.data.desktopIconsRemoved, [
    'shortcut:msn',
    'shortcut:windows-media-play',
  ]);
  assert.equal(icons.selectedIds.has('shortcut:msn'), false);
  assert.equal(icons.selectedIds.has('shortcut:windows-media-play'), false);
  assert.equal(filesystem.exists(messengerExecutable), true);
  assert.equal(filesystem.exists(mediaExecutable), true);
  const restored = new Progression(story, storage);
  assert.deepEqual(restored.data.desktopIconsRemoved, progression.data.desktopIconsRemoved);
  restored.newGame();
  assert.deepEqual(restored.data.desktopIconsRemoved, []);
});

test('desktop icons fill the first column before the next and preserve existing custom cells', () => {
  const ids = ['computer', 'folder', 'msn', 'music', 'bin', 'game'];
  const grid = iconGrid(1280, 800);
  const first = layoutIconCells(ids, {}, grid);
  assert.deepEqual(first.get('game'), { col: 0, row: 5 });
  assert.deepEqual(layoutIconCells(ids, {}, iconGrid(800, 600)).get('game'), { col: 1, row: 0 });
  const saved = Object.fromEntries(first);
  saved.music = { col: 3, row: 2 };
  const withNew = layoutIconCells([...ids, 'new-file'], saved, grid);
  for (const id of ids) assert.deepEqual(withNew.get(id), saved[id]);
  assert.deepEqual(withNew.get('new-file'), { col: 0, row: 3 });
});

test('file shortcuts use a free drop cell, persist a distinct target link, deduplicate, and delete only the link', (t) => {
  const oldDocument = globalThis.document;
  const background = { closest: () => null };
  globalThis.document = { elementFromPoint: () => background };
  t.after(() => {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  });
  const storage = memory();
  const progression = new Progression(story, storage);
  const filesystem = new VirtualFilesystem(progression);
  const targetId = virtualFileId('my-games', 'ChaosSurvival.exe');
  const nav = { children: [] };
  const desktop = {
    inert: false,
    contains: () => true,
    append(element) { element.parentNode = this; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    querySelector: (selector) => selector === '.taskbar' ? { getBoundingClientRect: () => ({ top: 760 }) } : null,
  };
  const occupied = new Map([
    ['shortcut:computer', { col: 0, row: 1 }],
    ['shortcut:folder', { col: 0, row: 2 }],
  ]);
  const icons = Object.create(DesktopIcons.prototype);
  Object.assign(icons, {
    desktop, progression, virtualFilesystem: filesystem, saved: {}, cells: occupied,
    grid: iconGrid(1280, 800), selectedIds: new Set(),
    refresh() {}, buttons: () => nav.children, select(button) { this.selected = button; },
    onShortcutsChanged() {
      const shortcut = {
        dataset: { fileId: targetId, shortcutId: progression.data.desktopShortcuts[0].id },
        style: {}, hidden: false,
        setAttribute() {},
        classList: { contains: (name) => name === 'desktop-virtual-shortcut' },
      };
      nav.children.splice(0, nav.children.length, shortcut);
    },
  });
  const nearest = nearestFreeIconCell(30, 30, icons.grid, new Set(['0:0', '0:1', '0:2']));
  assert.notDeepEqual(nearest, { col: 0, row: 0 });
  const created = icons.createFileShortcut(targetId, 240, 200);
  assert.equal(created.ok, true);
  assert.equal(filesystem.exists(targetId), true, 'creating a shortcut leaves its target in My Games');
  assert.deepEqual(progression.data.desktopShortcuts, [created.shortcut]);
  assert.deepEqual(progression.data.desktopIcons['shortcut:computer'], { col: 0, row: 1, custom: true });
  assert.deepEqual(progression.data.desktopIcons['shortcut:folder'], { col: 0, row: 2, custom: true });
  assert.equal(progression.data.desktopIcons[`shortcut:${created.shortcut.id}`].custom, true);
  assert.deepEqual(icons.createFileShortcut(targetId, 240, 200), { ok: true, existing: true });
  assert.equal(nav.children.length, 1, 'repeated drops reuse the existing shortcut');
  const otherTarget = virtualFileId('music', 'Sport Dubstep.mp3');
  globalThis.document.elementFromPoint = () => ({ closest: (selector) => selector.includes('.popup') ? {} : null });
  assert.deepEqual(icons.createFileShortcut(otherTarget, 300, 240), { ok: false, reason: 'invalid-drop' });
  assert.equal(progression.data.desktopShortcuts.length, 1, 'dropping on another window creates nothing');

  const restored = new Progression(story, storage);
  assert.deepEqual(restored.data.desktopShortcuts, [created.shortcut]);
  const restoredFs = new VirtualFilesystem(restored);
  const shortcutButton = nav.children[0];
  const restoredIcons = Object.create(DesktopIcons.prototype);
  Object.assign(restoredIcons, {
    progression: restored, saved: restored.data.desktopIcons, cells: occupied,
    selectedIds: new Set(), refresh() {},
  });
  assert.equal(restoredIcons.remove(shortcutButton), true);
  assert.equal(restoredFs.exists(targetId), true, 'deleting the shortcut never deletes its EXE');
  assert.deepEqual(restored.data.desktopShortcuts, []);
  assert.ok(restored.data.desktopIconsRemoved.includes(`shortcut:${created.shortcut.id}`));
  const afterDelete = new Progression(story, storage);
  assert.deepEqual(afterDelete.data.desktopIconsRemoved, restored.data.desktopIconsRemoved);
  afterDelete.newGame();
  assert.deepEqual(afterDelete.data.desktopShortcuts, []);
  assert.deepEqual(afterDelete.data.desktopIconsRemoved, []);
});

test('desktop columns use one even pitch and keep the right margin at each width', () => {
  const iconWidth = 100;
  const grid = iconGrid(1340, 800, 40, 90, iconWidth);
  assert.equal(grid.cols, 11);
  assert.equal(iconGrid(1320, 800, 40, 90, iconWidth).cols, 11);
  const cell = nearestIconCell(1340, 20, grid);
  assert.deepEqual(cell, { col: 10, row: 0 });
  const left = iconCellLeft(cell, grid, 1340, iconWidth);
  assert.equal(left + iconWidth, 1320);
  assert.equal(1340 - (left + iconWidth), 20);
  for (let col = 1; col < grid.cols; col++)
    assert.equal(
      iconCellLeft({ col, row: 0 }, grid, 1340, iconWidth) -
        iconCellLeft({ col: col - 1, row: 0 }, grid, 1340, iconWidth),
      grid.step,
    );
  assert.deepEqual(
    groupIconCells(new Map([['icon', { col: 9, row: 0 }]]), ['icon'], { col: 1, row: 0 }, grid),
    new Map([['icon', { col: 10, row: 0 }]]),
  );
});

test('right-anchored saved cells follow the last column across resize without moving left-anchored cells', () => {
  const saved = {
    left: { col: 0, row: 0 },
    right: { col: 7, row: 1, edge: 'right' },
  };
  for (const cols of [11, 6, 13, 6, 13]) {
    const cells = layoutIconCells(['left', 'right'], saved, { cols, rows: 5 });
    assert.deepEqual(cells.get('left'), { col: 0, row: 0 });
    assert.deepEqual(cells.get('right'), { col: cols - 1, row: 1 });
    assert.equal(new Set([...cells.values()].map(JSON.stringify)).size, 2);
  }
});

test('right-anchored columns use the same even grid pitch and keep a constant right margin', () => {
  for (const width of [800, 1280, 1600]) {
    const grid = iconGrid(width, 800, 40, 90, 100);
    const last = { col: grid.cols - 1, row: 0 };
    const previous = { col: grid.cols - 2, row: 0 };
    assert.equal(iconCellLeft(last, grid, width, 100, 'right'), width - 120);
    assert.equal(width - (iconCellLeft(last, grid, width, 100, 'right') + 100), 20);
    assert.ok(
      Math.abs(
        iconCellLeft(last, grid, width, 100, 'right') -
          iconCellLeft(previous, grid, width, 100) -
          grid.step,
      ) < 1e-9,
      'adjacent columns keep the same pitch within floating-point precision',
    );
    assert.equal(iconCellLeft(last, grid, width, 100, 'right'), width - 120);
  }
});

test('the bin defaults to top left while personal and legacy saved positions remain intact', () => {
  const ids = [
    'shortcut:computer',
    'shortcut:folder',
    'shortcut:msn',
    'shortcut:music',
    'shortcut:bin',
  ];
  const grid = iconGrid(1280, 800, 36, 78);
  const fresh = layoutIconCells(ids, {}, grid);
  assert.deepEqual(fresh.get('shortcut:bin'), { col: 0, row: 0 });
  assert.deepEqual(fresh.get('shortcut:computer'), { col: 0, row: 1 });
  assert.equal(
    new Set([...fresh.values()].map((cell) => `${cell.col}:${cell.row}`)).size,
    ids.length,
  );
  const saved = Object.fromEntries(fresh);
  saved['shortcut:bin'] = { col: 2, row: 3 };
  assert.deepEqual(layoutIconCells(ids, saved, grid).get('shortcut:bin'), saved['shortcut:bin']);
  const legacy = Object.fromEntries(ids.map((id, row) => [id, { col: 0, row }]));
  assert.deepEqual(Object.fromEntries(layoutIconCells(ids, legacy, grid)), legacy);
});

test('a fresh desktop lays out the seven launch icons in the requested visual order', () => {
  const ids = [
    'shortcut:computer',
    'shortcut:folder',
    'shortcut:msn',
    'shortcut:browser',
    'shortcut:windows-media-play',
    'shortcut:music',
    'shortcut:bin',
  ];
  const grid = iconGrid(1280, 800, 40, 90, 100);
  const cells = layoutIconCells(ids, {}, grid);
  const expected = [
    'shortcut:bin',
    'shortcut:computer',
    'shortcut:folder',
    'shortcut:msn',
    'shortcut:browser',
    'shortcut:windows-media-play',
    'shortcut:music',
  ];
  assert.equal(grid.rows, 7, 'the initial 1280×800 desktop fits seven icon rows');
  expected.forEach((id, row) => {
    assert.deepEqual(cells.get(id), { col: 0, row });
    assert.equal(iconCellTop(cells.get(id)), 20 + row * 104);
  });
  assert.equal(new Set([...cells.values()].map(({ col, row }) => `${col}:${row}`)).size, 7);

  const withNarrativeFile = layoutIconCells([...ids, 'file:media-files/bombarena.exe'], {}, grid);
  assert.deepEqual(withNarrativeFile.get('file:media-files/bombarena.exe'), { col: 1, row: 0 });
  for (const id of expected) assert.deepEqual(withNarrativeFile.get(id), cells.get(id));

  const shortGrid = layoutIconCells(ids, {}, { cols: 4, rows: 5 });
  assert.equal(new Set([...shortGrid.values()].map(({ col, row }) => `${col}:${row}`)).size, 7);
  assert.ok([...shortGrid.values()].every(({ col, row }) => col < 4 && row < 5));
});

test('DesktopIcons applies the initial cells as actual aligned CSS coordinates', (t) => {
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} };
  t.after(() => { globalThis.ResizeObserver = previous; });
  const shortcuts = ['computer', 'folder', 'msn', 'browser', 'windows-media-play', 'arcade', 'bin'];
  const buttons = shortcuts.map((shortcut) => ({
    dataset: { shortcut },
    style: {},
    attrs: {},
    offsetWidth: 100,
    offsetHeight: 90,
    classList: { add() {}, remove() {} },
    setAttribute(name, value) { this.attrs[name] = value; },
    closest() { return this; },
    setPointerCapture() {},
    hasPointerCapture() { return false; },
  }));
  const desktop = {
    classList: { add() {} },
    addEventListener() {},
    querySelectorAll: () => buttons,
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 40, top: 760 }) }),
    getBoundingClientRect: () => ({ width: 1280, height: 800, top: 0 }),
  };
  const progression = new Progression(story, { getItem: () => null, setItem() {} });
  new DesktopIcons(desktop, progression);
  const order = ['bin', 'computer', 'folder', 'msn', 'browser', 'windows-media-play', 'arcade'];
  const orderedButtons = order.map((name) => buttons.find(({ dataset }) => dataset.shortcut === name));
  assert.deepEqual(orderedButtons.map(({ style }) => style.top), order.map((_, row) => `${20 + row * 104}px`));
  assert.equal(new Set(orderedButtons.map(({ style }) => style.left)).size, 1);
});

test('legacy automatic icon cells migrate to the new order while custom and new-game positions behave correctly', () => {
  const oldAuto = Object.fromEntries([
    ['shortcut:bin', { col: 0, row: 0 }],
    ['shortcut:computer', { col: 0, row: 1 }],
    ['shortcut:folder', { col: 0, row: 2 }],
    ['shortcut:msn', { col: 0, row: 3 }],
    ['shortcut:browser', { col: 0, row: 6 }],
    ['shortcut:windows-media-play', { col: 0, row: 4 }],
    ['shortcut:music', { col: 0, row: 5 }],
  ]);
  oldAuto['shortcut:browser'] = { col: 2, row: 2, custom: true };
  assert.equal(discardLegacyAutomaticPositions(oldAuto), true);
  assert.deepEqual(oldAuto, { 'shortcut:browser': { col: 2, row: 2, custom: true } });

  const grid = iconGrid(1280, 800, 40, 90, 100);
  const expectedOrder = [
    'shortcut:bin', 'shortcut:computer', 'shortcut:folder', 'shortcut:msn',
    'shortcut:browser', 'shortcut:windows-media-play', 'shortcut:music',
  ];
  const ids = [...expectedOrder];
  const savedGame = { 'shortcut:music': { col: 3, row: 4, custom: true } };
  const personalized = layoutIconCells(ids, savedGame, grid);
  assert.deepEqual(personalized.get('shortcut:music'), { col: 3, row: 4 });
  assert.deepEqual(personalized.get('shortcut:windows-media-play'), { col: 3, row: 3 });

  const progression = new Progression(story, { getItem: () => null, setItem() {} });
  progression.data.desktopIcons = savedGame;
  progression.newGame();
  assert.equal(progression.data.desktopIcons, undefined);
  const reset = layoutIconCells(ids, progression.data.desktopIcons ?? {}, grid);
  assert.deepEqual(expectedOrder.map((id) => reset.get(id)), expectedOrder.map((_, row) => ({ col: 0, row })));
});

test('the final grid row fits real icon heights above the taskbar at every resolution', () => {
  for (const height of [480, 600, 650, 768, 800, 1080])
    for (const iconHeight of [62, 78, 90]) {
      const grid = iconGrid(1280, height, 36, iconHeight);
      const bottom = 20 + (grid.rows - 1) * 104 + iconHeight;
      assert.ok(bottom <= height - 36);
      assert.ok(bottom + 104 > height - 36, 'another complete row would overlap the taskbar');
      assert.equal(nearestIconCell(20, height, grid).row, grid.rows - 1);
    }
  assert.equal(iconGrid(1280, 800, 36, 90).rows, 7);
});
test('temporarily out-of-bounds icons never displace valid personalized cells during resize', () => {
  const saved = { a: { col: 0, row: 6 }, b: { col: 0, row: 3 }, c: { col: 1, row: 0 } };
  const small = layoutIconCells(['a', 'b', 'c'], saved, { cols: 3, rows: 4 });
  assert.deepEqual(small.get('b'), saved.b);
  assert.deepEqual(small.get('c'), saved.c);
  assert.notDeepEqual(small.get('a'), saved.b);
  assert.deepEqual(
    Object.fromEntries(layoutIconCells(['a', 'b', 'c'], saved, { cols: 3, rows: 7 })),
    saved,
  );
});

test('corrupt or colliding positions and resolution changes produce distinct bounded cells', () => {
  const saved = {
    a: { col: 99, row: 99 },
    b: { col: 99, row: 99 },
    c: { row: -1, col: 1 },
    d: 'oops',
  };
  const grid = iconGrid(800, 600);
  const result = layoutIconCells(['a', 'b', 'c', 'd'], saved, grid);
  assert.equal(new Set([...result.values()].map(JSON.stringify)).size, 4);
  for (const cell of result.values()) {
    assert.ok(cell.col >= 0 && cell.col < grid.cols && cell.row >= 0 && cell.row < grid.rows);
  }
  assert.deepEqual(nearestIconCell(-500, 10000, grid), { col: 0, row: grid.rows - 1 });
  assert.deepEqual(saved.a, { col: 99, row: 99 });
});

test('dragging snaps, persists, rejects occupied cells, suppresses accidental clicks and restores after resize', (t) => {
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
  };
  t.after(() => {
    globalThis.ResizeObserver = previous;
  });
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.begin();
  const buttons = ['computer', 'folder', 'msn', 'music', 'bin'].map((name) => ({
    dataset: { shortcut: name },
    style: {},
    attrs: {},
    offsetWidth: 100,
    offsetHeight: 90,
    classList: { add() {}, remove() {} },
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
    closest() {
      return this;
    },
    setPointerCapture() {},
    hasPointerCapture() {
      return false;
    },
  }));
  const handlers = {};
  const desktop = {
    width: 1280,
    classList: {
      add() {},
      contains(name) {
        return name === 'story-desktop';
      },
    },
    addEventListener(type, callback) {
      handlers[type] = callback;
    },
    querySelectorAll() {
      return buttons;
    },
    querySelector() {
      return {
        getBoundingClientRect() {
          return { height: 40, top: 760 };
        },
      };
    },
    getBoundingClientRect() {
      return { width: this.width, height: 800, top: 0 };
    },
  };
  const icons = new DesktopIcons(desktop, progression);
  const button = buttons[3];
  let nativeDragPrevented = false;
  handlers.dragstart({
    target: button,
    preventDefault() {
      nativeDragPrevented = true;
    },
  });
  assert.equal(nativeDragPrevented, true);
  const event = (x, y) => ({
    target: button,
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    preventDefault() {},
  });
  const initialY = parseFloat(button.style.top) + 10;
  handlers.pointerdown(event(30, initialY));
  handlers.pointermove(event(32, initialY + 2));
  assert.equal(icons.drag.moved, false);
  handlers.pointermove(event(270, 134));
  assert.match(button.style.transform, /translate/);
  handlers.pointerup(event(270, 134));
  assert.deepEqual(progression.data.desktopIcons['shortcut:music'], { col: 2, row: 1, custom: true });
  let blocked = false;
  handlers.dblclick({
    target: button,
    preventDefault() {},
    stopImmediatePropagation() {
      blocked = true;
    },
  });
  assert.equal(blocked, true);
  handlers.pointerdown(event(270, 134));
  handlers.pointermove(event(30, 30));
  handlers.pointerup(event(30, 30));
  assert.deepEqual(progression.data.desktopIcons['shortcut:music'], { col: 2, row: 1, custom: true });
  assert.equal(button.attrs['aria-pressed'], 'true');
  handlers.pointerdown(event(270, 134));
  handlers.pointerup(event(270, 134));
  blocked = false;
  handlers.dblclick({
    target: button,
    stopImmediatePropagation() {
      blocked = true;
    },
  });
  assert.equal(blocked, false);
  assert.deepEqual(new Progression(story, storage).data.desktopIcons['shortcut:music'], {
    col: 2,
    row: 1,
    custom: true,
  });
  desktop.width = 240;
  icons.refresh();
  assert.equal(new Set([...icons.cells.values()].map(JSON.stringify)).size, buttons.length);
  desktop.width = 1280;
  icons.refresh();
  assert.equal(button.style.left, `${20 + icons.cells.get('shortcut:music').col * icons.grid.step}px`);
  assert.equal(button.style.top, '124px');

  handlers.pointerdown(event(270, 134));
  const rightmostDropX =
    270 +
    (icons.grid.cols - 1 - icons.cells.get('shortcut:music').col) *
      icons.grid.step +
    icons.grid.step / 2;
  handlers.pointermove(event(rightmostDropX, 134));
  handlers.pointerup(event(rightmostDropX, 134));
  assert.deepEqual(progression.data.desktopIcons['shortcut:music'], {
    col: icons.grid.cols - 1,
    row: 1,
    edge: 'right',
    custom: true,
  });
  for (const width of [1600, 800, 1600]) {
    desktop.width = width;
    icons.refresh();
    assert.equal(icons.cells.get('shortcut:music').col, icons.grid.cols - 1);
    assert.equal(icons.cells.get('shortcut:computer').col, 0);
    assert.equal(new Set([...icons.cells.values()].map(JSON.stringify)).size, buttons.length);
    assert.ok(parseFloat(button.style.left) + button.offsetWidth <= width);
    assert.equal(parseFloat(button.style.left), width - 120);
  }
  const reloaded = new Progression(story, storage);
  const restored = layoutIconCells(
    buttons.map((item) => `shortcut:${item.dataset.shortcut}`),
    reloaded.data.desktopIcons,
    icons.grid,
  );
  assert.equal(restored.get('shortcut:music').col, icons.grid.cols - 1);
});

test('group moves preserve relative cells and reject occupied and out-of-bounds destinations', () => {
  const cells = new Map([
    ['a', { col: 0, row: 0 }],
    ['b', { col: 0, row: 1 }],
    ['other', { col: 2, row: 2 }],
  ]);
  const moved = groupIconCells(cells, ['a', 'b'], { col: 1, row: 1 }, { cols: 5, rows: 5 });
  assert.deepEqual(moved.get('a'), { col: 1, row: 1 });
  assert.deepEqual(moved.get('b'), { col: 1, row: 2 });
  assert.equal(groupIconCells(cells, ['a', 'b'], { col: 2, row: 1 }, { cols: 5, rows: 5 }), null);
  assert.equal(groupIconCells(cells, ['a', 'b'], { col: -1, row: 0 }, { cols: 5, rows: 5 }), null);
  assert.deepEqual(cells.get('a'), { col: 0, row: 0 });
  assert.equal(
    rectanglesTouch(
      { left: 0, top: 0, right: 10, bottom: 10 },
      { left: 10, top: 10, right: 20, bottom: 20 },
    ),
    true,
  );
});

test('empty-area dragging selects icons without moving them and clears the box on release', (t) => {
  const previousObserver = globalThis.ResizeObserver,
    previousDocument = globalThis.document;
  globalThis.ResizeObserver = class {
    observe() {}
  };
  globalThis.document = {
    createElement() {
      return {
        style: {},
        setAttribute() {},
        remove() {
          this.removed = true;
        },
      };
    },
  };
  t.after(() => {
    globalThis.ResizeObserver = previousObserver;
    globalThis.document = previousDocument;
  });
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.begin();
  const buttons = ['computer', 'folder', 'msn'].map((name) => ({
    dataset: { shortcut: name },
    style: {},
    attrs: {},
    offsetWidth: 100,
    offsetHeight: 90,
    classList: { add() {}, remove() {} },
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
    closest(selector) {
      return selector.includes('[data-shortcut]') || selector.includes('.desktop-icons')
        ? this
        : null;
    },
    setPointerCapture() {},
    hasPointerCapture() {
      return false;
    },
    getBoundingClientRect() {
      const left = parseFloat(this.style.left),
        top = parseFloat(this.style.top);
      return { left, top, right: left + 100, bottom: top + 90 };
    },
  }));
  let phaseClass = 'story-desktop';
  const desktop = {
    children: [],
    classList: {
      add() {},
      contains(name) {
        return name === phaseClass;
      },
    },
    closest() {
      return null;
    },
    addEventListener() {},
    querySelectorAll() {
      return buttons;
    },
    append(item) {
      this.children.push(item);
    },
    querySelector() {
      return {
        getBoundingClientRect() {
          return { height: 40, top: 760 };
        },
      };
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 1280, width: 1280, height: 800 };
    },
  };
  const icons = new DesktopIcons(desktop, progression);
  let prevented = false;
  const event = (x, y, target = desktop) => ({
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
    target,
    preventDefault() {
      prevented = true;
    },
  });
  const saved = JSON.stringify(progression.data.desktopIcons);
  icons.down(event(5, 5));
  assert.equal(prevented, true, 'empty-area selection prevents native browser dragging');
  icons.move(event(8, 8));
  assert.equal(desktop.children.length, 0);
  icons.move(event(125, 216));
  assert.equal(buttons[0].attrs['aria-pressed'], 'true');
  assert.equal(buttons[1].attrs['aria-pressed'], 'true');
  assert.equal(buttons[2].attrs['aria-pressed'], 'false');
  const box = desktop.children[0];
  icons.up(event(125, 216));
  assert.equal(box.removed, true);
  assert.equal(icons.selectedIds.size, 2);
  assert.equal(JSON.stringify(progression.data.desktopIcons), saved);
  icons.down(event(40, 40, buttons[0]));
  icons.move(event(160, 40, buttons[0]));
  icons.up(event(160, 40, buttons[0]));
  assert.deepEqual(progression.data.desktopIcons['shortcut:computer'], { col: 1, row: 0, custom: true });
  assert.deepEqual(progression.data.desktopIcons['shortcut:folder'], { col: 1, row: 1, custom: true });
  phaseClass = 'rhythm-active';
  icons.select(buttons[0]);
  icons.down(event(160, 40, buttons[0]));
  icons.move(event(280, 40, buttons[0]));
  icons.up(event(280, 40, buttons[0]));
  assert.deepEqual(progression.data.desktopIcons['shortcut:computer'], { col: 2, row: 0, custom: true });
  phaseClass = 'story-desktop';
  const restored = new Progression(story, storage);
  assert.deepEqual(restored.data.desktopIcons['shortcut:computer'], { col: 2, row: 0, custom: true });
  assert.deepEqual(restored.data.desktopIcons['shortcut:folder'], { col: 1, row: 1, custom: true });
  assert.equal(icons.selectedIds.size, 1);
  icons.down(event(500, 500));
  icons.up(event(500, 500));
  assert.equal(icons.selectedIds.size, 0);
  assert.ok(buttons.every((button) => button.attrs['aria-pressed'] === 'false'));
  phaseClass = 'rhythm-active';
  icons.down(event(130, 5));
  icons.move(event(246, 216));
  assert.equal(icons.selectedIds.size, 1);
  const rhythmicBox = desktop.children.at(-1);
  icons.move(event(250, 900));
  assert.equal(parseFloat(rhythmicBox.style.top) + parseFloat(rhythmicBox.style.height), 760);
  icons.up(event(250, 900));
  assert.equal(rhythmicBox.removed, true);
  const windowOrTask = { closest: () => null };
  icons.down(event(500, 500, windowOrTask));
  assert.equal(icons.rectangle, null);
  desktop.inert = true;
  icons.down(event(500, 500));
  assert.equal(icons.rectangle, null);
  desktop.inert = false;
  phaseClass = 'menu';
  desktop.inert = true;
  icons.down(event(500, 500));
  assert.equal(icons.rectangle, null);
});
