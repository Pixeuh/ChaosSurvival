import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { VirtualFilesystem, virtualFileId } from '../src/story/virtual-filesystem.js';
import { DesktopApplications } from '../src/ui/desktop-apps.js';
import { DESKTOP_SHORTCUTS, ExecutableRegistry, VIRTUAL_EXECUTABLES } from '../src/ui/executable-registry.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const story = read('../src/config/story.json');
const filesystemConfig = read('../src/config/filesystem.json');

function createFilesystem() {
  const progression = new Progression(story);
  progression.begin();
  return { progression, filesystem: new VirtualFilesystem(progression) };
}

test('the registry audits every initially declared virtual EXE by its stable virtual path', () => {
  const declared = Object.entries(filesystemConfig).flatMap(([locationId, location]) =>
    (location.items ?? [])
      .filter((item) => !item.location && /\.exe$/i.test(item.name))
      .map((item) => virtualFileId(locationId, item.name)),
  );

  assert.deepEqual(declared.sort(), [
    'browser-files/adventurer.exe',
    'downloads/toolbar_setup.exe',
    'media-files/media-play.exe',
    'messenger-files/love-messenger.exe',
  ]);
  for (const fileId of declared) assert.ok(VIRTUAL_EXECUTABLES[fileId], fileId);
  assert.equal(VIRTUAL_EXECUTABLES['downloads/super_mega_game.exe'], 'received-minigame');
  assert.equal(VIRTUAL_EXECUTABLES['bomb-arena-folder/bombarena.exe'], 'bomb-arena');
  assert.equal(DESKTOP_SHORTCUTS.find((item) => item.id === 'chaos-survival').action, 'level-one');
});

test('Explorer executable opens route through stable associations and preserve app instances', () => {
  const { filesystem } = createFilesystem();
  const calls = [];
  const instances = new Map();
  const handlers = Object.fromEntries(
    ['messenger', 'browser', 'received-minigame', 'bomb-arena', 'level-one'].map((action) => [
      action,
      (file, fileId, { source }) => {
        calls.push({ action, fileId, source, file });
        if (!instances.has(action)) instances.set(action, { action, page: 'saved navigation' });
        return instances.get(action);
      },
    ]),
  );
  const registry = new ExecutableRegistry(filesystem, handlers);
  assert.deepEqual(registry.resolve('messenger-files/love-messenger.exe'), {
    status: 'associated',
    file: filesystem.getFile('messenger-files/love-messenger.exe'),
    fileId: 'messenger-files/love-messenger.exe',
    action: 'messenger',
  });
  const app = Object.create(DesktopApplications.prototype);
  Object.assign(app, {
    virtualFilesystem: filesystem,
    onLaunchExecutable: (fileId, options) => registry.launch(fileId, options),
  });

  for (const [fileId, action] of [
    ['messenger-files/love-messenger.exe', 'messenger'],
    ['browser-files/adventurer.exe', 'browser'],
  ]) {
    const location = filesystem.getLocation(fileId.split('/')[0]);
    const item = filesystem.getFile(fileId);
    const first = app.openFile(location, item);
    first.page = 'current navigation and conversations';
    const second = app.openFile(location, item);
    assert.equal(second, first);
    assert.equal(second.page, 'current navigation and conversations');
    assert.equal(calls.filter((call) => call.action === action).length, 2);
  }

  assert.deepEqual(calls.map(({ source }) => source), ['explorer', 'explorer', 'explorer', 'explorer']);
});

test('received mini-game and extracted BombArena executables dispatch only while their virtual files exist', () => {
  const { progression, filesystem } = createFilesystem();
  const calls = [];
  const registry = new ExecutableRegistry(filesystem, {
    'received-minigame': (file, fileId, context) => {
      calls.push({ action: 'received-minigame', fileId, context, file });
      return 'mini-game-launched';
    },
    'bomb-arena': (file, fileId, context) => {
      calls.push({ action: 'bomb-arena', fileId, context, file });
      return 'bomb-arena-opened';
    },
  });
  const app = Object.create(DesktopApplications.prototype);
  Object.assign(app, {
    virtualFilesystem: filesystem,
    onLaunchExecutable: (fileId, options) => registry.launch(fileId, options),
  });

  const gameTransfer = progression.receiveFile({
    id: 'super-mega-game',
    name: 'SUPER_MEGA_GAME.exe',
    description: 'SMILEY CATCHER 2009',
    launch: { game: 'smiley-catcher', sequence: 'super-mega-game' },
  }, 'pixelgirl-intro', 'offer');
  progression.finishTransfer(gameTransfer.key);
  const gameId = virtualFileId('downloads', 'SUPER_MEGA_GAME.exe');
  const game = filesystem.getFile(gameId);
  assert.equal(app.openFile(filesystem.getLocation('downloads'), game), 'mini-game-launched');
  assert.equal(calls.at(-1).file.launch.game, 'smiley-catcher');

  const archiveTransfer = progression.receiveFile({
    id: 'bomb-arena', name: 'BombArena.zip', sizeLabel: '18 Mo',
    description: 'Archive ZIP', deletable: true, extractable: 'bomb-arena',
  }, 'pixelgirl-super-plombier-group', 'transfer');
  progression.finishTransfer(archiveTransfer.key);
  const archiveId = virtualFileId('downloads', 'BombArena.zip');
  assert.equal(filesystem.extractBombArena(archiveId).ok, true);
  const bombId = virtualFileId('bomb-arena-folder', 'BombArena.exe');
  const bomb = filesystem.getFile(bombId);
  const location = filesystem.getLocation('bomb-arena-folder');

  assert.equal(app.openFile(location, bomb), 'bomb-arena-opened');
  assert.equal(app.openFile(location, bomb, { source: 'desktop' }), 'bomb-arena-opened');
  assert.deepEqual(calls.slice(-2).map(({ fileId, context }) => [fileId, context.source]), [
    [bombId, 'explorer'],
    [bombId, 'desktop'],
  ]);

  assert.equal(filesystem.deleteFile(bombId).ok, true);
  assert.equal(registry.launch(bombId).status, 'missing');
  assert.equal(calls.filter((call) => call.action === 'bomb-arena').length, 2);
});

test('unknown and not-yet-implemented EXEs fail closed; non-EXE files are not executable', () => {
  const { filesystem } = createFilesystem();
  const registry = new ExecutableRegistry(filesystem);
  const mediaPlayer = registry.launch('media-files/media-play.exe');
  assert.equal(mediaPlayer.status, 'unimplemented');
  assert.equal(mediaPlayer.message, 'Cette application virtuelle n’est pas encore disponible.');
  const toolbarInstaller = registry.launch('downloads/toolbar_setup.exe');
  assert.equal(toolbarInstaller.status, 'unimplemented');
  assert.match(toolbarInstaller.message, /Installation impossible/);

  const added = filesystem.addFile('downloads', {
    name: 'surprise.exe', icon: 'document', detail: 'Programme', deletable: true,
  });
  assert.equal(added.ok, true);
  const unknownId = added.fileId;
  assert.equal(registry.launch(unknownId).status, 'unrecognized');
  assert.equal(registry.launch('downloads/not-present.exe').status, 'missing');
  assert.equal(registry.launch('downloads/installation_a_lire.txt').status, 'not-executable');

});

test('desktop game shortcut uses the central level-one action without a host executable', () => {
  const { filesystem } = createFilesystem();
  let launches = 0;
  const registry = new ExecutableRegistry(filesystem, {
    'level-one': () => ++launches,
  });
  assert.equal(registry.launchShortcut('chaos-survival'), 1);
  assert.equal(registry.launchShortcut('chaos-survival'), 2);
  assert.equal(launches, 2);
});
