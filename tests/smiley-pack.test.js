import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Progression } from '../src/story/progression.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { ConversationWindow, appendMessageText } from '../src/ui/conversation.js';
import { Messenger } from '../src/ui/messenger.js';
import { DesktopApplications } from '../src/ui/desktop-apps.js';
import { SmileyPackInstaller } from '../src/ui/smiley-pack-installer.js';
import { VirtualFilesystem, virtualFileId } from '../src/story/virtual-filesystem.js';
import { isSmileyPackInstalled, insertEmoticon, smileyPackEmoticons } from '../src/ui/smiley-pack-emoticons.js';

const story = JSON.parse(await (await import('node:fs/promises')).readFile(
  new URL('../src/config/story.json', import.meta.url),
  'utf8',
));
const intro = JSON.parse(await (await import('node:fs/promises')).readFile(
  new URL('../src/dialogues/pixelgirl-intro.json', import.meta.url),
  'utf8',
));

class FakeElement {
  constructor() {
    this.isConnected = true;
    this.hidden = false;
    this.dataset = {};
    this.listeners = new Map();
    this.attributes = {};
    this.children = [];
    this.style = {};
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    };
    this.value = '';
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  click() {
    for (const listener of this.listeners.get('click') ?? []) listener({ target: this });
    this.onclick?.({ target: this });
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({ target: this, ...event });
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  remove() { this.isConnected = false; }
  focus() { this.focused = true; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
}

class FakeInstallerContent extends FakeElement {
  set innerHTML(markup) {
    this.markup = markup;
    this.buttons = new Map();
    this.progress = new FakeElement();
  }
  querySelector(selector) {
    if (selector === '.smiley-pack-installer-content progress') return this.progress;
    const action = selector.match(/data-action="([^"]+)"/)?.[1];
    if (!action || !this.markup.includes(`data-action="${action}"`)) return null;
    if (!this.buttons.has(action)) this.buttons.set(action, new FakeElement());
    return this.buttons.get(action);
  }
}

function installerSetup({ realTimers = false } = {}) {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const progression = new Progression(story, storage);
  const calls = [];
  const manager = {
    windows: new Map(),
    spawn(type, options) {
      const id = calls.length + 1;
      calls.push({ type, ...options });
      const element = new FakeElement();
      const content = new FakeInstallerContent();
      element.querySelector = (selector) => selector === '.smiley-pack-installer-content'
        ? content
        : content.querySelector(selector);
      this.windows.set(id, { element, onDismiss: options.onDismiss });
      return id;
    },
    close(id) {
      const window = this.windows.get(id);
      if (!window) return;
      window.element.remove();
      this.windows.delete(id);
      window.onDismiss?.();
    },
  };
  const applications = {
    instances: new Map(),
    restores: 0,
    attachWindow(key, id, title) {
      const instance = { key, id, title, element: manager.windows.get(id).element, task: new FakeElement() };
      this.instances.set(key, instance);
      return instance;
    },
    restore(instance) { this.restores++; instance.element.hidden = false; },
    onWindowState() {},
  };
  const intervals = [];
  const cleared = [];
  let now = 0;
  let installedEvents = 0;
  const installer = realTimers
    ? new SmileyPackInstaller(manager, applications, progression, { onInstalled: () => installedEvents++ })
    : new SmileyPackInstaller(manager, applications, progression, {
      setIntervalFn: (callback, delay) => (intervals.push({ callback, delay }), intervals.length),
      clearIntervalFn: (id) => cleared.push(id),
      nowFn: () => now,
      onInstalled: () => installedEvents++,
    });
  return {
    progression, values, calls, manager, applications, intervals, cleared, installer,
    advance: (ms) => { now += ms; },
    installedEvents: () => installedEvents,
  };
}

test('the virtual installer activates once, persists across reloads, and New Game resets it', () => {
  const { progression, calls, manager, applications, intervals, cleared, installer, advance, installedEvents } = installerSetup();
  const initialFilesystem = JSON.stringify(progression.data.virtualFilesystem);
  const instance = installer.open('smiley-pack-2009-folder/smiley pack 2009.exe');
  assert.equal(instance.step, 'welcome');
  assert.match(instance.element.querySelector('.smiley-pack-installer-content').markup,
    /Bienvenue dans l’assistant d’installation de Smiley Pack 2009 !/);
  assert.equal(installer.open(instance.fileId), instance);
  assert.equal(calls.length, 1, 'a second launch restores the open assistant');
  assert.equal(calls[0].resizable, false);
  assert.equal(calls[0].maximizable, false);

  const content = instance.element.querySelector('.smiley-pack-installer-content');
  const installButton = content.querySelector('[data-action="install"]');
  installButton.click();
  installButton.click();
  assert.equal(instance.step, 'installing');
  assert.equal(instance.element.classList.contains('is-installing'), true);
  assert.match(content.markup, /Installation des émoticônes\.\.\./);
  const progressBar = content.progress;
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].delay, 40);
  advance(1000);
  intervals[0].callback();
  assert.equal(progressBar.value, 50);
  advance(1000);
  intervals[0].callback();
  assert.equal(progressBar.value, 100);
  assert.equal(instance.step, 'installing', 'the completed bar remains visible for a paint before success');
  intervals[0].callback();
  assert.equal(instance.step, 'complete');
  assert.equal(instance.element.classList.contains('is-installing'), false);
  assert.equal(progressBar.value, 100);
  assert.equal(isSmileyPackInstalled(progression), true);
  assert.equal(installedEvents(), 1);
  assert.equal(JSON.stringify(progression.data.virtualFilesystem), initialFilesystem,
    'installation changes only the saved installation flag');
  assert.deepEqual(cleared, [1]);
  assert.equal(instance.element.classList.contains('is-installing'), false,
    'closing resets its loading cursor state');
  assert.match(content.markup, /Les nouvelles émoticônes sont maintenant disponibles dans Windows Love Messenger\./);
  content.querySelector('[data-action="finish"]').click();

  const reloaded = new Progression(story, progression.storage);
  assert.equal(isSmileyPackInstalled(reloaded), true);
  const restoredInstaller = new SmileyPackInstaller(manager, applications, reloaded);
  const alreadyInstalled = restoredInstaller.open(instance.fileId);
  assert.equal(alreadyInstalled.step, 'already-installed');
  assert.match(alreadyInstalled.element.querySelector('.smiley-pack-installer-content').markup,
    /Smiley Pack 2009 est déjà installé\./);
  manager.close(alreadyInstalled.id);

  reloaded.newGame();
  assert.equal(isSmileyPackInstalled(reloaded), false);
  const freshInstaller = new SmileyPackInstaller(manager, applications, reloaded);
  assert.equal(freshInstaller.open(instance.fileId).step, 'welcome');
});

test('smiley installation advances on real asynchronous time and activates once at completion', async () => {
  const { progression, installer, installedEvents } = installerSetup({ realTimers: true });
  const instance = installer.open('smiley-pack-2009-folder/smiley pack 2009.exe');
  const content = instance.element.querySelector('.smiley-pack-installer-content');
  content.querySelector('[data-action="install"]').click();
  await new Promise((resolve) => setTimeout(resolve, 1050));
  assert.equal(instance.step, 'installing');
  assert.ok(content.progress.value > 0 && content.progress.value < 100);
  assert.equal(instance.element.classList.contains('is-installing'), true);
  await new Promise((resolve) => setTimeout(resolve, 1150));
  assert.equal(instance.step, 'complete');
  assert.equal(instance.element.classList.contains('is-installing'), false);
  assert.equal(isSmileyPackInstalled(progression), true);
  assert.equal(installedEvents(), 1);
});

test('closing during installation cancels the timer and no late callback activates the pack', () => {
  const { progression, manager, intervals, cleared, installer, advance } = installerSetup();
  const instance = installer.open('smiley-pack-2009-folder/smiley pack 2009.exe');
  const content = instance.element.querySelector('.smiley-pack-installer-content');
  content.querySelector('[data-action="install"]').click();
  manager.close(instance.id);
  assert.deepEqual(cleared, [1]);
  advance(5000);
  intervals[0].callback();
  assert.equal(isSmileyPackInstalled(progression), false);
  assert.equal(instance.element.isConnected, false);
});

test('the Explorer WinRoar action extracts the pack and creates only its virtual installer', (t) => {
  const progression = new Progression(story);
  const filesystem = new VirtualFilesystem(progression);
  const archive = filesystem.getFile(virtualFileId('downloads', 'smileys_pack_2009.zip'));
  const extract = new FakeElement();
  const deleteButton = new FakeElement();
  const properties = new FakeElement();
  const winRoarStatus = new FakeElement();
  const winRoarProgress = new FakeElement();
  const winRoarTitle = new FakeElement();
  const spawned = [];
  const cleared = [];
  const manager = {
    windows: new Map(),
    spawn(type, options) { spawned.push({ type, ...options }); return spawned.length; },
  };
  const app = Object.assign(Object.create(DesktopApplications.prototype), {
    manager,
    virtualFilesystem: filesystem,
    instances: new Map(),
    onWindowState() {},
    onFilesystemChange() {},
    refreshExplorers() {},
    attachWindow(key, id) {
      const instance = {
        id,
        key,
        element: {
          isConnected: true,
          querySelector(selector) {
            if (selector === '.winroar-extraction strong') return winRoarTitle;
            if (selector.includes('progress')) return winRoarProgress;
            if (selector.includes('status')) return winRoarStatus;
            return null;
          },
        },
        task: new FakeElement(),
      };
      this.instances.set(key, instance);
      manager.windows.set(id, { element: instance.element });
      return instance;
    },
    restore() {},
  });
  let timerCallback;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback, delay) => {
    assert.equal(delay, 50);
    timerCallback = callback;
    return 19;
  };
  globalThis.clearInterval = (id) => cleared.push(id);
  t.after(() => {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  });

  const explorerInstance = {
    explorerMenu: {
      style: {},
      offsetWidth: 0,
      offsetHeight: 0,
      querySelector: (selector) => selector.includes('extract') ? extract : selector.includes('delete') ? deleteButton : properties,
    },
    current: filesystem.getLocation('downloads'),
    element: { querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) }) },
  };
  app.showExplorerContext(explorerInstance, archive, { clientX: 30, clientY: 40 });
  assert.equal(extract.hidden, false, 'the existing WinRoar context action is available for the archive');
  const winRoar = app.extractWithWinRoar(archive);
  assert.ok(winRoar);
  assert.match(spawned[0].content.body, /winroar-extraction/);
  assert.equal(winRoarTitle.textContent, 'Extraction de smileys_pack_2009.zip');
  for (let index = 0; index < 60; index++) timerCallback();
  assert.equal(winRoarProgress.value, 1);
  assert.equal(winRoarStatus.textContent, 'Extraction terminée.');
  const folder = filesystem.getLocation('downloads').items.find((item) => item.name === 'smiley_pack_2009');
  assert.equal(folder.directory, true);
  assert.deepEqual(filesystem.getLocation(folder.location).items.map((file) => file.name), ['Smiley Pack 2009.exe']);
  assert.deepEqual(cleared, [19]);
});

test('the installed picker inserts distinct shortcuts and displays original pixel art without converting xD', (t) => {
  const previous = globalThis.document;
  const textNode = (text) => ({ textContent: text, nodeType: 3 });
  globalThis.document = {
    baseURI: 'https://game.example/',
    createTextNode: textNode,
    createElement: () => new FakeElement(),
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  for (const emoticon of smileyPackEmoticons) {
    assert.match(emoticon.token, /^:[a-z]+:$/);
    assert.ok(existsSync(fileURLToPath(emoticon.src)));
  }
  assert.equal(smileyPackEmoticons.length, 7);

  const progression = new Progression(story);
  progression.data.flags.smileyPack2009Installed = true;
  const classicList = new FakeElement();
  const customList = new FakeElement();
  const preview = new FakeElement();
  const customTitle = new FakeElement();
  const panel = { element: { querySelector: (selector) => ({
    '.messenger-emoticons': classicList,
    '.messenger-custom-emoticons': customList,
    '.custom-emoticons-title': customTitle,
    '.emoticon-preview': preview,
  })[selector] } };
  const input = new FakeElement();
  input.value = 'salut ';
  input.selectionStart = input.selectionEnd = input.value.length;
  const conversation = { querySelector: () => input };
  const messenger = Object.assign(Object.create(Messenger.prototype), {
    progression,
    panel: () => panel,
  });
  messenger.emoticons(conversation);
  assert.equal(customList.children.length, 7);
  const selected = customList.children.find((button) => button.dataset.emoticonToken === ':pixelcat:');
  selected.click();
  assert.equal(input.value, 'salut :pixelcat:');
  assert.equal(input.focused, true);
  assert.equal(preview.textContent, 'Inséré dans votre message : :pixelcat:');

  const rendered = new FakeElement();
  appendMessageText(rendered, 'xD :pixelcat: :)', { smileyPackInstalled: true });
  assert.ok(rendered.children.some((node) => node.nodeType === 3 && node.textContent === 'xD '));
  assert.ok(rendered.children.some((node) => node.className === 'msn-emoticon msn-custom-emoticon'));
  assert.ok(rendered.children.some((node) => node.alt === ':)'));
  const notInstalled = new FakeElement();
  appendMessageText(notInstalled, ':pixelcat: xD', { smileyPackInstalled: false });
  assert.equal(notInstalled.children.some((node) => node.className?.includes('msn-custom-emoticon')), false);
  assert.ok(notInstalled.children.some((node) => node.nodeType === 3 && node.textContent === ':pixelcat: xD'));
});

test('player messages use the saved conversation thread without changing narrative dialogue data', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.begin();
  progression.data.flags.smileyPack2009Installed = true;
  const thread = new ConversationThread('pixelgirl', progression, () => [intro]);
  const dialogueSnapshot = JSON.stringify(progression.data.dialogues);
  const window = Object.assign(Object.create(ConversationWindow.prototype), {
    isSmileyPackInstalled: () => isSmileyPackInstalled(progression),
    offlineContact: null,
    thread,
    playerMessageInput: { value: '  Coucou :party:  ' },
    appendHistory() {},
  });
  assert.equal(window.sendPlayerMessage(), true);
  assert.equal(window.playerMessageInput.value, '');
  assert.equal(thread.state.history.at(-1).text, 'Coucou :party:');
  assert.equal(thread.state.history.at(-1).speaker, 'player');
  assert.equal(JSON.stringify(progression.data.dialogues), dialogueSnapshot);
  const restored = new Progression(story, storage);
  const restoredThread = new ConversationThread('pixelgirl', restored, () => [intro]);
  assert.equal(restoredThread.state.history.at(-1).text, 'Coucou :party:');
  restored.newGame();
  assert.equal(isSmileyPackInstalled(restored), false);
  assert.equal(new ConversationThread('pixelgirl', restored, () => [intro]).state.history.length, 0);
});

test('emoticon insertion respects the current text selection', () => {
  const input = new FakeElement();
  input.value = 'bonsoir !';
  input.selectionStart = 8;
  input.selectionEnd = 9;
  assert.equal(insertEmoticon(input, ':sparkle:'), true);
  assert.equal(input.value, 'bonsoir :sparkle:');
  assert.equal(input.selectionStart, 17);
  assert.equal(input.selectionEnd, 17);
});
