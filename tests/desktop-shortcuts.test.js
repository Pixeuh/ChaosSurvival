import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { VirtualFilesystem, virtualFileId } from '../src/story/virtual-filesystem.js';
import { DesktopApplications } from '../src/ui/desktop-apps.js';
import { DESKTOP_SHORTCUTS, ExecutableRegistry, VIRTUAL_EXECUTABLES } from '../src/ui/executable-registry.js';
import { DesktopFiles } from '../src/ui/desktop-files.js';
import { iconGrid, layoutIconCells } from '../src/ui/desktop-icons.js';

const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url)));
const storage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
  };
};

function newRun(savedStorage = storage()) {
  const progression = new Progression(story, savedStorage);
  progression.begin();
  return { progression, filesystem: new VirtualFilesystem(progression), storage: savedStorage };
}

test('the shared shortcut declarations fill Bureau, include Media Play and exclude installed programs without shortcuts', () => {
  const { filesystem } = newRun();
  const shortcuts = filesystem.getLocation('user-desktop').items.filter((item) => item.shortcut);
  assert.equal(new Set(DESKTOP_SHORTCUTS.map((item) => item.id)).size, DESKTOP_SHORTCUTS.length);
  for (const item of DESKTOP_SHORTCUTS.filter((shortcut) => shortcut.target && shortcut.action))
    assert.equal(VIRTUAL_EXECUTABLES[item.target], item.action, `${item.id} has one launch association`);
  assert.deepEqual(
    shortcuts.map((item) => item.shortcutId).sort(),
    DESKTOP_SHORTCUTS.filter((item) => !item.target || filesystem.exists(item.target))
      .map((item) => item.id).sort(),
  );
  const media = shortcuts.find((item) => item.shortcutId === 'media-player');
  assert.equal(filesystem.getLocation('user-desktop').address, 'C:\\Documents and Settings\\Joueur\\Bureau');
  assert.equal(media.name, 'Windows Media Play.lnk');
  assert.equal(media.targetFileId, virtualFileId('media-files', 'media-play.exe'));
  assert.equal(filesystem.exists(media.targetFileId), true);
  assert.equal(shortcuts.some((item) => item.targetFileId === virtualFileId('downloads', 'toolbar_setup.exe')), false);
  assert.equal(shortcuts.some((item) => ['computer', 'folder', 'bin'].includes(item.shortcutId)), false);
});

test('the actual new-game Bureau layout places Media Play directly above ChaosSurvival', () => {
  const { filesystem } = newRun();
  const shortcutIds = filesystem.getLocation('user-desktop').items
    .filter((item) => item.shortcut)
    .map((item) => `shortcut:${item.shortcutId === 'chaos-survival' ? 'music' : item.shortcutId}`);
  const ids = [
    'shortcut:computer', 'shortcut:folder', 'shortcut:bin',
    ...shortcutIds,
  ];
  const grid = iconGrid(1280, 800, 40, 90, 100);
  const cells = layoutIconCells(ids, {}, grid);
  assert.deepEqual(cells.get('shortcut:media-player'), { col: 0, row: 5 });
  assert.deepEqual(cells.get('shortcut:music'), { col: 0, row: 6 });
  assert.equal(new Set([...cells.values()].map((cell) => `${cell.col}:${cell.row}`)).size, ids.length);
});

test('Media Play launches through the same executable registry from desktop and Bureau and keeps one instance', () => {
  const { filesystem } = newRun();
  let opens = 0;
  const player = { navigation: 'unchanged' };
  const registry = new ExecutableRegistry(filesystem, {
    'media-player': () => { opens++; return player; },
  });
  const app = new DesktopApplications({}, null, () => {}, null, undefined, filesystem,
    () => {}, null, (fileId, options) => registry.launch(fileId, options), null,
    (shortcutId) => registry.launchShortcut(shortcutId));
  const media = filesystem.getLocation('user-desktop').items.find((item) => item.shortcutId === 'media-player');

  assert.equal(registry.launchShortcut('media-player').value, player);
  assert.equal(app.openFile(filesystem.getLocation('user-desktop'), media), player);
  assert.equal(opens, 2);
  assert.equal(player.navigation, 'unchanged');
});

test('shortcut removal synchronizes, persists without removing the target, and New Game restores defaults', () => {
  const savedStorage = storage();
  let { progression, filesystem } = newRun(savedStorage);
  const shortcutId = virtualFileId('user-desktop', 'windows media play.lnk');
  const targetId = virtualFileId('media-files', 'media-play.exe');

  assert.equal(filesystem.deleteFile(shortcutId).ok, true);
  assert.equal(filesystem.exists(shortcutId), false);
  assert.equal(filesystem.exists(targetId), true);
  progression = new Progression(story, savedStorage);
  filesystem = new VirtualFilesystem(progression);
  assert.equal(filesystem.exists(shortcutId), false, 'saved deletion survives reload');
  assert.equal(filesystem.exists(targetId), true);

  progression.newGame();
  filesystem = new VirtualFilesystem(progression);
  assert.equal(filesystem.exists(shortcutId), true, 'New Game restores the initial shortcut');
  assert.equal(filesystem.getLocation('user-desktop').items.filter((item) => item.shortcutId === 'media-player').length, 1);
});

test('desktop buttons and the open Bureau view use identical shortcut IDs and reflect Delete immediately', (t) => {
  const oldDocument = globalThis.document;
  globalThis.document = {
    createElement: () => ({
      dataset: {}, style: {}, children: [], handlers: {}, attrs: {},
      setAttribute(name, value) { this.attrs[name] = value; },
      addEventListener(type, fn) { this.handlers[type] = fn; },
      append(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
      closest() { return this; },
    }),
  };
  t.after(() => {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  });
  const { progression, filesystem } = newRun();
  const desktop = {
    children: [],
    querySelector: (selector) => selector === '#desktop-files' ? desktop.children[0] ?? null : null,
    append(item) { this.children.push(item); },
  };
  let explorerRefreshes = 0;
  const icons = new DesktopFiles(desktop, progression, () => {}, () => {}, filesystem, () => explorerRefreshes++);
  icons.render();
  const mediaId = virtualFileId('user-desktop', 'windows media play.lnk');
  const desktopMedia = desktop.children[0].children.find((item) => item.dataset.fileId === mediaId);
  const bureauMedia = filesystem.getLocation('user-desktop').items.find((item) => item.fileId === mediaId);
  assert.ok(desktopMedia);
  assert.equal(bureauMedia.shortcutId, desktopMedia.dataset.shortcut);

  let prevented = false;
  desktop.children[0].handlers.keydown({
    key: 'Delete', repeat: false, target: desktopMedia, preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(explorerRefreshes, 1);
  assert.equal(filesystem.exists(mediaId), false);
  icons.render();
  assert.equal(desktop.children[0].children.some((item) => item.dataset.fileId === mediaId), false);
  assert.equal(filesystem.exists(virtualFileId('media-files', 'media-play.exe')), true);
});

test('received desktop shortcuts mirror into Bureau and disappear when their target is deleted', () => {
  const { progression, filesystem } = newRun();
  const transfer = progression.receiveFile({ id: 'readme', name: 'readme.txt', description: 'Document' }, 'pixelgirl', 'offer');
  progression.finishTransfer(transfer.key);
  const shortcutId = virtualFileId('user-desktop', 'readme.txt.lnk');
  const targetId = virtualFileId('downloads', 'readme.txt');
  assert.equal(filesystem.exists(shortcutId), true);
  assert.equal(filesystem.getFile(shortcutId).targetFileId, targetId);
  assert.equal(filesystem.deleteFile(shortcutId).ok, true);
  assert.equal(filesystem.exists(shortcutId), false);
  assert.equal(filesystem.exists(targetId), true);
  assert.equal(filesystem.getLocation('user-desktop').items.some((item) => item.targetFileId === targetId), false);
});

test('BombArena shortcut is derived from its extracted EXE and system icons stay outside the folder', () => {
  const { progression, filesystem } = newRun();
  const archive = progression.receiveFile({
    id: 'bomb-arena', name: 'BombArena.zip', description: 'Archive', extractable: 'bomb-arena',
  }, 'pixelgirl', 'transfer');
  progression.finishTransfer(archive.key);
  const archiveId = virtualFileId('downloads', 'BombArena.zip');
  const bombId = virtualFileId('bomb-arena-folder', 'BombArena.exe');
  const shortcutId = virtualFileId('user-desktop', 'bombarena.exe.lnk');
  assert.equal(filesystem.exists(shortcutId), false);
  assert.equal(filesystem.extractBombArena(archiveId).ok, true);
  assert.equal(filesystem.getLocation('user-desktop').items.filter((item) => item.shortcutId === 'bomb-arena').length, 1);
  assert.equal(filesystem.deleteFile(bombId).ok, true);
  assert.equal(filesystem.exists(shortcutId), false);
});
