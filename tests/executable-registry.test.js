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
  ]);
  assert.deepEqual(Object.fromEntries(associations), {
    'messenger-files/love-messenger.exe': 'windows-love-messenger',
    'browser-files/adventurer.exe': 'internet-adventurer',
    'media-files/media-play.exe': 'windows-media-play',
    'downloads/toolbar_setup.exe': 'toolbar-installer',
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
