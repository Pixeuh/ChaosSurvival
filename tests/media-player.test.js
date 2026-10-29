import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Progression } from '../src/story/progression.js';
import { VirtualFilesystem, virtualFileId } from '../src/story/virtual-filesystem.js';
import { DesktopApplications } from '../src/ui/desktop-apps.js';
import { AudioPlayback, drawSpectrum, formatMediaTime, WindowsMediaPlay } from '../src/ui/media-player.js';
import { isMediaTrack, mediaAudioResource } from '../src/ui/media-library.js';
import { iconCellTop, layoutIconCells } from '../src/ui/desktop-icons.js';

const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url), 'utf8'));
const filesystemConfig = JSON.parse(readFileSync(new URL('../src/config/filesystem.json', import.meta.url), 'utf8'));
const memory = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
};

const expected = [
  {
    name: 'Sport Dubstep.mp3',
    artist: 'Kulakovka',
    audioRef: 'sport-dubstep-kulakovka',
    resource: 'kulakovka-sport-dubstep-283969.mp3',
    size: 4162037,
  },
  {
    name: 'I Love Chiptune Punk.mp3',
    artist: 'Brutaldesign',
    audioRef: 'i-love-chiptune-punk-brutaldesign',
    resource: 'brutaldesign-i-love-chiptune-punk-506083.mp3',
    size: 5680065,
  },
  {
    name: 'Lost In Time-Nightcore.mp3',
    artist: 'NightcoreFreeMusic4u',
    audioRef: 'lost-in-time-nightcore-nightcorefreemusic4u',
    resource: 'nightcorefreemusic4u-lost-in-time-nightcore-310196.mp3',
    size: 5909760,
  },
];

class FakeAudio {
  constructor() {
    this.listeners = new Map();
    this.src = '';
    this.currentTime = 0;
    this.duration = 0;
    this.volume = 1;
    this.muted = false;
    this.paused = true;
    this.loadCount = 0;
    this.playCount = 0;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type, currentTarget: this });
  }
  load() {
    this.loadCount++;
    if (this.src) {
      this.duration = 196.25;
      this.dispatch('loadedmetadata');
      this.dispatch('durationchange');
    }
  }
  async play() {
    this.playCount++;
    this.paused = false;
    this.dispatch('playing');
  }
  pause() {
    this.paused = true;
    this.dispatch('pause');
  }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}

function getTracks(filesystem) {
  return filesystem.getLocation('music').items.filter(isMediaTrack).map((file) => ({
    ...file,
    src: mediaAudioResource(file.audioRef),
  }));
}

test('the three requested real tracks are virtual files with stable IDs, exact sizes and local asset URLs', () => {
  const filesystem = new VirtualFilesystem(new Progression(story, memory()));
  const configured = filesystemConfig.music.items.filter(isMediaTrack);
  const tracks = getTracks(filesystem);
  assert.equal(tracks.length, 3);
  assert.deepEqual(configured.map(({ name, artist, audioRef, size }) => ({ name, artist, audioRef, size })),
    expected.map(({ name, artist, audioRef, size }) => ({ name, artist, audioRef, size })));

  for (const track of tracks) {
    const expectedTrack = expected.find((item) => item.audioRef === track.audioRef);
    assert.equal(track.fileId, virtualFileId('music', expectedTrack.name));
    assert.equal(track.detail.startsWith('Fichier MP3'), true);
    assert.equal(filesystem.canDelete(track.fileId), true);
    assert.equal(track.size, statSync(new URL(`../assets/${expectedTrack.resource}`, import.meta.url)).size);
    const resource = mediaAudioResource(track.audioRef);
    assert.ok(resource);
    assert.equal(existsSync(fileURLToPath(resource)), true);
    assert.equal(fileURLToPath(resource), fileURLToPath(new URL(`../assets/${expectedTrack.resource}`, import.meta.url)));
  }
  assert.deepEqual(filesystem.getLocation('music').items.filter((item) =>
    ['Pixel Dreams.mp3', 'CyberLove.mp3', 'Midnight.exe.mp3', 'Summer 2009.mp3'].includes(item.name),
  ), []);
});

test('virtual MP3 deletion persists on reload and New Game restores only the original library', () => {
  const disk = memory();
  const progression = new Progression(story, disk);
  const filesystem = new VirtualFilesystem(progression);
  const trackId = virtualFileId('music', expected[0].name);
  assert.equal(filesystem.deleteFile(trackId).ok, true);
  assert.equal(new VirtualFilesystem(new Progression(story, disk)).exists(trackId), false);
  progression.newGame();
  const fresh = new VirtualFilesystem(progression);
  assert.equal(fresh.getLocation('music').items.filter(isMediaTrack).length, 3);
  assert.equal(fresh.exists(trackId), true);
});

test('K7 transfer exposes the provided local MP3 as SON_FINAL_8.mp3 and keeps it in received files after reload', () => {
  const disk = memory();
  const progression = new Progression(story, disk);
  const filesystem = new VirtualFilesystem(progression);
  const file = progression.receiveFile({
    id: 'k7-son-final-8',
    name: 'SON_FINAL_8.mp3',
    sizeLabel: '1,8 Mo',
    size: 1838184,
    description: 'Fichier MP3 partagé par K7',
    title: 'SON_FINAL_8',
    artist: 'K7',
    audioRef: 'k7-son-final-8',
  }, 'k7-intro', 'remix-transfer');
  assert.equal(filesystem.getLocation('downloads').items.some((item) => item.name === file.name), false,
    'the proposed file stays unavailable until transfer completes');
  progression.finishTransfer(file.key);

  const restoredFilesystem = new VirtualFilesystem(new Progression(story, disk));
  const received = restoredFilesystem.getLocation('downloads').items.find((item) => item.name === 'SON_FINAL_8.mp3');
  assert.ok(received);
  assert.equal(received.audioRef, 'k7-son-final-8');
  assert.equal(isMediaTrack(received), true);
  const source = mediaAudioResource(received.audioRef);
  assert.equal(existsSync(fileURLToPath(source)), true);
  assert.equal(fileURLToPath(source), fileURLToPath(new URL('../assets/dragon-studio-uplifting-trance-584759.mp3', import.meta.url)));
});

test('player controls use real media events, one audio element, and stop cleanly on disposal', async () => {
  const filesystem = new VirtualFilesystem(new Progression(story, memory()));
  const tracks = getTracks(filesystem);
  const audio = new FakeAudio();
  let updates = 0;
  let preparations = 0;
  const playback = new AudioPlayback(audio, () => updates++, () => preparations++);
  playback.setTracks(tracks);

  assert.equal(await playback.play(tracks[0].fileId), true);
  assert.equal(audio.src, tracks[0].src);
  assert.equal(audio.playCount, 1);
  assert.equal(playback.state, 'playing');
  assert.equal(preparations, 1);
  playback.seek(44.5);
  assert.equal(audio.currentTime, 44.5);
  playback.setVolume(0.37);
  assert.equal(audio.volume, 0.37);
  playback.setMuted(true);
  assert.equal(audio.muted, true);
  playback.toggleMuted();
  assert.equal(audio.muted, false);
  playback.pause();
  assert.equal(playback.state, 'paused');
  assert.equal(await playback.play(), true);
  assert.equal(audio.currentTime, 44.5, 'resume keeps the current position');
  playback.stop();
  assert.equal(audio.currentTime, 0);
  assert.equal(playback.state, 'stopped');

  assert.equal(await playback.next(), true);
  assert.equal(playback.currentTrack.fileId, tracks[1].fileId);
  audio.currentTime = 0;
  assert.equal(await playback.previous(), true);
  assert.equal(playback.currentTrack.fileId, tracks[0].fileId);
  audio.dispatch('ended');
  await Promise.resolve();
  assert.equal(playback.currentTrack.fileId, tracks[1].fileId, 'ended advances to the next track');
  playback.seek(196);
  assert.equal(audio.currentTime, 196, 'seeking clamps against the loaded real duration');
  assert.equal(formatMediaTime(audio.duration), '03:16');
  assert.ok(updates > 0);

  playback.dispose();
  assert.equal(audio.paused, true);
  assert.equal(audio.src, '');
  assert.equal([...audio.listeners.values()].flatMap((set) => [...set]).length, 0);
});

test('visual spectrum bars are drawn from analyser samples and stay idle without a playing signal', () => {
  const heights = [];
  const context = {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect: (_x, _y, _width, height) => heights.push(height),
  };
  const measured = drawSpectrum(context, 120, 60, new Uint8Array([0, 32, 64, 128, 255]));
  assert.deepEqual(measured, heights);
  assert.ok(measured[0] < measured.at(-1));
  assert.ok(measured.at(-1) > 50);
});

test('known MP3 files and media-play.exe delegate through the shared executable launcher', () => {
  const filesystem = new VirtualFilesystem(new Progression(story, memory()));
  const launches = [];
  const app = Object.assign(Object.create(DesktopApplications.prototype), {
    virtualFilesystem: filesystem,
    onLaunchExecutable: (...args) => { launches.push(args); return 'media-player'; },
  });
  const music = filesystem.getLocation('music');
  const track = music.items.find(isMediaTrack);
  assert.equal(app.openFile(music, track), 'media-player');
  assert.deepEqual(launches[0], ['windows-media-play', track, track.fileId]);

  const installFolder = filesystem.getLocation('media-files');
  const executable = installFolder.items.find((item) => item.name === 'media-play.exe');
  assert.equal(app.openFile(installFolder, executable), 'media-player');
  assert.equal(launches[1][0], 'windows-media-play');
});

test('initial desktop icon cells use the requested visible order and preserve saved cells', () => {
  const bin = 'shortcut:bin';
  const ids = [
    'shortcut:computer', 'shortcut:folder', 'shortcut:msn', 'shortcut:browser',
    'shortcut:windows-media-play', 'shortcut:music', bin,
  ];
  const grid = { cols: 4, rows: 8 };
  const layout = (saved) => layoutIconCells(ids, saved, grid);
  const fresh = layout({});
  assert.deepEqual(fresh.get(bin), { col: 0, row: 0 });
  assert.deepEqual(fresh.get('shortcut:browser'), { col: 0, row: 4 });
  assert.deepEqual(fresh.get('shortcut:windows-media-play'), { col: 0, row: 5 });
  assert.deepEqual(fresh.get('shortcut:music'), { col: 0, row: 6 });
  assert.deepEqual(fresh.get('shortcut:computer'), { col: 0, row: 1 });
  assert.deepEqual(fresh.get('shortcut:folder'), { col: 0, row: 2 });
  assert.deepEqual(fresh.get('shortcut:msn'), { col: 0, row: 3 });
  assert.equal(iconCellTop(fresh.get('shortcut:browser')), 436);
  assert.equal(iconCellTop(fresh.get('shortcut:windows-media-play')), 540);
  assert.equal(iconCellTop(fresh.get('shortcut:music')), 644);
  assert.equal(new Set([...fresh.values()].map((cell) => `${cell.col}:${cell.row}`)).size, ids.length);
  assert.deepEqual([fresh.get('shortcut:windows-media-play'), fresh.get('shortcut:music')], [
    { col: 0, row: fresh.get('shortcut:music').row - 1 }, fresh.get('shortcut:music'),
  ]);
  assert.equal(fresh.get('shortcut:browser').row + 1, fresh.get('shortcut:windows-media-play').row);

  const customized = { 'shortcut:browser': { col: 2, row: 2 }, 'shortcut:music': { col: 1, row: 3 } };
  const restored = layout(customized);
  assert.deepEqual(restored.get('shortcut:browser'), customized['shortcut:browser']);
  assert.deepEqual(restored.get('shortcut:music'), customized['shortcut:music']);
  const gameMoved = layout({ 'shortcut:music': { col: 3, row: 4 } });
  assert.deepEqual(gameMoved.get('shortcut:music'), { col: 3, row: 4 });
  assert.deepEqual(gameMoved.get('shortcut:windows-media-play'), { col: 3, row: 3 });
  assert.equal(new Set([...restored.values()].map((cell) => `${cell.col}:${cell.row}`)).size, ids.length);
});

class FakeNode {
  constructor(className = '') {
    this.className = className;
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.attributes = {};
    this.style = {};
    this.hidden = false;
    this.isConnected = true;
    this.clientWidth = 320;
    this.clientHeight = 54;
    this.width = 0;
    this.height = 0;
    this.textContent = '';
    this.value = '';
    this.max = '';
    this.disabled = false;
    const tokens = new Set(className.split(/\s+/).filter(Boolean));
    this.classList = {
      add: (...names) => names.forEach((name) => tokens.add(name)),
      remove: (...names) => names.forEach((name) => tokens.delete(name)),
      toggle: (name, force) => {
        const next = force ?? !tokens.has(name);
        if (next) tokens.add(name); else tokens.delete(name);
        return next;
      },
      contains: (name) => tokens.has(name),
    };
  }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener));
  }
  dispatch(type, target = this) {
    for (const listener of this.listeners.get(type) ?? []) listener({ type, target, currentTarget: this });
  }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  remove() { this.isConnected = false; }
  closest(selector) { return selector === '[data-file-id]' && this.dataset.fileId ? this : null; }
  getContext() {
    this.context ??= {
      fills: [],
      createLinearGradient: () => ({ addColorStop() {} }),
      clearRect() {},
      fillRect(...rect) { this.fills.push(rect); },
      beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    };
    return this.context;
  }
  querySelector(selector) {
    const exact = this.selectors?.get(selector);
    if (exact) return exact;
    const className = selector.startsWith('.') ? selector.slice(1) : '';
    return className ? this.children.find((child) => child.classList.contains(className) || child.className.split(/\s+/).includes(className)) ?? null : null;
  }
  querySelectorAll(selector) {
    if (selector === '[data-media-action]') return this.actions ?? [];
    return [];
  }
}

function createPlayerElement() {
  const root = new FakeNode();
  root.selectors = new Map();
  const add = (selector, node = new FakeNode()) => (root.selectors.set(selector, node), node);
  add('.window-title > span');
  add('.wmp-visualizer');
  add('.wmp-seek');
  add('.wmp-volume-range');
  add('.wmp-current-title');
  add('.wmp-current-artist');
  add('.wmp-elapsed');
  add('.wmp-duration');
  add('.wmp-status');
  const actions = [];
  for (const action of ['previous', 'play', 'pause', 'stop', 'next', 'mute']) {
    const button = new FakeNode();
    button.dataset.mediaAction = action;
    actions.push(button);
  }
  root.actions = actions;
  root.selectors.set('[data-media-action="mute"]', actions.at(-1));
  return root;
}

function fakeAudioContext() {
  const analyser = {
    fftSize: 0,
    frequencyBinCount: 8,
    connected: false,
    connect() { this.connected = true; },
    disconnect() { this.connected = false; },
    getByteFrequencyData(samples) { samples.set([0, 24, 55, 90, 130, 180, 220, 255]); },
  };
  const source = { connected: false, connect() { this.connected = true; }, disconnect() { this.connected = false; } };
  return {
    state: 'running',
    destination: {},
    analyser,
    source,
    createAnalyser: () => analyser,
    createMediaElementSource: () => source,
    resume: async () => {},
    close: async function () { this.state = 'closed'; },
  };
}

test('the shared executable route opens one resizable player, plays explorer tracks, survives minimize, and disposes on close', async (t) => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: () => new FakeNode() };
  t.after(() => { globalThis.document = previousDocument; });

  const filesystem = new VirtualFilesystem(new Progression(story, memory()));
  const audioElements = [];
  const manager = {
    sequence: 0,
    windows: new Map(),
    spawn(_type, options) {
      const id = ++this.sequence;
      const element = createPlayerElement();
      this.windows.set(id, { element, options });
      return id;
    },
    close(id) {
      const window = this.windows.get(id);
      if (!window) return;
      window.element.remove();
      window.options.onDismiss?.();
      this.windows.delete(id);
    },
  };
  const applications = {
    instances: new Map(),
    restoreCount: 0,
    attachWindow(key, id) {
      const instance = { id, element: manager.windows.get(id).element, task: new FakeNode() };
      this.instances.set(key, instance);
      return instance;
    },
    restore(instance) { this.restoreCount++; instance.element.hidden = false; },
  };
  const callbacks = new Map();
  let callbackId = 0;
  const context = fakeAudioContext();
  const player = new WindowsMediaPlay(manager, applications, filesystem, {
    createAudio: () => { const audio = new FakeAudio(); audioElements.push(audio); return audio; },
    audioContextFactory: () => context,
    requestFrame: (callback) => { callbacks.set(++callbackId, callback); return callbackId; },
    cancelFrame: (id) => callbacks.delete(id),
  });
  const applicationsRouter = Object.assign(Object.create(DesktopApplications.prototype), {
    virtualFilesystem: filesystem,
    onLaunchExecutable: (applicationId, file, fileId) =>
      applicationId === 'windows-media-play' ? player.open(file, fileId) : null,
  });

  const executableLocation = filesystem.getLocation('media-files');
  const executable = executableLocation.items.find((item) => item.name === 'media-play.exe');
  const first = applicationsRouter.openFile(executableLocation, executable);
  const options = manager.windows.get(first.id).options;
  assert.equal(options.resizable, true);
  assert.equal(options.maximizable, true);
  assert.equal(options.minWidth, 420);
  assert.equal(options.minHeight, 330);
  assert.equal(options.windowClass, 'windows-media-play-window');
  assert.doesNotMatch(options.content.body, /Bibliothèque|wmp-track-list|wmp-library|wmp-sidebar/i);
  assert.match(options.content.body, /Aucun fichier en cours de lecture/);
  const buttonMarkup = [...options.content.body.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(([html]) => html);
  assert.equal(buttonMarkup.length, 6);
  assert.doesNotMatch(buttonMarkup.join(''), /\?/);
  assert.deepEqual(buttonMarkup.map((html) => html.match(/aria-label="([^"]+)"/)?.[1]), [
    'Pr&#233;c&#233;dent', 'Lecture', 'Pause', 'Stop', 'Suivant', 'Muet',
  ]);
  assert.ok(buttonMarkup.every((html) => /<svg\b[^>]*aria-hidden="true"[^>]*focusable="false"/.test(html)));
  assert.match(readFileSync(new URL('../src/styles-media-player.css', import.meta.url), 'utf8'),
    /aria-pressed='true'.*\.wmp-muted-x/);
  assert.equal(player.playback.state, 'stopped', 'opening the desktop shortcut does not start a track');
  assert.equal(applicationsRouter.openFile(executableLocation, executable), first);
  assert.equal(manager.sequence, 1, 'second launch reuses the existing window');

  const track = filesystem.getLocation('music').items.find(isMediaTrack);
  const same = applicationsRouter.openFile(filesystem.getLocation('music'), track);
  assert.equal(same, first);
  await Promise.resolve();
  assert.equal(player.playback.currentTrack.fileId, track.fileId);
  assert.equal(player.playback.state, 'playing');
  assert.equal(audioElements.length, 1, 'the simplified interface uses only the playback element');

  const k7File = player.virtualFilesystem.progression.receiveFile({
    id: 'k7-son-final-8',
    name: 'SON_FINAL_8.mp3',
    sizeLabel: '1,8 Mo',
    size: 1838184,
    description: 'Fichier MP3 partagé par K7',
    title: 'SON_FINAL_8',
    artist: 'K7',
    audioRef: 'k7-son-final-8',
  }, 'k7-intro', 'remix-transfer');
  player.virtualFilesystem.progression.finishTransfer(k7File.key);
  const received = player.virtualFilesystem.getLocation('downloads').items.find((item) => item.name === 'SON_FINAL_8.mp3');
  assert.equal(applicationsRouter.openFile(player.virtualFilesystem.getLocation('downloads'), received), first);
  await Promise.resolve();
  assert.equal(player.playback.currentTrack.fileId, received.fileId);
  assert.equal(player.audio.src, mediaAudioResource('k7-son-final-8'));
  assert.equal(audioElements.length, 1, 'the K7 track uses the existing Windows Media Play instance');
  const playbackAudio = player.audio;
  first.element.hidden = true;
  assert.equal(playbackAudio.paused, false, 'hiding/minimizing the window does not pause the audio');

  const frame = [...callbacks.entries()][0];
  assert.ok(frame);
  callbacks.delete(frame[0]);
  frame[1]();
  assert.ok(context.analyser.connected);
  assert.ok(first.element.querySelector('.wmp-visualizer').context.fills.length > 0);

  manager.close(first.id);
  assert.equal(playbackAudio.paused, true);
  assert.equal(playbackAudio.src, '');
  assert.equal(context.state, 'closed');
  assert.equal(applications.instances.has('windows-media-play'), false);
  assert.equal(callbacks.size, 0, 'visualizer animation is canceled on close');
});
