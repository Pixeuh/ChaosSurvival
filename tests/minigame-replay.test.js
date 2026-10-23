import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameRules } from '../src/ui/game-rules.js';
import { DesktopFiles } from '../src/ui/desktop-files.js';
import { MiniGameLauncher } from '../src/ui/minigame-launcher.js';
import { installDevelopmentVictoryShortcut } from '../src/dev/finish-shortcut.js';
import { Progression } from '../src/story/progression.js';
import { applyPlayerIdentity, playerIdentity } from '../src/ui/player-identity.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const story = JSON.parse(read('../src/config/story.json'));
const definition = JSON.parse(read('../src/minigames/smiley-catcher.json'));

function setup(progression, t, tutorials = false, onVictory) {
  const previousAudio = globalThis.Audio;
  const audioInstances = [];
  globalThis.Audio = class {
    constructor(url) {
      this.src = url;
      this.currentTime = 6;
      this.loop = false;
      this.volume = 1;
      this.playCount = 0;
      this.pauseCount = 0;
      audioInstances.push(this);
    }
    play() { this.playCount++; return Promise.resolve(); }
    pause() { this.pauseCount++; }
    removeAttribute(name) { this.removedAttribute = name; }
    load() { this.loaded = true; }
  };
  const element = () => ({
    style: {},
    dataset: {},
    children: [],
    handlers: {},
    isConnected: true,
    clientWidth: 500,
    clientHeight: 250,
    querySelector(selector) {
      this.selectors ??= new Map();
      if (!this.selectors.has(selector)) this.selectors.set(selector, element());
      return this.selectors.get(selector);
    },
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    attrs: {},
    focus() {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    append(child) {
      this.children.push(child);
    },
    remove() {
      this.isConnected = false;
    },
    replaceChildren() {
      this.children.forEach((child) => child.remove());
      this.children = [];
    },
  });
  const manager = {
    windows: new Map(),
    z: 10,
    sequence: 0,
    spawn(type, options) {
      const id = ++this.sequence;
      this.windows.set(id, { element: element(), options, type });
      return id;
    },
    close(id) {
      const item = this.windows.get(id);
      item.element.remove();
      this.windows.delete(id);
      item.options.onDismiss();
    },
    setDevelopmentContent(element, getContent) {
      const item = [...this.windows.values()].find((window) => window.element === element);
      if (!item) return false;
      item.developmentContent = getContent;
      return true;
    },
    activeDevelopmentContent() {
      const item = [...this.windows.values()].at(-1);
      return item?.element.isConnected && !item.element.hidden
        ? item.developmentContent?.() ?? null
        : null;
    },
  };
  let frame = 0;
  const frames = new Map();
  const visibility = new Set();
  const context = {
    progression,
    manager,
    ui: { desktop: element() },
    miniGames: { [definition.id]: definition },
    sounds: { unlock() {}, play() {} },
    document: {
      hidden: false,
      createElement: element,
      addEventListener(type, handler) {
        visibility.add(handler);
      },
      removeEventListener(type, handler) {
        visibility.delete(handler);
      },
    },
    requestAnimationFrame(handler) {
      frames.set(++frame, handler);
      return frame;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
  };
  const previous = {
    document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  Object.assign(globalThis, {
    document: context.document,
    requestAnimationFrame: context.requestAnimationFrame,
    cancelAnimationFrame: context.cancelAnimationFrame,
  });
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
    if (previousAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = previousAudio;
  });
  const rules = tutorials ? new GameRules(context.ui.desktop, progression) : undefined;
  const launcher = new MiniGameLauncher(
    context.miniGames,
    progression,
    manager,
    context.sounds,
    undefined,
    rules,
    onVictory,
  );
  context.rules = rules;
  const files = new DesktopFiles(
    context.ui.desktop,
    progression,
    (file) => launcher.open(file),
    () => {},
  );
  context.game = () => launcher.active;
  context.openDesktopFile = (file) => launcher.open(file);
  context.renderDesktopFiles = () => files.render();
  return { context, manager, visibility, audioInstances };
}

function savedRun() {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.begin();
  progression.complete('arcade-1');
  progression.complete('pixelgirl-hello');
  const file = progression.receiveFile(
    { id: 'super-mega-game', name: 'SUPER_MEGA_GAME.exe', launch: { game: definition.id } },
    'pixelgirl-intro',
    'file',
  );
  return { progression, storage, file };
}

function finish(game) {
  game.tick(0);
  game.tick(31000);
}

test('received mini-game launches only after transfer, closes and restarts from zero without duplicates', (t) => {
  const { progression, file } = savedRun();
  const { context, manager, visibility } = setup(progression, t);
  context.renderDesktopFiles();
  const desktopFiles = context.ui.desktop.querySelector('#desktop-files');
  assert.equal(desktopFiles.children.length, 0);
  context.openDesktopFile(file);
  assert.equal(manager.windows.size, 0);
  progression.finishTransfer(file.key);
  context.renderDesktopFiles();
  assert.equal(desktopFiles.children.length, 1);
  const shortcut = desktopFiles.children[0];
  assert.equal(shortcut.children[0].textContent, 'SUPER_MEGA_GAME');
  assert.equal(manager.windows.size, 0);
  shortcut.handlers.dblclick();
  const first = context.game();
  context.openDesktopFile(file);
  assert.equal(manager.windows.size, 1);
  assert.equal(context.game(), first);
  first.tick(0);
  first.tick(5000);
  assert.equal(first.elapsed, 5);
  manager.close([...manager.windows.keys()][0]);
  assert.equal(visibility.size, 0);
  assert.equal(progression.current.id, 'super-mega-game');
  context.openDesktopFile(file);
  const second = context.game();
  assert.notEqual(second, first);
  assert.equal(second.elapsed, 0);
  assert.equal(second.score, 0);
  assert.equal(second.finished, false);
  assert.equal(manager.windows.size, 1);
});

test('SmileyCatcher result agrees with the restored human profile without changing its gameplay', (t) => {
  const original = { ...playerIdentity };
  t.after(() => applyPlayerIdentity(original));
  for (const [grammaticalGender, caption] of [['male', 'MEGA CHAMPION'], ['female', 'MEGA CHAMPIONNE']]) {
    applyPlayerIdentity({ nickname: 'PixelFan', identityGender: 'neither', grammaticalGender, completed: true });
    const { progression, file } = savedRun();
    progression.finishTransfer(file.key);
    const { context, manager } = setup(progression, t);
    context.openDesktopFile(file);
    const window = [...manager.windows.values()][0];
    assert.ok(window.options.content.body.includes(`★★★★★ ${caption} ★★★★★`));
    assert.doesNotMatch(window.options.content.body, /\{player\./);
    finish(context.game());
    assert.equal(context.game().finished, true);
    assert.equal(progression.current.id, 'pixelgirl-smiley-win');
    manager.close([...manager.windows.keys()][0]);
  }
});

test('SmileyCatcher music follows the round, pause, replay, victory and application cleanup', (t) => {
  const { progression, file } = savedRun();
  const { context, manager, audioInstances } = setup(progression, t);
  assert.equal(audioInstances.length, 0, 'Windows XD does not create the game music');
  context.openDesktopFile(file);
  assert.equal(audioInstances.length, 0, 'the locked file cannot start its music');
  progression.finishTransfer(file.key);
  context.openDesktopFile(file);
  assert.equal(audioInstances.length, 1);
  const audio = audioInstances[0];
  assert.match(audio.src, /djartmusic-i-love-my-8-bit-game-console-301272\.mp3$/);
  assert.equal(audio.loop, true);
  assert.equal(audio.volume, 0.35);
  assert.equal(audio.playCount, 1);

  const game = context.game();
  const pause = game.element.querySelector('.flash-pause');
  pause.handlers.click({ target: pause });
  assert.equal(audio.pauseCount, 1);
  pause.handlers.click({ target: pause });
  assert.equal(audio.playCount, 2);

  finish(game);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.pauseCount, 2);
  game.element.querySelector('.flash-replay').handlers.click();
  assert.equal(audioInstances.length, 1);
  assert.equal(audio.currentTime, 0);
  assert.equal(audio.playCount, 3);
  manager.close([...manager.windows.keys()][0]);
  assert.equal(audio.removedAttribute, 'src');
  assert.equal(audio.loaded, true);
});

test('finished mini-game stays single, can replay internally and from desktop after restart without repeating progression', (t) => {
  const { progression, storage, file } = savedRun();
  progression.finishTransfer(file.key);
  let victories = 0;
  const { context, manager } = setup(progression, t, false, () => victories++);
  context.openDesktopFile(file);
  const game = context.game();
  finish(game);
  assert.equal(game.finished, true);
  assert.equal(victories, 1);
  assert.equal(progression.current.id, 'pixelgirl-smiley-win');
  const saved = JSON.stringify(progression.data);
  context.openDesktopFile(file);
  assert.equal(context.game(), game);
  assert.equal(manager.windows.size, 1);
  game.element.querySelector('.flash-replay').handlers.click();
  assert.equal(game.elapsed, 0);
  assert.equal(game.result.hidden, true);
  finish(game);
  assert.equal(victories, 1);
  assert.equal(JSON.stringify(progression.data), saved);
  game.element.querySelector('.flash-return').handlers.click();
  assert.equal(manager.windows.size, 0);
  context.openDesktopFile(file);
  assert.equal(context.game().elapsed, 0);
  finish(context.game());
  assert.equal(JSON.stringify(progression.data), saved);
  const loaded = new Progression(story, storage);
  assert.equal(loaded.corrupt, undefined);
  assert.equal(loaded.data.files[file.key].status, 'complete');
  const reopened = setup(loaded, t);
  reopened.context.openDesktopFile(loaded.data.files[file.key]);
  finish(reopened.context.game());
  assert.equal(JSON.stringify(loaded.data), saved);
  assert.equal(reopened.manager.windows.size, 1);
});

test('development shortcut finishes Smiley normally once, cleans up and allows another round', (t) => {
  const { progression, file } = savedRun();
  progression.finishTransfer(file.key);
  const { context, manager, visibility } = setup(progression, t);
  context.openDesktopFile(file);
  const game = context.game();
  const launcherSource = read('../src/ui/minigame-launcher.js');
  assert.ok(
    launcherSource.indexOf('this.active.open();') < launcherSource.indexOf('setDevelopmentContent'),
    'the launcher registers development content after the game has created its window',
  );
  assert.equal(manager.setDevelopmentContent(game.element, () => game), true);
  let handler;
  let wins = 0;
  context.sounds.play = (sound) => {
    if (sound === 'victory') wins++;
  };
  const remove = installDevelopmentVictoryShortcut(
    {
      addEventListener(type, callback) {
        handler = callback;
      },
      removeEventListener(type, callback) {
        assert.equal(callback, handler);
        handler = null;
      },
    },
    () => manager.activeDevelopmentContent(),
  );
  const key = { key: 'D', ctrlKey: true, shiftKey: true, preventDefault() { this.defaultPrevented = true; } };
  handler({ ...key, repeat: true });
  handler({ ...key, ctrlKey: false });
  assert.equal(game.finished, false);
  handler(key);
  assert.equal(game.finished, true);
  assert.equal(key.defaultPrevented, true);
  assert.equal(game.result.hidden, false);
  assert.equal(game.elapsed, definition.durationSeconds);
  assert.equal(game.targets.length, 0);
  assert.equal(visibility.size, 0);
  assert.equal(progression.current.id, 'pixelgirl-smiley-win');
  const saved = JSON.stringify(progression.data);
  const repeated = { ...key, defaultPrevented: false };
  handler(repeated);
  assert.equal(repeated.defaultPrevented, false, 'an already-finished game is no longer an eligible target');
  game.tick(123456);
  assert.equal(wins, 1);
  assert.equal(JSON.stringify(progression.data), saved);
  game.element.querySelector('.flash-replay').handlers.click();
  assert.equal(visibility.size, 1);
  handler(key);
  assert.equal(wins, 2);
  assert.equal(JSON.stringify(progression.data), saved);
  remove();
  assert.equal(handler, null);
});

test('Smiley waits for its own rules, pauses voluntary review, saves approval and replays directly', (t) => {
  const { progression, file, storage } = savedRun();
  progression.finishTransfer(file.key);
  const { context, manager } = setup(progression, t, true);
  context.openDesktopFile(file);
  assert.equal(context.game(), null);
  assert.equal(manager.windows.size, 0);
  assert.equal(progression.data.completed.includes('super-mega-game'), false);
  const confirm = context.rules.layer.querySelector('.rules-confirm').handlers.click;
  confirm();
  confirm();
  assert.equal(manager.windows.size, 1);
  const game = context.game();
  assert.equal(progression.data.tutorials['smiley-catcher'], true);
  game.tick(0);
  game.tick(1000);
  game.element.querySelector('.flash-rules').handlers.click();
  assert.equal(game.paused, true);
  game.tick(9000);
  assert.equal(game.elapsed, 1);
  context.rules.layer.querySelector('.rules-confirm').handlers.click();
  assert.equal(game.paused, false);
  game.tick(10000);
  assert.equal(game.elapsed, 1);
  manager.close([...manager.windows.keys()][0]);
  context.openDesktopFile(file);
  assert.equal(context.rules.active, false);
  assert.equal(manager.windows.size, 1);
  const loaded = new Progression(story, storage);
  assert.equal(new GameRules(context.ui.desktop, loaded).hasSeen(definition), true);
  loaded.newGame();
  assert.equal(new GameRules(context.ui.desktop, loaded).hasSeen(definition), false);
});
