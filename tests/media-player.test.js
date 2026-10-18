import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import story from '../src/config/story.json' with { type: 'json' };
import mediaLibrary from '../src/config/media-library.json' with { type: 'json' };
import { mediaLibraryResources } from '../src/config/media-library-assets.js';
import { Progression } from '../src/story/progression.js';
import { VirtualFilesystem, normalizeVirtualFilesystemState, virtualFileId } from '../src/story/virtual-filesystem.js';
import { DesktopApplications } from '../src/ui/desktop-apps.js';
import { ExecutableRegistry } from '../src/ui/executable-registry.js';
import { MediaPlayer } from '../src/ui/media-player.js';
import { createGameMusic } from '../src/audio/game-music.js';

function storage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.handlers = {};
    this.style = {};
    this.classList = { add() {}, remove() {} };
    this.isConnected = true;
    this.paused = true;
  }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  dispatch(type, event = {}) { this.handlers[type]?.({ currentTarget: this, target: this, ...event }); }
  append(...children) { this.children.push(...children); }
  insertBefore(child, before) {
    const index = before ? this.children.indexOf(before) : -1;
    if (index < 0) this.children.push(child);
    else this.children.splice(index, 0, child);
  }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  querySelector(selector) {
    if (selector === '.media-track-list') return this.list ??= new FakeElement();
    if (selector === '.titlebar') return this.titlebar ??= new FakeElement();
    if (selector === '.maximize-button') return null;
    if (selector === '.close-button') return this.closeButton ??= new FakeElement('button');
    if (selector === '.media-player-status') return this.status ??= new FakeElement();
    if (selector === '[data-media-seek]') return this.seek ??= new FakeElement('input');
    if (selector === '[data-media-volume]') return this.volumeInput ??= new FakeElement('input');
    if (selector === '[data-media-volume-value]') return this.volumeOutput ??= new FakeElement('output');
    if (selector === '[data-media-control="play"]') return this.playButton ??= new FakeElement('button');
    if (selector === '[data-media-control="pause"]') return this.pauseButton ??= new FakeElement('button');
    if (selector === '[data-media-control="stop"]') return this.stopButton ??= new FakeElement('button');
    if (selector === '[data-media-control="mute"]') return this.muteButton ??= new FakeElement('button');
    if (selector === '[data-media-control="previous"]') return this.previousButton ??= new FakeElement('button');
    if (selector === '[data-media-control="next"]') return this.nextButton ??= new FakeElement('button');
    if (selector === '[data-media-title]') return this.title ??= new FakeElement();
    if (selector === '[data-media-subtitle]') return this.subtitle ??= new FakeElement();
    if (selector === '[data-media-elapsed]') return this.elapsed ??= new FakeElement();
    if (selector === '[data-media-duration]') return this.duration ??= new FakeElement();
    if (selector === '.media-visualizer') return this.canvas ??= new FakeElement('canvas');
    return this.fields?.get(selector) ?? null;
  }
  querySelectorAll(selector) {
    if (selector === '[data-media-view]') return this.views ??= ['library', 'now-playing'].map((view) => {
      const node = new FakeElement('button'); node.dataset.mediaView = view; return node;
    });
    if (selector === '[data-media-panel]') return this.panels ??= ['library', 'now-playing'].map((panel) => {
      const node = new FakeElement('section'); node.dataset.mediaPanel = panel; return node;
    });
    if (selector === '.media-track') return this.list?.children ?? [];
    return [];
  }
  remove() { this.isConnected = false; }
  focus() {}
}

function playerHarness({ metadata, AudioConstructor } = {}) {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: (tag) => new FakeElement(tag) };
  const progression = new Progression(story, storage());
  const filesystem = new VirtualFilesystem(progression);
  const windows = new Map();
  const options = [];
  const manager = {
    windows,
    spawn(_type, config) {
      const id = windows.size + 1;
      options.push(config);
      const element = new FakeElement('article');
      element.querySelector = FakeElement.prototype.querySelector.bind(element);
      windows.set(id, { element, onDismiss: config.onDismiss });
      return id;
    },
    bringToFront() {},
  };
  const taskbar = new FakeElement();
  taskbar.querySelector = () => null;
  const player = new MediaPlayer(manager, taskbar, filesystem, {
    metadata,
    AudioConstructor: AudioConstructor ?? (() => new AudioMock()),
  });
  return {
    player, filesystem, progression, manager, options, taskbar,
    restoreDocument() { if (oldDocument === undefined) delete globalThis.document; else globalThis.document = oldDocument; },
  };
}

class AudioMock {
  constructor() {
    this.handlers = {};
    this.paused = true;
    this.currentTime = 0;
    this.duration = 120;
    this.volume = 1;
    this.playCalls = 0;
    this.pauseCalls = 0;
  }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  emit(type) { this.handlers[type]?.(); }
  play() { this.playCalls++; this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.pauseCalls++; this.paused = true; this.emit('pause'); }
  load() {}
  removeAttribute() {}
}

test('Media Play launches through Explorer and the executable registry as one resizable window', (t) => {
  const h = playerHarness();
  t.after(h.restoreDocument);
  let launches = 0;
  const registry = new ExecutableRegistry(h.filesystem, { 'media-player': () => { launches++; return h.player.open(); } });
  const app = new DesktopApplications(null, null, () => {}, null, undefined, h.filesystem, () => {}, null,
    (fileId, options) => registry.launch(fileId, options),
    (fileId, options) => h.player.open(fileId, options));
  const location = h.filesystem.getLocation('media-files');
  const executable = location.items.find((file) => file.name === 'media-play.exe');
  const first = app.openFile(location, executable);
  const second = app.openFile(location, executable);
  assert.equal(launches, 2);
  assert.equal(first, second);
  assert.equal(h.options.length, 1);
  assert.equal(h.options[0].resizable, true);
  assert.equal(h.options[0].maximizable, true);
  assert.deepEqual([h.options[0].minWidth, h.options[0].minHeight], [560, 420]);
  h.player.dispose();
});

test('the virtual music folder contains exactly the three mapped real tracks with their real sizes', (t) => {
  const h = playerHarness();
  t.after(h.restoreDocument);
  const tracks = h.filesystem.getLocation('music').items.filter((file) => /\.mp3$/i.test(file.name));
  assert.deepEqual(tracks.map((file) => file.name), [
    'Sport Dubstep.mp3', 'I Love Chiptune Punk.mp3', 'Lost In Time-Nightcore.mp3',
  ]);
  assert.ok(tracks.every((file) => file.deletable === true && file.size > 0));
  assert.deepEqual(Object.keys(mediaLibrary), tracks.map((file) => file.fileId));
  for (const track of tracks) {
    const resource = mediaLibraryResources[track.fileId];
    assert.ok(resource, `${track.fileId} has a configured local resource`);
    assert.ok(existsSync(fileURLToPath(resource)), `${resource} exists`);
    assert.equal(statSync(fileURLToPath(resource)).size, track.size);
  }
  assert.deepEqual(Object.values(mediaLibrary).map(({ title, artist, source }) => [title, artist, source]), [
    ['Sport Dubstep', 'Kulakovka', 'Pixabay'],
    ['I Love Chiptune Punk', 'Brutaldesign', 'Pixabay'],
    ['Lost In Time-Nightcore', 'NightcoreFreeMusic4u', 'Pixabay'],
  ]);
  h.player.open();
  h.player.refreshLibrary();
  assert.equal(h.player.trackIds.length, 3);
  const fileId = tracks[0].fileId;
  assert.equal(h.filesystem.deleteFile(fileId).ok, true);
  h.player.refreshLibrary();
  assert.equal(h.player.trackIds.includes(fileId), false);
  const restored = new VirtualFilesystem(new Progression(story, h.progression.storage));
  assert.equal(restored.exists(fileId), false);
  h.progression.newGame();
  assert.deepEqual(new VirtualFilesystem(h.progression).getLocation('music').items
    .filter((file) => /\.mp3$/i.test(file.name)).map((file) => file.name), [
    'Sport Dubstep.mp3', 'I Love Chiptune Punk.mp3', 'Lost In Time-Nightcore.mp3',
  ]);
  h.player.dispose();
});

test('migration removes only legacy fake tracks while retaining other virtual files and received transfers', () => {
  const disk = storage();
  const progression = new Progression(story, disk);
  const transfer = progression.receiveFile({
    id: 'migration-check', name: 'migration-check.txt', description: 'Fichier reçu',
  }, 'pixelgirl', 'offer');
  progression.finishTransfer(transfer.key);
  const oldTracks = ['Pixel Dreams.mp3', 'CyberLove.mp3', 'Midnight.exe.mp3', 'Summer 2009.mp3'];
  const oldIds = oldTracks.map((name) => virtualFileId('music', name));
  progression.data.virtualFilesystem = {
    deleted: [...oldIds, virtualFileId('downloads', 'smileys_pack_2009.zip')],
    added: Object.fromEntries(oldTracks.map((name) => [virtualFileId('music', name), {
      name, icon: 'document', detail: 'Ancienne piste fictive', deletable: true,
    }]).concat([[virtualFileId('music', 'bonus.mp3'), {
      name: 'bonus.mp3', icon: 'document', detail: 'Fichier ajouté par le joueur', deletable: true,
    }]])),
  };
  progression.save();
  const migratedProgression = new Progression(story, disk);
  const filesystem = new VirtualFilesystem(migratedProgression);
  assert.ok(oldIds.every((id) => !filesystem.exists(id)));
  assert.ok(oldIds.every((id) => !filesystem.state.deleted.includes(id)));
  assert.equal(filesystem.exists(virtualFileId('music', 'bonus.mp3')), true);
  assert.equal(filesystem.exists(virtualFileId('downloads', 'smileys_pack_2009.zip')), false);
  assert.equal(filesystem.exists(virtualFileId('downloads', 'migration-check.txt')), true);
  assert.deepEqual(migratedProgression.data.files, progression.data.files);
  assert.deepEqual(normalizeVirtualFilesystemState(progression.data.virtualFilesystem).added,
    filesystem.state.added);
});

test('double-clicking a virtual MP3 opens and loads its real local resource', async (t) => {
  const audio = new AudioMock();
  const h = playerHarness({ AudioConstructor: () => audio });
  t.after(h.restoreDocument);
  const app = new DesktopApplications(null, null, () => {}, null, undefined, h.filesystem, () => {}, null, null,
    (fileId, options) => h.player.open(fileId, options));
  const location = h.filesystem.getLocation('music');
  const track = location.items.find((file) => file.name === 'Sport Dubstep.mp3');
  app.openFile(location, track);
  assert.equal(h.player.selectedId, track.fileId);
  assert.equal(audio.src, mediaLibraryResources[track.fileId]);
  assert.match(h.player.instance.element.status.textContent, /Prêt à lire/);
  assert.equal(audio.playCalls, 1);
  h.player.dispose();
});

test('a configured track uses one real media element for transport, seeking and isolated volume', async (t) => {
  const audio = new AudioMock();
  const firstId = virtualFileId('music', 'Sport Dubstep.mp3');
  const secondId = virtualFileId('music', 'I Love Chiptune Punk.mp3');
  const metadata = {
    [firstId]: { ...mediaLibrary[firstId], resource: mediaLibraryResources[firstId] },
    [secondId]: { ...mediaLibrary[secondId], resource: mediaLibraryResources[secondId] },
  };
  const h = playerHarness({ metadata, AudioConstructor: () => audio });
  t.after(h.restoreDocument);
  h.player.open(firstId, { autoplay: true });
  await Promise.resolve();
  assert.equal(audio.src, mediaLibraryResources[firstId]);
  assert.equal(audio.playCalls, 1);
  h.player.pause(true);
  assert.equal(audio.paused, true);
  await h.player.play();
  h.player.stop();
  assert.equal(audio.currentTime, 0);
  h.player.previous();
  h.player.next(false);
  assert.equal(h.player.selectedId, secondId);
  assert.equal(audio.src, mediaLibraryResources[secondId]);
  h.player.previous();
  assert.equal(h.player.selectedId, firstId);
  h.player.instance.element.seek.max = '120';
  h.player.instance.element.seek.value = '37';
  h.player.instance.element.seek.dispatch('input');
  assert.equal(audio.currentTime, 37);
  h.player.instance.element.volumeInput.value = '25';
  h.player.instance.element.volumeInput.dispatch('input');
  assert.equal(audio.volume, 0.25);
  h.player.instance.element.muteButton.dispatch('click');
  assert.equal(audio.volume, 0);
  h.player.instance.element.muteButton.dispatch('click');
  assert.equal(audio.volume, 0.25);
  h.player.dispose();
});

test('minimizing keeps playback alive, taskbar restore returns the window, and close releases audio', async (t) => {
  const audio = new AudioMock();
  const fileId = virtualFileId('music', 'Sport Dubstep.mp3');
  const h = playerHarness({
    metadata: { [fileId]: { ...mediaLibrary[fileId], resource: mediaLibraryResources[fileId] } },
    AudioConstructor: () => audio,
  });
  t.after(h.restoreDocument);
  h.player.open(fileId, { autoplay: true });
  await Promise.resolve();
  const instance = h.player.instance;
  instance.element.titlebar.children[0].dispatch('click');
  assert.equal(instance.element.hidden, true);
  assert.equal(audio.paused, false);
  instance.task.dispatch('click');
  assert.equal(instance.element.hidden, false);
  assert.equal(audio.paused, false);
  h.manager.windows.get(instance.id).onDismiss({ reason: 'close' });
  assert.equal(audio.paused, true);
  assert.equal(h.player.instance, null);
  assert.equal(h.player.audio, null);
  assert.equal(instance.task.isConnected, false);
  h.player.dispose();
});

test('natural completion advances through the queue and stops at its end without wrapping', async (t) => {
  const audio = new AudioMock();
  const h = playerHarness({
    metadata: Object.fromEntries(Object.entries(mediaLibraryResources).map(([fileId, resource]) => [
      fileId, { ...mediaLibrary[fileId], resource },
    ])),
    AudioConstructor: () => audio,
  });
  t.after(h.restoreDocument);
  const first = virtualFileId('music', 'Sport Dubstep.mp3');
  const last = virtualFileId('music', 'Lost In Time-Nightcore.mp3');
  h.player.open(first, { autoplay: true });
  await Promise.resolve();
  h.player.next(true);
  h.player.next(true);
  h.player.next(true);
  assert.equal(h.player.selectedId, last);
  audio.currentTime = 12;
  audio.emit('ended');
  assert.equal(h.player.selectedId, last);
  assert.equal(audio.paused, true);
  assert.equal(audio.currentTime, 0);
  h.player.dispose();
});

test('game music temporarily owns audio focus and resumes only a player that was not manually paused', async (t) => {
  const audio = new AudioMock();
  const h = playerHarness({
    metadata: { [virtualFileId('music', 'Sport Dubstep.mp3')]: {
      ...mediaLibrary[virtualFileId('music', 'Sport Dubstep.mp3')],
      resource: mediaLibraryResources[virtualFileId('music', 'Sport Dubstep.mp3')],
    } },
    AudioConstructor: () => audio,
  });
  t.after(h.restoreDocument);
  h.player.open(virtualFileId('music', 'Sport Dubstep.mp3'));
  await h.player.play();
  const game = createGameMusic('/test/game.mp3', () => new AudioMock());
  game.start();
  assert.equal(audio.paused, true);
  game.stop();
  await Promise.resolve();
  assert.equal(audio.paused, false);
  game.start();
  h.player.pause(true);
  const plays = audio.playCalls;
  game.stop();
  await Promise.resolve();
  assert.equal(audio.playCalls, plays);
  assert.equal(audio.paused, true);
  game.dispose();
  h.player.dispose();
});
