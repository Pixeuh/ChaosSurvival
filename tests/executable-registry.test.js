import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executableAssociation } from '../src/ui/executable-registry.js';
import { DesktopApplications } from '../src/ui/desktop-apps.js';
import { Progression } from '../src/story/progression.js';
import { VirtualFilesystem, virtualFileId } from '../src/story/virtual-filesystem.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const filesystemDefinition = read('../src/config/filesystem.json');
const story = read('../src/config/story.json');
const intro = read('../src/dialogues/pixelgirl-intro.json');

test('all static and scenario-created virtual executables resolve by stable IDs', () => {
  const staticIds = new Set();
  const associations = new Map();
  for (const [locationId, location] of Object.entries(filesystemDefinition))
    for (const item of location.items) {
      if (!/\.exe$/i.test(item.name)) continue;
      const fileId = virtualFileId(locationId, item.name);
      staticIds.add(fileId);
      associations.set(fileId, executableAssociation(item, fileId));
    }
  assert.deepEqual([...staticIds].sort(), [
    'browser-files/adventurer.exe',
    'downloads/toolbar_setup.exe',
    'media-files/media-play.exe',
    'messenger-files/love-messenger.exe',
    'my-games/chaossurvival.exe',
  ]);
  assert.deepEqual(Object.fromEntries(associations), {
    'messenger-files/love-messenger.exe': 'windows-love-messenger',
    'browser-files/adventurer.exe': 'internet-adventurer',
    'media-files/media-play.exe': 'windows-media-play',
    'downloads/toolbar_setup.exe': 'toolbar-installer',
    'my-games/chaossurvival.exe': 'chaos-survival',
  });

  const gameFile = Object.values(intro.nodes).flatMap((node) => node.messages)
    .find((message) => message.file?.name === 'SUPER_MEGA_GAME.exe')?.file;
  assert.equal(executableAssociation(gameFile, 'downloads/super_mega_game.exe'), 'mini-game');

  const progression = new Progression(story);
  const virtualFilesystem = new VirtualFilesystem(progression);
  const archive = progression.receiveFile(
    { id: 'bomb-arena', name: 'BombArena.zip', extractable: 'bomb-arena' },
    'pixelgirl-super-plombier-group',
    'bomb-arena-transfer',
  );
  progression.finishTransfer(archive.key);
  assert.equal(virtualFilesystem.extractBombArena(virtualFileId('downloads', 'BombArena.zip')).ok, true);
  const executable = virtualFilesystem.getFile(virtualFileId('bomb-arena-folder', 'BombArena.exe'));
  assert.equal(executableAssociation(executable, executable.fileId), 'bomb-arena');
});

test('unsupported executable paths are explicit and other file types are not executable', () => {
  assert.equal(executableAssociation({ name: 'unknown.exe' }, 'downloads/unknown.exe'), 'unknown');
  assert.equal(executableAssociation({ name: 'notes.txt' }, 'downloads/notes.txt'), null);
  const registrySource = readFileSync(new URL('../src/ui/executable-registry.js', import.meta.url), 'utf8');
  const explorerSource = readFileSync(new URL('../src/ui/desktop-apps.js', import.meta.url), 'utf8');
  assert.doesNotMatch(registrySource + explorerSource, /node:child_process|execFile|shell\.openPath/);
});

test('DesktopApplications delegates received games and extracted BombArena to their existing launchers', () => {
  const calls = [];
  const app = Object.assign(Object.create(DesktopApplications.prototype), {
    virtualFilesystem: { exists: () => true },
    onOpenReceived: (file) => { calls.push(['mini-game', file.name]); return 'game'; },
    openBombArena: (file, fileId) => { calls.push(['bomb-arena', fileId]); return 'bomb'; },
  });
  const downloads = { id: 'downloads' };

  assert.equal(app.openFile(downloads, {
    name: 'SUPER_MEGA_GAME.exe',
    fileId: 'downloads/super_mega_game.exe',
    receivedFile: true,
    launch: { game: 'smiley-catcher' },
  }), 'game');
  assert.equal(app.openFile({ id: 'bomb-arena-folder' }, {
    name: 'BombArena.exe',
    fileId: 'bomb-arena-folder/bombarena.exe',
    virtualApp: 'bomb-arena',
  }), 'bomb');
  assert.deepEqual(calls, [
    ['mini-game', 'SUPER_MEGA_GAME.exe'],
    ['bomb-arena', 'bomb-arena-folder/bombarena.exe'],
  ]);
});

test('all installed application executables are routed through the shared launcher callback', () => {
  const launches = [];
  const app = Object.assign(Object.create(DesktopApplications.prototype), {
    virtualFilesystem: { exists: () => true },
    onLaunchExecutable: (applicationId, file, fileId) => {
      launches.push({ applicationId, file: file.name, fileId });
      return applicationId;
    },
  });
  const cases = [
    ['messenger-files', 'love-messenger.exe', 'windows-love-messenger'],
    ['browser-files', 'adventurer.exe', 'internet-adventurer'],
    ['media-files', 'media-play.exe', 'windows-media-play'],
    ['downloads', 'toolbar_setup.exe', 'toolbar-installer'],
  ];
  for (const [locationId, name, applicationId] of cases) {
    const location = { id: locationId };
    const file = { name };
    const fileId = virtualFileId(locationId, name);
    assert.equal(app.openFile(location, file), applicationId);
    assert.equal(launches.at(-1).fileId, fileId);
  }
  assert.equal(launches.length, cases.length);
});

test('deleting toolbar_setup.exe prevents a later launch and the file stays deletable', () => {
  const progression = new Progression(story);
  const filesystem = new VirtualFilesystem(progression);
  const downloads = filesystem.getLocation('downloads');
  const toolbar = downloads.items.find((item) => item.name === 'toolbar_setup.exe');
  assert.ok(toolbar?.deletable);
  let launches = 0;
  const app = Object.assign(Object.create(DesktopApplications.prototype), {
    virtualFilesystem: filesystem,
    onLaunchExecutable: () => { launches++; return 'toolbar-installer'; },
  });
  assert.equal(app.openFile(downloads, toolbar), 'toolbar-installer');
  assert.equal(launches, 1);
  assert.equal(filesystem.deleteFile(toolbar.fileId).ok, true);
  assert.equal(app.openFile(downloads, toolbar), undefined);
  assert.equal(launches, 1);
});

test('a saved shortcut to a deleted virtual file reports the missing target without recreating it', () => {
  const progression = new Progression(story);
  const filesystem = new VirtualFilesystem(progression);
  const fileId = virtualFileId('my-games', 'ChaosSurvival.exe');
  const file = filesystem.getFile(fileId);
  assert.equal(filesystem.deleteFile(fileId).ok, true);
  let spawn;
  const button = { addEventListener(_type, callback) { this.click = callback; } };
  const message = {};
  const instance = {
    id: 1,
    task: { remove() {} },
    element: {
      isConnected: true,
      querySelector(selector) {
        return selector === '.missing-shortcut-message' ? message : button;
      },
    },
  };
  const app = Object.assign(Object.create(DesktopApplications.prototype), {
    virtualFilesystem: filesystem,
    manager: { spawn(_type, options) { spawn = options; return 1; }, close(id) { this.closed = id; } },
    instances: new Map(),
    attachWindow(key) { instance.key = key; return instance; },
    restore() {},
  });
  app.openMissingFileShortcut(file);
  assert.match(message.textContent, /Impossible de trouver le fichier cible « ChaosSurvival\.exe »/);
  assert.equal(filesystem.exists(fileId), false, 'opening a broken shortcut never restores its file');
  button.click();
  assert.equal(app.manager.closed, 1);
  assert.match(spawn.content.body, /missing-shortcut-message/);
});

test('legacy Smiley Pack saves remain readable and retain their virtual installer association', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const archiveId = virtualFileId('downloads', 'smileys_pack_2009.zip');
  const folderId = virtualFileId('downloads', 'smiley_pack_2009');
  const installerId = virtualFileId('smiley-pack-2009-folder', 'Smiley Pack 2009.exe');
  values.set('chaos-survival-story-v1', JSON.stringify({
    version: 1,
    started: true,
    current: story.start,
    completed: [],
    flags: { smileyPack2009Installed: true },
    virtualFilesystem: { deleted: [], added: {
      [folderId]: {
        name: 'smiley_pack_2009', icon: 'folder', detail: 'Dossier', deletable: true,
        directory: true, location: 'smiley-pack-2009-folder',
      },
      [installerId]: {
        name: 'Smiley Pack 2009.exe', icon: 'application', detail: 'Application',
        deletable: true, virtualApp: 'smiley-pack-installer',
      },
    } },
  }));
  const progression = new Progression(story, storage);
  const filesystem = new VirtualFilesystem(progression);
  const archive = filesystem.getFile(archiveId);
  assert.equal(archive?.extractable, 'smiley-pack-2009');
  assert.equal(filesystem.canDelete(archiveId), true);
  assert.equal(filesystem.extractArchive(archiveId).ok, true, 'the legacy archive remains extractable');
  assert.equal(filesystem.getFile(folderId).directory, true, 'the old extracted folder remains visible');
  const installer = filesystem.getFile(installerId);
  assert.equal(installer.virtualApp, 'smiley-pack-installer');
  assert.equal(executableAssociation(installer, installerId), 'smiley-pack-installer');
  assert.equal(filesystem.canDelete(installerId), true);
  assert.equal(progression.data.flags.smileyPack2009Installed, true, 'legacy save data is retained');

  let launches = 0;
  const app = Object.assign(Object.create(DesktopApplications.prototype), {
    virtualFilesystem: filesystem,
    onLaunchExecutable: (applicationId) => { launches++; return applicationId; },
  });
  assert.equal(app.openFile(filesystem.getLocation('smiley-pack-2009-folder'), installer), 'smiley-pack-installer');
  assert.equal(launches, 1);

  progression.newGame();
  const newFilesystem = new VirtualFilesystem(progression);
  assert.equal(newFilesystem.exists(folderId), false, 'new games do not recreate the old folder');
  assert.equal(newFilesystem.exists(installerId), false);
  assert.equal(newFilesystem.exists(archiveId), true, 'the fictitious ZIP stays in place');
});
