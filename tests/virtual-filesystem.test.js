import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { DialogueSession } from '../src/story/dialogue.js';
import { VirtualTextFiles } from '../src/story/text-files.js';
import { VirtualFilesystem, virtualFileId } from '../src/story/virtual-filesystem.js';
import { DesktopApplications } from '../src/ui/desktop-apps.js';
import { DesktopFiles } from '../src/ui/desktop-files.js';
import { DesktopIcons } from '../src/ui/desktop-icons.js';
const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url)));
const groupDialogue = JSON.parse(readFileSync(new URL('../src/dialogues/pixelgirl-super-plombier-group.json', import.meta.url)));

function memory() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
  };
}

class FakeElement {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.attrs = {};
    this.handlers = {};
    this.style = {};
    this.hidden = false;
    this.disabled = false;
    this.classList = { add() {}, remove() {} };
    this.offsetWidth = 150;
    this.offsetHeight = 90;
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = items; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(type, callback) { this.handlers[type] = callback; }
  removeEventListener(type) { delete this.handlers[type]; }
  focus() {}
  getBoundingClientRect() { return { left: 10, top: 20, width: 400, height: 300 }; }
  contains(target) { return this === target || this.children.some((child) => child.contains?.(target)); }
  closest() { return this; }
  querySelector(selector) {
    const match = (node) => {
      if (selector === 'p' && node.tagName === 'P') return node;
      if (selector === 'strong' && node.tagName === 'STRONG') return node;
      if (selector === 'dl' && node.tagName === 'DL') return node;
      const action = selector.match(/^\[data-explorer-action="(.+)"\]$/)?.[1];
      if (action && node.dataset.explorerAction === action) return node;
      const answer = selector.match(/^\[data-delete-answer="(.+)"\]$/)?.[1];
      if (answer && node.dataset.deleteAnswer === answer) return node;
      if (selector === 'button' && node.tagName === 'BUTTON') return node;
      for (const child of node.children) {
        const found = match(child);
        if (found) return found;
      }
      return null;
    };
    this.fields ??= new Map();
    if (!this.fields.has(selector)) this.fields.set(selector, match(this) ?? new FakeElement());
    return this.fields.get(selector);
  }
}

test('virtual files have stable path IDs, protect system files, delete permanently and keep the bin empty', () => {
  const disk = memory();
  const progression = new Progression(story, disk);
  const files = new VirtualFilesystem(progression);
  const before = readFileSync(new URL('../src/config/filesystem.json', import.meta.url));
  const deletable = virtualFileId('downloads', 'smileys_pack_2009.zip');
  const protectedFile = virtualFileId('system32', 'desktop.dll');

  assert.equal(files.canDelete(deletable), true);
  assert.equal(files.deleteFile(protectedFile).reason, 'protected');
  assert.equal(files.deleteFile(deletable).ok, true);
  assert.equal(files.exists(deletable), false);
  assert.ok(!files.getLocation('downloads').items.some((item) => item.fileId === deletable));
  assert.deepEqual(files.getLocation('bin').items, []);
  assert.deepEqual(files.getLocation('my-games').items.map((item) => item.name), ['ChaosSurvival.exe']);
  assert.throws(() => files.getLocation('games'), /inconnu/);
  assert.deepEqual(files.getLocation('user-profile').items.map((item) => item.location), ['folder']);
  assert.throws(() => files.getLocation('user-desktop'), /inconnu/);
  assert.equal(files.addFile('games', {
    name: 'old-game.txt', icon: 'document', detail: 'Document texte',
  }).ok, false);
  assert.deepEqual(readFileSync(new URL('../src/config/filesystem.json', import.meta.url)), before);

  const restored = new VirtualFilesystem(new Progression(story, disk));
  assert.equal(restored.exists(deletable), false);
  assert.deepEqual(restored.getLocation('bin').items, []);
  assert.deepEqual(restored.getLocation('my-games').items.map((item) => item.name), ['ChaosSurvival.exe']);
  restored.progression.newGame();
  const fresh = new VirtualFilesystem(restored.progression);
  assert.equal(fresh.exists(deletable), true);
  assert.deepEqual(fresh.getLocation('my-games').items.map((item) => item.name), ['ChaosSurvival.exe']);
  assert.deepEqual(fresh.getLocation('user-profile').items.map((item) => item.location), ['folder']);
  assert.throws(() => fresh.getLocation('user-desktop'), /inconnu/);
});

test('XP personal folders are rooted in Mes documents without legacy Games or Downloads paths', () => {
  const files = new VirtualFilesystem(new Progression(story, memory()));
  const root = files.getLocation('c-root');
  assert.deepEqual(root.items.map((item) => item.location), ['programs', 'windows', 'profiles']);
  assert.throws(() => files.getLocation('games'), /inconnu/);

  const documents = files.getLocation('folder');
  for (const name of ['Mes images', 'Ma musique', 'Mes vidéos', 'Mes fichiers reçus', 'My Games', 'a_faire.txt'])
    assert.ok(documents.items.some((item) => item.name === name), name);
  assert.deepEqual(files.getLocation('my-games').items.map((item) => item.name), ['ChaosSurvival.exe']);
  assert.deepEqual(files.getLocation('videos').items, []);
  assert.equal(files.getLocation('downloads').parent, 'folder');
  assert.equal(
    files.getLocation('downloads').address,
    'C:\\Documents and Settings\\Joueur\\Mes documents\\Mes fichiers reçus',
  );
  assert.equal(files.getLocation('music').address.endsWith('\\Ma musique'), true);
});

test('ChaosSurvival.exe launches from My Games and its deletion persists without affecting the desktop shortcut', () => {
  const disk = memory();
  const progression = new Progression(story, disk);
  const filesystem = new VirtualFilesystem(progression);
  const fileId = virtualFileId('my-games', 'ChaosSurvival.exe');
  const location = filesystem.getLocation('my-games');
  const item = filesystem.getFile(fileId);
  assert.equal(location.address, 'C:\\Documents and Settings\\Joueur\\Mes documents\\My Games');
  assert.equal(location.items.filter((entry) => entry.name === 'ChaosSurvival.exe').length, 1);
  assert.equal(filesystem.metadata(fileId).path,
    'C:\\Documents and Settings\\Joueur\\Mes documents\\My Games\\ChaosSurvival.exe');
  for (const oldLocation of ['c-root', 'programs', 'downloads'])
    assert.equal(filesystem.getLocation(oldLocation).items.some((entry) => entry.name === 'ChaosSurvival.exe'), false);

  let launches = 0;
  const applications = Object.assign(Object.create(DesktopApplications.prototype), {
    virtualFilesystem: filesystem,
    onLaunchArcade: () => { launches++; return 'level-one-started'; },
  });
  assert.equal(applications.openFile(location, item), 'level-one-started');
  assert.equal(launches, 1);

  assert.equal(filesystem.canDelete(fileId), true);
  assert.equal(filesystem.deleteFile(fileId).ok, true);
  assert.equal(new VirtualFilesystem(new Progression(story, disk)).exists(fileId), false,
    'deletion is retained after saving and loading');
  const restored = new VirtualFilesystem(new Progression(story, disk));
  restored.progression.newGame();
  assert.equal(new VirtualFilesystem(restored.progression).exists(fileId), true,
    'a new game restores the static launcher');
});

test('all text and JPG files plus named exceptions are deletable except fond-ecran.jpg everywhere', () => {
  const disk = memory();
  const files = new VirtualFilesystem(new Progression(story, disk));
  const definitions = {
    ...JSON.parse(readFileSync(new URL('../src/config/filesystem.json', import.meta.url))),
    ...JSON.parse(readFileSync(new URL('../src/config/desktop-apps.json', import.meta.url))),
  };
  for (const [locationId, location] of Object.entries(definitions))
    for (const item of location.items ?? [])
      if (!item.location && /\.(txt|jpg)$/i.test(item.name) && !['fond-bureau.jpg', 'fond_bureau.jpg', 'fond-ecran.jpg'].includes(item.name.toLowerCase()))
        assert.equal(files.canDelete(virtualFileId(locationId, item.name)), true, `${locationId}/${item.name}`);

  assert.equal(files.canDelete(virtualFileId('fonts', 'PixelSans.ttf')), true);
  assert.equal(files.canDelete(virtualFileId('folder', 'a_faire.txt')), true);
  assert.equal(files.canDelete(virtualFileId('images', 'fond_bureau.jpg')), false);
  assert.equal(files.deleteFile(virtualFileId('images', 'fond_bureau.jpg')).reason, 'protected');
  const requestedZip = files.addFile('downloads', {
    name: 'smiley_pack_2009.zip', icon: 'document', detail: 'Archive ZIP',
  });
  assert.equal(requestedZip.ok, true);
  assert.equal(files.canDelete(requestedZip.fileId), true);

  const protectedWallpaper = files.addFile('images', {
    name: 'fond-bureau.jpg', icon: 'document', detail: 'Image', deletable: true,
  });
  const protectedDownloadWallpaper = files.addFile('downloads', {
    name: 'fond-ecran.jpg', icon: 'document', detail: 'Image', deletable: true,
  });
  assert.equal(protectedWallpaper.ok, true);
  assert.equal(protectedDownloadWallpaper.ok, true);
  assert.equal(files.canDelete(protectedWallpaper.fileId), false);
  assert.equal(files.deleteFile(protectedWallpaper.fileId).reason, 'protected');
  files.state.deleted.push(protectedWallpaper.fileId, protectedDownloadWallpaper.fileId);
  disk.setItem('chaos-survival-story-v1', JSON.stringify(files.progression.data));
  const restored = new VirtualFilesystem(new Progression(story, disk));
  assert.equal(restored.exists(protectedWallpaper.fileId), true);
  assert.equal(restored.exists(protectedDownloadWallpaper.fileId), true);
  const unauthorized = files.addFile('downloads', {
    name: 'other.exe', icon: 'document', detail: 'Programme',
  });
  assert.equal(unauthorized.ok, true);
  assert.equal(files.canDelete(unauthorized.fileId), false);
});

test('the received game exists only after transfer, deletes permanently, and a new game resets it', () => {
  const disk = memory();
  const progression = new Progression(story, disk);
  const filesystem = new VirtualFilesystem(progression);
  const game = {
    id: 'super-mega-game',
    name: 'SUPER_MEGA_GAME.exe',
    description: 'SMILEY CATCHER 2009',
    launch: { game: 'smiley-catcher' },
  };
  const fileId = virtualFileId('downloads', game.name);

  const pending = progression.receiveFile(game, 'pixelgirl-intro', 'offer');
  assert.equal(filesystem.exists(fileId), false, 'an unfinished transfer is not a file');
  progression.finishTransfer(pending.key);
  assert.equal(filesystem.getFile(fileId).receivedFile, true);
  assert.equal(filesystem.getLocation('my-games').items.some((item) => item.name === game.name), false);
  assert.equal(filesystem.deleteFile(fileId).ok, true);
  assert.equal(filesystem.exists(fileId), false);

  const restored = new VirtualFilesystem(new Progression(story, disk));
  assert.equal(restored.exists(fileId), false, 'deletion survives a reload');
  assert.deepEqual(restored.getLocation('bin').items, []);
  const repeated = restored.progression.receiveFile(game, 'pixelgirl-intro', 'offer-replayed', 'receive', 1);
  restored.progression.finishTransfer(repeated.key);
  assert.equal(new VirtualFilesystem(restored.progression).exists(fileId), false,
    'a later completed transfer cannot restore the deleted path in this run');

  restored.progression.newGame();
  const fresh = new VirtualFilesystem(restored.progression);
  assert.equal(fresh.exists(fileId), false, 'a new run waits for its narrative transfer');
  const nextTransfer = restored.progression.receiveFile(game, 'pixelgirl-intro', 'offer');
  restored.progression.finishTransfer(nextTransfer.key);
  assert.equal(new VirtualFilesystem(restored.progression).exists(fileId), true);
});

test('removing the SmileyCatcher desktop shortcut keeps its received executable in Explorer', (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => new FakeElement() };
  t.after(() => {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });
  const disk = memory();
  const progression = new Progression(story, disk);
  const game = {
    id: 'super-mega-game',
    name: 'SUPER_MEGA_GAME.exe',
    description: 'SMILEY CATCHER 2009',
    launch: { game: 'smiley-catcher' },
  };
  const transfer = progression.receiveFile(game, 'pixelgirl-intro', 'offer');
  progression.finishTransfer(transfer.key);
  const filesystem = new VirtualFilesystem(progression);
  const fileId = virtualFileId('downloads', game.name);
  const desktop = new FakeElement();
  let desktopItems = null;
  desktop.querySelector = (selector) => selector === '#desktop-files' ? desktopItems : null;
  desktop.append = (items) => {
    items.parent = desktop;
    desktop.children.push(items);
    desktopItems = items;
  };
  const desktopOpened = [];
  const desktopFiles = new DesktopFiles(desktop, progression, (file) => desktopOpened.push(file.name), () => {}, filesystem);
  desktopFiles.render();
  const shortcut = desktopItems.children[0];
  assert.equal(shortcut.dataset.fileId, fileId);
  assert.equal(shortcut.className, 'desktop-file desktop-virtual-shortcut');
  shortcut.classList.contains = (name) => shortcut.className.split(' ').includes(name);
  shortcut.handlers.dblclick();
  assert.deepEqual(desktopOpened, [game.name], 'double-click still opens the executable target');
  const mediaId = virtualFileId('media-files', 'media-play.exe');
  const mediaShortcut = new FakeElement();
  mediaShortcut.dataset.shortcut = 'windows-media-play';

  const icons = Object.create(DesktopIcons.prototype);
  Object.assign(icons, {
    progression,
    saved: {},
    cells: new Map([
      [`file:${fileId}`, { col: 1, row: 0 }],
      [`shortcut:windows-media-play`, { col: 1, row: 1 }],
    ]),
    selectedIds: new Set([`file:${fileId}`, 'shortcut:windows-media-play']),
    refresh() {},
  });
  assert.equal(icons.removeMany([shortcut, mediaShortcut]), true);
  desktopFiles.render();
  assert.equal(desktopItems.children.length, 0, 'a refresh does not recreate a deleted shortcut');
  assert.equal(filesystem.exists(fileId), true, 'shortcut removal leaves the original virtual file intact');
  assert.equal(filesystem.exists(mediaId), true, 'the other shortcut target remains installed');

  const received = filesystem.getLocation('downloads').items.find((item) => item.fileId === fileId);
  const opened = [];
  const applications = Object.assign(Object.create(DesktopApplications.prototype), {
    virtualFilesystem: filesystem,
    onOpenReceived: (file) => (opened.push(file.name), file.name),
  });
  assert.equal(applications.openFile(filesystem.getLocation('downloads'), received), game.name);
  assert.deepEqual(opened, [game.name], 'the executable remains launchable from Explorer');

  const restored = new Progression(story, disk);
  assert.ok(restored.data.desktopIconsRemoved.includes(`file:${fileId}`));
  assert.ok(restored.data.desktopIconsRemoved.includes('shortcut:windows-media-play'));
  assert.equal(new VirtualFilesystem(restored).exists(fileId), true);
  const restoredDesktop = new FakeElement();
  let restoredItems;
  restoredDesktop.querySelector = (selector) => selector === '#desktop-files' ? restoredItems : null;
  restoredDesktop.append = (items) => {
    restoredItems = items;
    restoredDesktop.children.push(items);
  };
  new DesktopFiles(restoredDesktop, restored, () => {}, () => {}, new VirtualFilesystem(restored)).render();
  assert.equal(restoredItems.children.length, 0, 'the shortcut tombstone persists across reloads');
});

test('BombArena.exe is the executable shortcut, window title and taskbar label without changing its app ID', () => {
  let spawnOptions;
  let attached;
  let spawnCount = 0;
  const manager = {
    windows: new Map(),
    spawn(type, options) {
      spawnCount++;
      assert.equal(type, 'desktopapp');
      spawnOptions = { type, ...options };
      this.windows.set(spawnCount, { element: { isConnected: true } });
      return spawnCount;
    },
  };
  const app = Object.create(DesktopApplications.prototype);
  Object.assign(app, {
    manager,
    instances: new Map(),
    attachWindow(key, id, title, iconName) {
      attached = { key, id, title, iconName };
      const instance = { id, element: manager.windows.get(id).element, task: { remove() {} } };
      this.instances.set(key, instance);
      return instance;
    },
    restore() {},
    onWindowState() {},
  });

  const instance = app.openBombArena({}, 'bomb-arena-folder/bombarena.exe');

  assert.equal(spawnOptions.content.title, 'BombArena.exe');
  assert.equal(spawnOptions.resizable, true);
  assert.equal(spawnOptions.maximizable, true);
  assert.equal(spawnOptions.minWidth, 320);
  assert.equal(spawnOptions.minHeight, 240);
  assert.equal(spawnOptions.x, 0.3);
  assert.equal(spawnOptions.y, 0.2);
  assert.match(spawnOptions.content.body, /<strong>BombArena\.exe<\/strong>/);
  assert.deepEqual(attached, {
    key: 'virtual-app:bomb-arena',
    id: 1,
    title: 'BombArena.exe',
    iconName: 'arcade-game',
  });
  assert.equal(instance.fileId, 'bomb-arena-folder/bombarena.exe');
  assert.equal(app.instances.size, 1);
  assert.equal(app.openBombArena({}, 'bomb-arena-folder/bombarena.exe'), instance);
  assert.equal(spawnCount, 1, 'reopening a live window does not create a duplicate');
  instance.element.isConnected = false;
  spawnOptions.onDismiss();
  const reopened = app.openBombArena({}, 'bomb-arena-folder/bombarena.exe');
  assert.notEqual(reopened, instance);
  assert.equal(spawnCount, 2, 'a closed window can be opened again');
});

test('BombArena placeholder scrolls inside its managed minimum window', () => {
  const css = readFileSync(new URL('../src/styles-story.css', import.meta.url), 'utf8');
  const placeholder =
    [...css.matchAll(/\.bomb-arena-placeholder\s*\{([^}]+)\}/g)].at(-1)?.[1] ?? '';
  assert.match(placeholder, /min-width:\s*0/);
  assert.match(placeholder, /min-height:\s*0/);
  assert.match(placeholder, /overflow:\s*auto/);
});

test('the arcade image uses its renamed virtual filename without changing its visual asset', () => {
  const config = JSON.parse(readFileSync(new URL('../src/config/filesystem.json', import.meta.url)));
  const images = config.images.items;
  assert.equal(images.some((item) => item.name === 'fond_arcade.jpg'), false);
  const arcade = images.find((item) => item.name === 'arcade.jpg');
  assert.ok(arcade);
  assert.equal(arcade.image, './covers/best-game-console.svg');
  const files = new VirtualFilesystem(new Progression(story, memory()));
  assert.equal(files.canDelete(virtualFileId('images', 'arcade.jpg')), true);
  assert.equal(files.canDelete(virtualFileId('images', 'fond_bureau.jpg')), false);
});

test('WinRoar adds a persistent virtual folder and executable once, and folder deletion removes its contents', () => {
  const disk = memory();
  const progression = new Progression(story, disk);
  const filesystem = new VirtualFilesystem(progression);
  const transfer = progression.receiveFile({
    id: 'bomb-arena',
    name: 'BombArena.zip',
    sizeLabel: '18 Mo',
    size: 18 * 1024 * 1024,
    description: 'Archive ZIP',
    deletable: true,
    extractable: 'bomb-arena',
    reusableAfterDelete: true,
  }, 'pixelgirl-super-plombier-group', 'transfer');
  progression.finishTransfer(transfer.key);
  const archiveId = virtualFileId('downloads', 'BombArena.zip');
  assert.equal(filesystem.canDelete(archiveId), true);
  assert.equal(filesystem.metadata(archiveId).size, 18 * 1024 * 1024);
  assert.equal(filesystem.getFile(archiveId).extractable, 'bomb-arena');
  assert.equal(filesystem.exists(virtualFileId('bomb-arena-folder', 'BombArena.exe')), false);

  const extracted = filesystem.extractBombArena(archiveId);
  const folderId = virtualFileId('downloads', 'BombArena');
  const executableId = virtualFileId('bomb-arena-folder', 'BombArena.exe');
  assert.equal(extracted.ok, true);
  assert.equal(filesystem.getFile(folderId).directory, true);
  assert.deepEqual(filesystem.getLocation('bomb-arena-folder').items.map((file) => file.name), ['BombArena.exe']);
  assert.equal(filesystem.getFile(executableId).virtualApp, 'bomb-arena');
  assert.equal(filesystem.metadata(executableId).size, 31 * 1024 * 1024);
  assert.equal(filesystem.canDelete(executableId), true);
  assert.equal(filesystem.extractBombArena(archiveId).existing, true);
  assert.equal(filesystem.deleteFile(executableId).ok, true);
  assert.equal(filesystem.exists(folderId), true);
  assert.equal(filesystem.extractBombArena(archiveId).ok, true, 're-extraction reuses the remaining folder');
  assert.equal(filesystem.exists(executableId), true);
  const app = Object.create(DesktopApplications.prototype);
  app.virtualFilesystem = filesystem;
  app.openBombArena = (item, fileId) => ({ item, fileId });
  assert.deepEqual(
    app.openFile(filesystem.getLocation('bomb-arena-folder'), filesystem.getFile(executableId)),
    { item: filesystem.getFile(executableId), fileId: executableId },
    'the virtual executable routes to the internal Bomb Arena application',
  );
  assert.deepEqual(filesystem.getLocation('my-games').items.map((item) => item.name), ['ChaosSurvival.exe']);

  const restored = new VirtualFilesystem(new Progression(story, disk));
  assert.equal(restored.exists(executableId), true);
  const deleted = restored.deleteFile(folderId);
  assert.deepEqual(deleted.removedFileIds, [folderId, executableId]);
  assert.equal(new VirtualFilesystem(new Progression(story, disk)).exists(executableId), false);
  assert.equal(new VirtualFilesystem(new Progression(story, disk)).exists(archiveId), true);
  assert.equal(restored.deleteFile(archiveId).ok, true);
  assert.equal(restored.exists(archiveId), false);
  const replacement = restored.progression.receiveFile({
    ...progression.data.files[transfer.key],
  }, 'bomb-arena-redownload-1', 'offer');
  restored.progression.finishTransfer(replacement.key);
  assert.equal(new VirtualFilesystem(new Progression(story, disk)).exists(archiveId), true,
    'a distinct Bomb Arena offer can restore the archive after the old receipt was deleted');
});

test('Bomb Arena transfer records proposed, accepted, in-progress, refused and completed states across saves', () => {
  const disk = memory();
  let progression = new Progression(story, disk);
  const accepted = progression.receiveFile({
    id: 'bomb-arena', name: 'BombArena.zip', sizeLabel: '18 Mo', extractable: 'bomb-arena',
  }, 'pixelgirl-super-plombier-group', 'transfer-a');
  assert.equal(accepted.transferState, 'proposed');
  assert.equal(progression.acceptTransfer(accepted.key), true);
  assert.equal(progression.data.files[accepted.key].transferState, 'accepted');
  assert.equal(progression.startTransfer(accepted.key, 1000), true);
  assert.equal(progression.data.files[accepted.key].transferState, 'in-progress');
  progression = new Progression(story, disk);
  assert.equal(progression.data.files[accepted.key].transferState, 'in-progress');
  assert.equal(progression.data.files[accepted.key].transferStartedAt, 1000);
  progression.finishTransfer(accepted.key);
  assert.equal(progression.data.files[accepted.key].transferState, 'complete');

  const session = new DialogueSession(groupDialogue, progression);
  session.state.node = 'bomb-arena-transfer';
  session.persist();
  session.deliver();
  session.deliver();
  assert.equal(session.activeTransfer.status, 'pending');
  assert.equal(session.declineTransfer(session.activeTransfer.key), true);
  const declinedKey = session.activeTransfer.key;
  assert.equal(session.activeTransfer.transferState, 'declined');
  assert.equal(new Progression(story, disk).data.files[declinedKey].transferState, 'declined');
});

test('legacy and malformed filesystem save data normalize without hiding unrelated files', () => {
  const disk = memory();
  const original = new Progression(story).data;
  delete original.virtualFilesystem;
  disk.setItem('chaos-survival-story-v1', JSON.stringify(original));
  const legacy = new VirtualFilesystem(new Progression(story, disk));
  assert.deepEqual(legacy.state, { deleted: [], added: {} });
  assert.deepEqual(legacy.getLocation('my-games').items.map((item) => item.name), ['ChaosSurvival.exe']);

  legacy.progression.data.virtualFilesystem = {
    deleted: ['downloads/unknown.txt', 'system32/desktop.dll', null],
    added: {
      'downloads/../outside.txt': { name: 'outside.txt', detail: 'Texte', icon: 'document' },
      'not-a-folder/new.txt': { name: 'new.txt', detail: 'Texte', icon: 'document' },
      'games/old-game.txt': { name: 'old-game.txt', detail: 'Texte', icon: 'document' },
      'system32/desktop.dll': { name: 'desktop.dll', detail: 'Application', icon: 'document', deletable: true },
    },
  };
  const normalized = new VirtualFilesystem(legacy.progression);
  assert.deepEqual(normalized.state, { deleted: [], added: {} });
  assert.ok(normalized.exists(virtualFileId('system32', 'desktop.dll')));
});

test('legacy virtual Bureau references are discarded without recreating the folder or moving its saved text', () => {
  const disk = memory();
  const source = new Progression(story);
  const received = source.receiveFile({
    id: 'test-received', name: 'received.txt', description: 'Document reçu',
  }, 'legacy', 'receive');
  source.finishTransfer(received.key);
  source.data.virtualFilesystem = {
    deleted: ['user-desktop/a_faire.txt', 'downloads/installation_a_lire.txt', 'games/old.exe'],
    added: {
      'user-desktop/extra.txt': { name: 'extra.txt', icon: 'document', detail: 'Texte' },
      'games/old-save.txt': { name: 'old-save.txt', icon: 'document', detail: 'Document texte' },
    },
  };
  source.data.textFiles = {
    'user-desktop\\a_faire.txt': { text: 'modification conservée', original: 'texte initial' },
  };
  source.data.desktopIcons = { 'file:test-received': { col: 2, row: 3, anchor: 'right' } };
  disk.setItem('chaos-survival-story-v1', JSON.stringify(source.data));

  const restoredProgression = new Progression(story, disk);
  const filesystem = new VirtualFilesystem(restoredProgression);
  assert.ok(!filesystem.state.deleted.some((fileId) => fileId.startsWith('user-desktop/')));
  assert.ok(filesystem.state.deleted.includes('downloads/installation_a_lire.txt'));
  assert.ok(!filesystem.state.deleted.some((fileId) => fileId.startsWith('games/')));
  assert.equal(restoredProgression.data.textFiles['user-desktop\\a_faire.txt'], undefined);
  assert.equal(restoredProgression.data.textFiles['folder/a_faire.txt'], undefined);
  assert.deepEqual(restoredProgression.data.desktopIcons['file:downloads/received.txt'], {
    col: 2, row: 3, anchor: 'right',
  });
  assert.equal(restoredProgression.data.desktopIcons['file:test-received'], undefined);
  assert.equal(filesystem.exists('folder/a_faire.txt'), true);
  assert.throws(() => filesystem.getLocation('user-desktop'), /inconnu/);
  assert.equal(filesystem.exists('downloads/installation_a_lire.txt'), false);
  const receivedId = virtualFileId('downloads', 'received.txt');
  assert.ok(filesystem.exists(receivedId));
  assert.ok(filesystem.getLocation('downloads').items.some((item) => item.fileId === receivedId));
  assert.equal(filesystem.deleteFile(receivedId).ok, true);

  const reloaded = new VirtualFilesystem(new Progression(story, disk));
  assert.equal(reloaded.exists(receivedId), false);
  assert.ok(!reloaded.getLocation('downloads').items.some((item) => item.fileId === receivedId));
  assert.deepEqual(reloaded.getLocation('my-games').items.map((item) => item.name), ['ChaosSurvival.exe']);
});

test('dynamic files persist with distinct folder identities, expose virtual properties and can be deleted', () => {
  const disk = memory();
  const progression = new Progression(story, disk);
  const files = new VirtualFilesystem(progression);
  const file = { name: 'BombArena.zip', icon: 'document', detail: 'Archive ZIP', size: 247000, deletable: true };
  assert.equal(files.addFile('bin', file).ok, false, 'the recycle bin cannot retain files');
  const download = files.addFile('downloads', file);
  const music = files.addFile('music', file);
  assert.equal(download.ok, true);
  assert.equal(music.ok, true);
  assert.notEqual(download.fileId, music.fileId);
  assert.ok(files.getLocation('downloads').items.some((item) => item.fileId === download.fileId));
  assert.deepEqual(files.metadata(download.fileId), {
    name: 'BombArena.zip',
    type: 'Archive ZIP',
    location: 'C:\\Documents and Settings\\Joueur\\Mes documents\\Mes fichiers reçus',
    size: 247000,
    path: 'C:\\Documents and Settings\\Joueur\\Mes documents\\Mes fichiers reçus\\BombArena.zip',
  });

  const restored = new VirtualFilesystem(new Progression(story, disk));
  assert.ok(restored.exists(download.fileId));
  assert.equal(restored.deleteFile(download.fileId).ok, true);
  assert.equal(new VirtualFilesystem(new Progression(story, disk)).exists(download.fileId), false);
  assert.ok(new VirtualFilesystem(new Progression(story, disk)).exists(music.fileId));
});

test('deleting an edited text file closes its overlay to reads and rejects a stale editor save', () => {
  const disk = memory();
  const progression = new Progression(story, disk);
  const filesystem = new VirtualFilesystem(progression);
  const textFiles = new VirtualTextFiles(progression, filesystem);
  const item = filesystem.getLocation('folder').items.find((entry) => entry.name.endsWith('.txt'));
  const fileId = item.fileId;
  textFiles.save(fileId, 'texte modifié', item.text);
  assert.equal(textFiles.read(fileId, item.text).text, 'texte modifié');
  assert.equal(filesystem.deleteFile(fileId).ok, true);
  assert.equal(progression.data.textFiles[fileId], undefined);
  assert.equal(textFiles.read(fileId, item.text).text, item.text);
  assert.throws(() => textFiles.save(fileId, 'texte périmé', item.text), /supprimé/);
});

test('filesystem changes roll back when the main save cannot be written', () => {
  const disk = memory();
  const progression = new Progression(story, disk);
  const files = new VirtualFilesystem(progression);
  const fileId = virtualFileId('downloads', 'installation_a_lire.txt');
  disk.setItem = () => { throw new Error('quota'); };
  assert.equal(files.deleteFile(fileId).reason, 'save');
  assert.equal(files.exists(fileId), true);
  assert.deepEqual(files.state.deleted, []);
  assert.equal(files.addFile('downloads', {
    name: 'new.txt', icon: 'document', detail: 'Document texte', deletable: true,
  }).reason, 'save');
  assert.equal(files.exists(virtualFileId('downloads', 'new.txt')), false);
});

test('explorer selects files, provides XP properties and confirmation, and refreshes each open view', (t) => {
  const oldDocument = globalThis.document;
  const listeners = new Set();
  globalThis.document = {
    createElement: (tag) => Object.assign(new FakeElement(), { tagName: tag.toUpperCase() }),
    addEventListener(_type, callback) { listeners.add(callback); },
    removeEventListener(_type, callback) { listeners.delete(callback); },
    activeElement: null,
  };
  t.after(() => {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
  });
  const dispatchDelete = (target = globalThis.document.activeElement, options = {}) => {
    let prevented = false;
    const event = {
      key: 'Delete', target, preventDefault() { prevented = true; }, ...options,
    };
    for (const listener of listeners) listener(event);
    return prevented;
  };
  const progression = new Progression(story, memory());
  const transfer = progression.receiveFile({
    id: 'super-mega-game',
    name: 'SUPER_MEGA_GAME.exe',
    description: 'SMILEY CATCHER 2009',
    launch: { game: 'smiley-catcher' },
  }, 'pixelgirl', 'offer');
  progression.finishTransfer(transfer.key);
  const filesystem = new VirtualFilesystem(progression);
  const desktop = new FakeElement();
  let desktopItems = null;
  desktop.querySelector = (selector) => selector === '#desktop-files' ? desktopItems : null;
  desktop.append = (...items) => {
    desktop.children.push(...items);
    desktopItems = items[0];
  };
  const openedDesktopFiles = [];
  const recordDesktopOpen = (file) => {
    openedDesktopFiles.push(file);
    return file;
  };
  const desktopFiles = new DesktopFiles(
    desktop, progression, recordDesktopOpen, () => {}, filesystem,
  );
  desktopFiles.render();
  const desktopButton = desktopItems.children[0];
  assert.equal(desktopButton.dataset.fileId, virtualFileId('downloads', 'SUPER_MEGA_GAME.exe'));
  let activeWindow = null;
  const app = new DesktopApplications({
    windows: new Map(), close() {}, isActive: (element) => activeWindow === element,
  }, null, () => {}, null,
    new VirtualTextFiles(progression, filesystem), filesystem,
    () => desktopFiles.render(), recordDesktopOpen);
  const makeExplorer = () => {
    const body = new FakeElement();
    const fields = new Map();
    const element = new FakeElement();
    element.querySelector = (selector) => {
      if (selector === '.window-body') return body;
      if (!fields.has(selector)) fields.set(selector, new FakeElement());
      return fields.get(selector);
    };
    const instance = { id: 1, kind: 'downloads', element, history: [] };
    app.setupExplorer(instance);
    app.render(instance, filesystem.getLocation('downloads'));
    return instance;
  };
  const first = makeExplorer();
  const second = makeExplorer();
  activeWindow = first.element;
  app.instances.set('downloads:first', first);
  app.instances.set('downloads:second', second);
  assert.equal(dispatchDelete(), false, 'Delete does nothing without a selected file');
  assert.equal(first.explorerConfirmation.hidden, true);
  const input = Object.assign(new FakeElement(), { tagName: 'INPUT' });
  globalThis.document.activeElement = input;
  first.selectedItem = { fileId: virtualFileId('downloads', 'smileys_pack_2009.zip') };
  assert.equal(dispatchDelete(input), false, 'Delete remains ordinary text editing in input fields');
  assert.equal(first.explorerConfirmation.hidden, true);
  const textarea = Object.assign(new FakeElement(), { tagName: 'TEXTAREA' });
  globalThis.document.activeElement = textarea;
  assert.equal(dispatchDelete(textarea), false, 'Delete remains ordinary text editing in textareas such as MSN');
  assert.equal(first.explorerConfirmation.hidden, true);
  globalThis.document.activeElement = null;
  activeWindow = second.element;
  assert.equal(dispatchDelete(second.element), false, 'a background Explorer cannot delete its selection');
  assert.equal(second.explorerConfirmation.hidden, true);
  activeWindow = first.element;
  const fileId = virtualFileId('downloads', 'smileys_pack_2009.zip');
  const row = first.element.querySelector('.explorer-items').children.find(
    (item) => item.dataset.fileId === fileId,
  );
  row.handlers.click();
  assert.equal(row.attrs['aria-selected'], 'true');
  row.handlers.contextmenu({
    clientX: 45,
    clientY: 60,
    preventDefault() {},
  });
  const menu = first.explorerMenu;
  const propertyAction = menu.children.find((item) => item.dataset.explorerAction === 'properties');
  menu.handlers.click({ target: propertyAction, stopPropagation() {} });
  assert.equal(first.explorerProperties.hidden, false);
  assert.equal(first.explorerProperties.querySelector('strong').textContent, 'smileys_pack_2009.zip');
  first.explorerProperties.querySelector('button').handlers.click();
  row.handlers.contextmenu({ clientX: 45, clientY: 60, preventDefault() {} });
  const deleteAction = menu.children.find((item) => item.dataset.explorerAction === 'delete');
  assert.equal(deleteAction.disabled, false);
  menu.handlers.click({ target: deleteAction, stopPropagation() {} });
  assert.match(first.explorerConfirmation.querySelector('p').textContent, /smileys_pack_2009\.zip/);
  first.explorerConfirmation.querySelector('[data-delete-answer="yes"]').handlers.click();
  assert.equal(filesystem.exists(fileId), false);
  for (const instance of [first, second])
    assert.ok(!instance.element.querySelector('.explorer-items').children.some((item) => item.dataset.fileId === fileId));
  const receivedId = virtualFileId('downloads', 'SUPER_MEGA_GAME.exe');
  const receivedItem = filesystem.getLocation('downloads').items.find((item) => item.fileId === receivedId);
  assert.ok(receivedItem?.receivedFile);
  assert.equal(app.openFile(filesystem.getLocation('downloads'), receivedItem), receivedItem);
  assert.equal(openedDesktopFiles.length, 1);
  const receivedRow = first.element.querySelector('.explorer-items').children.find(
    (item) => item.dataset.fileId === receivedId,
  );
  receivedRow.handlers.click();
  globalThis.document.activeElement = receivedRow;
  assert.equal(dispatchDelete(receivedRow), true, 'Delete opens the existing confirmation for the selected file');
  first.explorerConfirmation.querySelector('[data-delete-answer="yes"]').handlers.click();
  assert.equal(filesystem.exists(receivedId), false);
  assert.equal(desktopItems.children.length, 0, 'Explorer deletion refreshes the desktop from the same transfer state');
  desktopButton.handlers.dblclick();
  assert.equal(openedDesktopFiles.length, 1, 'a stale desktop icon cannot reopen a deleted transfer');
  const archiveTransfer = progression.receiveFile({
    id: 'bomb-arena', name: 'BombArena.zip', sizeLabel: '18 Mo', size: 18 * 1024 * 1024,
    description: 'Archive ZIP', deletable: true, extractable: 'bomb-arena', reusableAfterDelete: true,
  }, 'pixelgirl-super-plombier-group', 'transfer');
  progression.finishTransfer(archiveTransfer.key);
  app.render(first, filesystem.getLocation('downloads'));
  const archiveId = virtualFileId('downloads', 'BombArena.zip');
  const archiveRow = first.element.querySelector('.explorer-items').children.find(
    (item) => item.dataset.fileId === archiveId,
  );
  archiveRow.handlers.contextmenu({ clientX: 45, clientY: 60, preventDefault() {} });
  const extractAction = first.explorerMenu.children.find(
    (item) => item.dataset.explorerAction === 'extract',
  );
  assert.equal(extractAction.textContent, 'Extraire avec WinRoar');
  assert.equal(extractAction.hidden, false);
  assert.equal(filesystem.extractBombArena(archiveId).ok, true);
  desktopFiles.render();
  const bombArenaShortcut = () => desktopItems.children.filter((item) => item.className.includes('desktop-virtual-shortcut'));
  assert.equal(bombArenaShortcut().length, 1);
  assert.equal(bombArenaShortcut()[0].children.at(-1).textContent, 'BombArena.exe');
  bombArenaShortcut()[0].handlers.dblclick();
  assert.equal(openedDesktopFiles.at(-1).virtualApp, 'bomb-arena');
  assert.equal(filesystem.deleteFile(virtualFileId('bomb-arena-folder', 'BombArena.exe')).ok, true);
  desktopFiles.render();
  assert.equal(bombArenaShortcut().length, 0);
  assert.equal(filesystem.extractBombArena(archiveId).ok, true);
  desktopFiles.render();
  assert.equal(bombArenaShortcut().length, 1, 're-extraction after deleting only the EXE restores the shortcut');
  assert.equal(filesystem.deleteFile(virtualFileId('downloads', 'BombArena')).ok, true);
  desktopFiles.render();
  assert.equal(bombArenaShortcut().length, 0, 'removing the EXE removes the derived desktop shortcut');
  assert.equal(filesystem.extractBombArena(archiveId).ok, true);
  desktopFiles.render();
  assert.equal(bombArenaShortcut().length, 1, 'extracting again restores only one shortcut');
  app.render(first, filesystem.getLocation('downloads'));
  const currentArchiveRow = first.element.querySelector('.explorer-items').children.find(
    (item) => item.dataset.fileId === archiveId,
  );
  currentArchiveRow.handlers.click();
  globalThis.document.activeElement = currentArchiveRow;
  assert.equal(dispatchDelete(currentArchiveRow), true, 'the same shortcut works for BombArena.zip');
  first.explorerConfirmation.querySelector('[data-delete-answer="yes"]').handlers.click();
  assert.equal(filesystem.exists(archiveId), false);
  desktopFiles.render();
  assert.equal(bombArenaShortcut().length, 1, 'the shortcut remains when only the archive is deleted');
  const protectedFile = filesystem.getLocation('windows').items.find((item) => item.name === 'win.ini');
  const systemExplorer = makeExplorer();
  app.render(systemExplorer, filesystem.getLocation('windows'));
  const protectedRow = systemExplorer.element.querySelector('.explorer-items').children.find(
    (item) => item.dataset.fileId === protectedFile.fileId,
  );
  protectedRow.handlers.contextmenu({ clientX: 40, clientY: 50, preventDefault() {} });
  assert.equal(
    systemExplorer.explorerMenu.children.find((item) => item.dataset.explorerAction === 'delete').disabled,
    true,
  );
  protectedRow.handlers.click();
  activeWindow = systemExplorer.element;
  globalThis.document.activeElement = protectedRow;
  assert.equal(dispatchDelete(protectedRow), false, 'Delete cannot bypass protected-file permissions');
  assert.equal(filesystem.exists(protectedFile.fileId), true);
  const bombArenaExecutableId = virtualFileId('bomb-arena-folder', 'BombArena.exe');
  assert.equal(filesystem.exists(bombArenaExecutableId), true);
  progression.data.desktopIconsRemoved = [`file:${bombArenaExecutableId}`];
  desktopFiles.render();
  assert.equal(bombArenaShortcut().length, 0, 'a removed narrative shortcut stays hidden across desktop refreshes');
  assert.equal(filesystem.exists(bombArenaExecutableId), true, 'removing its shortcut preserves the virtual executable');
  for (const instance of [first, second, systemExplorer]) app.teardownExplorer(instance);
  assert.equal(listeners.size, 0);
});
