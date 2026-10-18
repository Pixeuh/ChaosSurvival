import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DialogueSession } from '../src/story/dialogue.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { Progression } from '../src/story/progression.js';
import { VirtualTextFiles } from '../src/story/text-files.js';
import { VirtualFilesystem } from '../src/story/virtual-filesystem.js';
import { orderedContacts, visibleContacts } from '../src/ui/contacts.js';
import { Messenger, identifyMessageSender, wizzNotificationContent } from '../src/ui/messenger.js';
import { playerIdentity } from '../src/ui/player-identity.js';
import {
  desktopApps,
  explorerLocation,
  explorerItem,
  DesktopApplications,
  fileViewer,
  localPicture,
} from '../src/ui/desktop-apps.js';
import { icon } from '../src/ui/icons.js';
import { ConversationWindow } from '../src/ui/conversation.js';
import { ExecutableRegistry } from '../src/ui/executable-registry.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const intro = read('../src/dialogues/pixelgirl-intro.json');
const turboScene = read('../src/dialogues/turbo-smiley-catcher.json');

test('display order is explicit, independent of creation order, and stable within connection groups', () => {
  const order = [
    'skater',
    'luna',
    'modem',
    'pixelgirl',
    'princess',
    'offline',
    'turbo',
    'k7',
    'm0rbid',
  ];
  const source = visibleContacts({ [intro.id]: intro }, []);
  const before = JSON.stringify(source);
  assert.deepEqual(
    orderedContacts([...source].reverse()).map((contact) => contact.id),
    order,
  );
  assert.equal(JSON.stringify(source), before);
  const connected = orderedContacts(
    visibleContacts({ [intro.id]: intro }, [intro.id], undefined, { turbo: { status: 'online' } }),
  );
  assert.deepEqual(
    connected.filter((contact) => contact.online).map((contact) => contact.id),
    ['pixelgirl', 'turbo'],
  );
  assert.deepEqual(
    connected.filter((contact) => !contact.online).map((contact) => contact.id),
    order.filter((id) => !['pixelgirl', 'turbo'].includes(id)),
  );
  const disconnected = orderedContacts(visibleContacts({ [intro.id]: intro }, [], undefined, {}));
  assert.deepEqual(
    disconnected.map((contact) => contact.id),
    order,
  );
  assert.ok(disconnected.every((contact) => !contact.online));
});

test('incoming group messages resolve stable participant IDs independently of displayed names', () => {
  const group = { id: 'plumber-group' };
  assert.deepEqual(identifyMessageSender(group, { author: 'xX_PixelGirl_Xx' }), { id: 'pixelgirl', name: 'PixelGirl' });
  assert.deepEqual(identifyMessageSender(group, { author: 'Turb0' }), { id: 'turbo', name: 'Turb0' });
  assert.deepEqual(identifyMessageSender(group, { author: '°•.LuNa.°•' }), { id: 'luna', name: 'Luna' });
  assert.deepEqual(identifyMessageSender(group, { author: 'Â°â€¢.LuNa.Â°â€¢' }), { id: 'luna', name: 'Luna' });
  assert.deepEqual(identifyMessageSender({ id: 'turbo', nickname: 'Turb0' }, {}), { id: 'turbo', name: 'Turb0' });
});

test('Wizz send events persist one chronological system entry for each sender without changing dialogues', async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const story = read('../src/config/story.json');
  const progression = new Progression(story, storage);
  progression.begin();
  progression.complete('arcade-1');
  const session = new DialogueSession(intro, progression);
  session.deliver();
  const thread = new ConversationThread('pixelgirl', progression, () => [intro]);
  const narrative = JSON.stringify(progression.data.dialogues);
  const classes = new Set();
  let refreshes = 0,
    notifications = 0;
  const sounds = [];
  const incomingWizzes = [];
  const view = {
    thread,
    refresh: () => refreshes++,
    element: {
      isConnected: true,
      hidden: false,
      style: { zIndex: 1 },
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    },
  };
  const messenger = new Messenger({
    manager: { windows: new Map() },
    progression,
    primary: () => view,
    definitions: () => ({ [intro.id]: intro }),
    sounds: { unlock: () => Promise.resolve(), play: (kind) => sounds.push(kind) },
    onMessage: (...args) => {
      notifications++;
      incomingWizzes.push(args);
    },
  });
  const first = thread.state.history[0];
  assert.equal(messenger.sendWizz('pixelgirl', { eventId: 'player-1' }), true);
  assert.equal(messenger.sendWizz('pixelgirl', { eventId: 'player-1' }), false);
  assert.equal(messenger.sendWizz('pixelgirl', { eventId: 'player-2' }), true);
  view.element.isConnected = false;
  assert.equal(messenger.receiveWizz('pixelgirl', 'npc-1'), true);
  assert.equal(messenger.receiveWizz('pixelgirl', 'npc-1'), false);
  assert.equal(messenger.sendWizz('skater'), false);
  assert.equal(messenger.receiveWizz('missing'), false);
  await Promise.resolve();
  assert.ok(classes.has('messenger-wizz'));
  assert.equal(refreshes, 3);
  assert.deepEqual(sounds, ['wizz', 'wizz', 'wizz']);
  assert.equal(notifications, 1);
  assert.equal(incomingWizzes[0][2][0].type, 'wizz');
  assert.equal(incomingWizzes[0][2][0].speaker, 'contact');
  assert.equal(incomingWizzes[0][4].active, false);
  assert.equal(thread.state.history[0], first);
  assert.deepEqual(
    thread.state.history.slice(1).map((entry) => entry.text),
    [
      'JustMe vous a envoyé un wizz !',
      'JustMe vous a envoyé un wizz !',
      'xX_PixelGirl_Xx vous a envoyé un wizz !',
    ],
  );
  assert.deepEqual(thread.state.unread, [first.key, 'wizz:npc-1']);
  assert.equal(JSON.stringify(progression.data.dialogues), narrative);
  const restored = new ConversationThread('pixelgirl', new Progression(story, storage), () => [
    intro,
  ]);
  assert.deepEqual(restored.state.history, thread.state.history);
  assert.equal(restored.sync().length, 4);
  restored.markRead();
  assert.equal(restored.state.unread.length, 0);
  assert.equal(restored.state.history.length, 4);
});

test('an incoming Wizz in the active conversation plays its effect without becoming unread', async () => {
  const progression = new Progression(read('../src/config/story.json'));
  progression.begin();
  progression.complete('arcade-1');
  const thread = new ConversationThread('pixelgirl', progression, () => [intro]);
  const classes = new Set();
  const events = [];
  let sounds = 0;
  const view = {
    thread,
    refresh() {},
    element: {
      isConnected: true,
      hidden: false,
      style: { zIndex: 1 },
      classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    },
  };
  const messenger = new Messenger({
    manager: { windows: new Map() },
    progression,
    primary: () => view,
    definitions: () => ({ [intro.id]: intro }),
    sounds: { unlock: () => Promise.resolve(), play: (kind) => { if (kind === 'wizz') sounds++; } },
    onMessage: (...args) => events.push(args),
  });

  assert.equal(messenger.receiveWizz('pixelgirl', 'active-wizz'), true);
  await Promise.resolve();
  assert.equal(sounds, 1);
  assert.ok(classes.has('messenger-wizz'));
  assert.deepEqual(thread.state.unread, []);
  assert.equal(events.length, 1);
  assert.equal(events[0][2][0].type, 'wizz');
  assert.equal(events[0][4].active, true);
});

test('Wizz toast content uses the sender name and the Wizz wording', () => {
  assert.deepEqual(wizzNotificationContent({ name: 'PixelGirl', nickname: 'xX_PixelGirl_Xx' }), {
    sender: 'PixelGirl',
    preview: 'vous a envoyé un wizz !',
  });
  assert.deepEqual(wizzNotificationContent({ name: 'Luna', nickname: 'Â°â€¢.LuNa.Â°â€¢' }), {
    sender: 'Luna',
    preview: 'vous a envoyé un wizz !',
  });
});

test('a malformed thread row is isolated while valid messages and other contacts survive reload', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const progression = new Progression(read('../src/config/story.json'), storage);
  progression.begin();
  const good = { key: 'good', speaker: 'contact', text: 'Historique conservé' };
  progression.data.conversations = {
    pixelgirl: {
      version: 1,
      history: [good, { key: 12, speaker: 'contact', text: 'invalid' }],
      unread: ['good', 12],
      activeEvent: null,
      pendingEvents: [],
    },
    turbo: {
      version: 1,
      history: [{ key: 'turbo-1', speaker: 'player', text: 'Réponse conservée' }],
      unread: [],
      activeEvent: null,
      pendingEvents: [],
    },
  };
  progression.save();
  const restored = new Progression(read('../src/config/story.json'), storage);
  const events = () => [];
  const pixel = new ConversationThread('pixelgirl', restored, events);
  assert.deepEqual(pixel.state.history, [good]);
  assert.deepEqual(pixel.state.unread, ['good']);
  assert.equal(restored.data.conversations.turbo.history[0].text, 'Réponse conservée');
  const again = new Progression(read('../src/config/story.json'), storage);
  assert.deepEqual(again.data.conversations.pixelgirl.history, [good]);
  assert.equal(again.data.conversations.turbo.history.length, 1);
});

test('Wizz rows use system presentation without an author or emoticon parsing', (t) => {
  const previous = globalThis.document;
  const row = { dataset: {} };
  globalThis.document = { createElement: () => row };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const rows = [];
  let scrolled = false;
  const view = {
    flow: { append: (item) => rows.push(item) },
    scrollLatest: () => (scrolled = true),
  };
  ConversationWindow.prototype.appendMessage.call(view, {
    type: 'wizz',
    key: 'wizz:1',
    speaker: 'contact',
    text: 'PixelGirl vous a envoyé un wizz !',
  });
  assert.equal(row.className, 'conversation-message conversation-system');
  assert.equal(row.dataset.messageKey, 'wizz:1');
  assert.equal(row.textContent, 'PixelGirl vous a envoyé un wizz !');
  assert.deepEqual(rows, [row]);
  assert.equal(scrolled, true);
  const legacy = { type: 'wizz', speaker: 'player', text: 'Moi vous a envoyé un wizz !' };
  ConversationWindow.prototype.appendMessage.call(view, legacy);
  assert.equal(row.textContent, 'JustMe vous a envoyé un wizz !');
  assert.equal(legacy.text, 'Moi vous a envoyé un wizz !', 'saved historical data is unchanged');
});

test('Messenger and conversation views share the central player profile instead of authored legacy names', () => {
  const progression = new Progression(read('../src/config/story.json'));
  const messenger = new Messenger({});
  const conversation = new ConversationWindow({}, intro, progression, {});
  assert.equal(playerIdentity.nickname, 'JustMe');
  assert.equal(messenger.player, playerIdentity);
  assert.equal(conversation.player, playerIdentity);
  assert.equal(intro.player.nickname, 'Moi', 'narrative JSON is not rewritten');
});

test('requested personal messages and distinct local avatars are available before narrative unlock', () => {
  const contacts = visibleContacts({ [intro.id]: intro }, []);
  for (const [id, message, avatar] of [
    ['pixelgirl', "☆ don't forget me ☆", 'pixelgirl.svg'],
    ['turbo', '♫ BASSHUNTER - DOTA ♫', 'turbo.svg'],
    ['luna', '♪ somewhere only we know', 'luna.svg'],
    ['offline', '', 'offline.svg'],
  ]) {
    const contact = contacts.find((contact) => contact.id === id);
    assert.equal(contact.personalMessage, message);
    assert.equal(contact.avatar, `./avatars/${avatar}`);
    const svg = readFileSync(new URL(`../public/avatars/${avatar}`, import.meta.url), 'utf8');
    assert.match(svg, /viewBox="0 0 (64 64|96 96)"/);
    assert.doesNotMatch(svg, /<script|<image|href=/);
  }
});

test('profiles reuse stable windows and update current status/message without changing narrative data; saved overrides reset with New Game', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const story = read('../src/config/story.json');
  const progression = new Progression(story, storage);
  const primary = { offlineContact: true, refresh() {} };
  const messenger = new Messenger({
    progression,
    definitions: () => ({ [intro.id]: intro }),
    primary: () => primary,
  });
  let panels = 0;
  messenger.panel = (key, title, body) => {
    if (messenger.views.has(key)) return messenger.views.get(key);
    assert.doesNotMatch(body, /biograph|intérêt/i);
    const fields = new Map();
    const instance = {
      element: {
        querySelector(selector) {
          if (!fields.has(selector)) fields.set(selector, {});
          return fields.get(selector);
        },
      },
    };
    messenger.views.set(key, instance);
    panels++;
    return instance;
  };
  const turbo = messenger.contacts().find((contact) => contact.id === 'turbo');
  const instance = messenger.profile(turbo),
    field = (selector) => instance.element.querySelector(selector);
  assert.equal(field('.messenger-profile img').src, './avatars/turbo.svg');
  assert.equal(field('img').src, undefined, 'the titlebar icon is not overwritten');
  assert.equal(field('h3').textContent, 'Turb0');
  assert.equal(field('.profile-status').textContent, 'Hors ligne');
  const before = JSON.stringify([progression.data.dialogues, progression.data.choices]);
  progression.data.contactConnections.turbo = { status: 'online' };
  progression.data.contactProfiles = { turbo: { personalMessage: 'new track' } };
  messenger.update();
  assert.equal(field('.profile-status').textContent, 'En ligne');
  assert.equal(field('.profile-message').textContent, 'new track');
  assert.equal(messenger.profile(turbo), instance);
  assert.equal(panels, 1);
  assert.equal(JSON.stringify([progression.data.dialogues, progression.data.choices]), before);
  progression.save();
  assert.equal(
    new Progression(story, storage).data.contactProfiles.turbo.personalMessage,
    'new track',
  );
  const offline = messenger.profile(
    messenger.contacts().find((contact) => contact.id === 'offline'),
  );
  assert.equal(offline.element.querySelector('.profile-message').hidden, true);
  progression.newGame();
  messenger.update();
  assert.equal(field('.profile-status').textContent, 'Hors ligne');
  assert.equal(field('.profile-message').textContent, '♫ BASSHUNTER - DOTA ♫');
});

test('text and picture viewers have independent windows and task controls without replacing the explorer', (t) => {
  const previous = globalThis.document;
  const create = () => ({
    children: [],
    handlers: {},
    dataset: {},
    style: {},
    attrs: {},
    isConnected: true,
    classList: { add() {} },
    append(...nodes) {
      this.children.push(...nodes);
    },
    insertBefore(node) {
      this.children.push(node);
    },
    replaceChildren() {
      this.children = [];
    },
    addEventListener(type, callback) {
      this.handlers[type] = callback;
    },
    removeEventListener(type) {
      delete this.handlers[type];
    },
    focus() {},
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
    remove() {
      this.isConnected = false;
    },
    querySelector(key) {
      this.fields ??= new Map();
      if (!this.fields.has(key)) this.fields.set(key, create());
      return this.fields.get(key);
    },
    querySelectorAll() {
      return [];
    },
  });
  globalThis.document = { createElement: create, addEventListener() {}, removeEventListener() {} };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const manager = {
    z: 10,
    windows: new Map(),
    calls: [],
    spawn(type, options) {
      const id = this.calls.length + 1;
      this.calls.push({ type, ...options });
      this.windows.set(id, { element: create(), onDismiss: options.onDismiss });
      return id;
    },
    close(id) {
      const entry = this.windows.get(id);
      if (entry.beforeClose?.() === false) return;
      entry.element.remove();
      this.windows.delete(id);
      entry.onDismiss();
    },
  };
  const app = new DesktopApplications(manager, create());
  const explorer = app.open('folder');
  assert.equal(manager.calls[0].resizable, true);
  assert.equal(manager.calls[0].maximizable, true);
  assert.equal(manager.calls[0].minWidth, 520);
  assert.equal(manager.calls[0].minHeight, 330);
  const location = explorer.current;
  const txt = location.items.find((item) => item.name.endsWith('.txt'));
  const notepad = app.openFile(location, txt);
  assert.equal(manager.calls[1].resizable, true);
  assert.equal(manager.calls[1].maximizable, true);
  assert.equal(manager.calls[1].minWidth, 360);
  assert.equal(manager.calls[1].minHeight, 260);
  assert.equal(explorer.current, location);
  assert.equal(explorer.element.isConnected, true);
  assert.equal(notepad.element.querySelector('.notepad-content').value, txt.text);
  assert.doesNotMatch(manager.calls[1].content.body, /readonly/);
  assert.equal(notepad.element.querySelector('.notepad-content').readOnly, false);
  const largeText = 'é'.repeat(51201);
  const large = app.openFile(location, { name: 'archive.txt', text: largeText });
  assert.equal(large.element.querySelector('.notepad-content').readOnly, true);
  assert.equal(large.element.querySelector('.notepad-content').value, largeText);
  manager.close(large.id);
  assert.ok(notepad.element.querySelector('.window-title > span').textContent.includes(txt.name));
  assert.equal(app.openFile(location, txt), notepad);
  const images = explorerLocation('images');
  const picture = app.openFile(images, images.items[0]);
  assert.equal(manager.calls[3].resizable, true);
  assert.equal(manager.calls[3].maximizable, true);
  assert.equal(manager.calls[3].minWidth, 320);
  assert.equal(manager.calls[3].minHeight, 240);
  assert.equal(picture.element.querySelector('.picture-content').src, images.items[0].image);
  assert.doesNotMatch(manager.calls[3].content.body, /Ajuster à la fenêtre|picture-toolbar/);
  assert.equal(manager.windows.size, 3);
  app.openFile(location, { name: 'readme.bin', text: 'Fichier texte générique' });
  assert.equal(manager.calls[4].resizable, undefined, 'generic files keep their existing behavior');
  assert.equal(manager.calls[4].maximizable, undefined);
  notepad.element.querySelector('.titlebar').children[0].handlers.click();
  assert.equal(notepad.element.hidden, true);
  const previousZ = manager.z;
  notepad.task.handlers.click();
  assert.equal(notepad.element.hidden, false);
  assert.ok(manager.z > previousZ);
  const sameNameElsewhere = app.openFile(explorerLocation('downloads'), txt);
  assert.notEqual(sameNameElsewhere, notepad);
  manager.close(notepad.id);
  assert.equal(notepad.task.isConnected, false);
  assert.equal(explorer.element.isConnected, true);
  assert.equal(picture.element.isConnected, true);
  const unsafe = app.openFile(images, {
    name: 'private.jpg',
    image: 'file:///C:/Users/private.jpg',
  });
  assert.equal(unsafe.element.querySelector('.picture-content').src, undefined);
  assert.equal(unsafe.element.querySelector('.picture-content').hidden, true);
  assert.equal(unsafe.element.querySelector('.picture-error').hidden, false);
  assert.ok(manager.calls.every((call) => call.type === 'desktopapp' && call.preview));
  // Follow the actual explorer double-click path for all existing non-folder files.
  const filesystem = read('../src/config/filesystem.json');
  const before = JSON.stringify(filesystem);
  for (const [id, definition] of Object.entries(filesystem)) {
    const current = { ...definition, id };
    app.render(explorer, current);
    const rows = explorer.element.querySelector('.explorer-items').children;
    const history = [...explorer.history];
    for (const [index, item] of current.items.entries()) {
      if (item.location) continue;
      rows[index].handlers.dblclick();
      assert.equal(explorer.current, current, item.name);
      assert.deepEqual(explorer.history, history, item.name);
      assert.equal(explorer.element.querySelector('.explorer-items').children, rows);
      const file = app.instances.get(`file:${id}/${item.name}`);
      assert.ok(file.element.isConnected, item.name);
      if (fileViewer(item) !== 'generic') continue;
      assert.equal(file.element.querySelector('.window-title > span').textContent, item.name);
      assert.equal(
        file.element.querySelector('.generic-file-content pre').textContent,
        item.text ?? '',
      );
      const z = manager.z;
      assert.equal(app.openFile(current, item), file);
      assert.ok(manager.z > z);
      file.element.querySelector('.titlebar').children[0].handlers.click();
      assert.equal(file.element.hidden, true);
      file.task.handlers.click();
      assert.equal(file.element.hidden, false);
      manager.close(file.id);
      assert.equal(file.task.isConnected, false);
      assert.equal(explorer.element.isConnected, true);
    }
  }
  assert.equal(JSON.stringify(filesystem), before);
  const unknown = { name: 'new-file.unrecognized' };
  const synthetic = { ...location, id: 'test', items: [unknown] };
  app.render(explorer, synthetic);
  explorer.element.querySelector('.explorer-items').children[0].handlers.dblclick();
  const fallback = app.instances.get('file:test/new-file.unrecognized');
  assert.equal(fallback.element.querySelector('.generic-file-content pre').textContent, '');
  assert.equal(fallback.element.querySelector('.generic-file-unavailable').hidden, false);
  assert.equal(explorer.current, synthetic);
  app.openFile(location, { name: 'another.exe', text: 'message conservé' });

  const progression = new Progression(read('../src/config/story.json'));
  const virtualFilesystem = new VirtualFilesystem(progression);
  app.virtualFilesystem = virtualFilesystem;
  const openMessenger = { id: 'messenger-window' };
  const openBrowser = { id: 'browser-window', currentUrl: 'http://local.test/page' };
  const registry = new ExecutableRegistry(virtualFilesystem, {
    messenger: () => openMessenger,
    browser: () => openBrowser,
  });
  app.onLaunchExecutable = (fileId, options) => registry.launch(fileId, options);
  const messengerLocation = virtualFilesystem.getLocation('messenger-files');
  const messengerFile = virtualFilesystem.getFile('messenger-files/love-messenger.exe');
  assert.equal(app.openFile(messengerLocation, messengerFile), openMessenger);
  assert.equal(app.openFile(messengerLocation, messengerFile), openMessenger);
  const browserLocation = virtualFilesystem.getLocation('browser-files');
  const browserFile = virtualFilesystem.getFile('browser-files/adventurer.exe');
  assert.equal(app.openFile(browserLocation, browserFile), openBrowser);
  openBrowser.currentUrl = 'http://local.test/second-page';
  assert.equal(
    app.openFile(browserLocation, browserFile).currentUrl,
    'http://local.test/second-page',
  );

  const unknownExecutable = virtualFilesystem.addFile('downloads', {
    name: 'unknown.exe', detail: 'Programme', icon: 'document', deletable: true,
  });
  const unknownItem = virtualFilesystem.getFile(unknownExecutable.fileId);
  const unknownView = app.openFile(virtualFilesystem.getLocation('downloads'), unknownItem);
  assert.equal(
    unknownView.element.querySelector('.generic-file-content pre').textContent,
    'Impossible d’ouvrir cette application.',
  );
  const unsupportedView = app.openFile(
    virtualFilesystem.getLocation('media-files'),
    virtualFilesystem.getFile('media-files/media-play.exe'),
  );
  assert.equal(
    unsupportedView.element.querySelector('.generic-file-content pre').textContent,
    'Cette application virtuelle n’est pas encore disponible.',
  );
  app.textFiles = new VirtualTextFiles(progression, virtualFilesystem);
  const downloads = virtualFilesystem.getLocation('downloads');
  const deletableText = downloads.items.find((item) => item.name === 'installation_a_lire.txt');
  const openNote = app.openFile(downloads, deletableText);
  const editor = openNote.element.querySelector('.notepad-content');
  editor.value = 'unsaved edit';
  editor.handlers.input();
  assert.equal(virtualFilesystem.deleteFile(deletableText.fileId).ok, true);
  assert.equal(app.openFile(downloads, deletableText), undefined);
  app.closeOpenFile(deletableText.fileId);
  assert.equal(openNote.element.isConnected, false, 'deleting an open note closes it without saving');
  assert.equal(app.textFiles.read(deletableText.fileId, deletableText.text).text, deletableText.text);
});

test('resizable document CSS keeps text scrollable and images naturally sized and contained', () => {
  const css = readFileSync(new URL('../src/styles-story.css', import.meta.url), 'utf8');
  const list = css.match(/\.messenger-contact-list\s*\{([^}]+)\}/)?.[1] ?? '';
  const editor = css.match(/\.notepad-content\s*\{([^}]+)\}/)?.[1] ?? '';
  const image = css.match(/\.picture-content\s*\{([^}]+)\}/)?.[1] ?? '';

  assert.match(list, /flex:\s*1/);
  assert.match(list, /min-height:\s*0/);
  assert.match(list, /overflow:\s*auto/);
  assert.match(editor, /flex:\s*1/);
  assert.match(editor, /overflow:\s*auto/);
  assert.match(editor, /font:\s*13px/);
  assert.match(image, /width:\s*auto/);
  assert.match(image, /height:\s*auto/);
  assert.match(image, /max-width:\s*100%/);
  assert.match(image, /max-height:\s*100%/);
  assert.match(image, /object-fit:\s*contain/);
});

test('every JPG has a bundled illustration and viewers reject host paths and remote images', () => {
  const filesystem = read('../src/config/filesystem.json');
  for (const location of Object.values(filesystem))
    for (const item of location.items) {
      if (!/\.jpg$/i.test(item.name)) continue;
      assert.equal(fileViewer(item), 'image');
      assert.equal(localPicture(item.image), true);
      assert.ok(readFileSync(new URL(`../public/${item.image.slice(2)}`, import.meta.url)).length);
    }
  assert.equal(fileViewer({ name: 'notes.txt' }), 'notepad');
  assert.equal(fileViewer({ name: 'folder.txt', location: 'images' }), null);
  assert.equal(fileViewer({ name: 'toolbar.exe' }), 'generic');
  for (const unsafe of [
    'file:///C:/Users/private.jpg',
    'https://example.com/image.jpg',
    '../secret.svg',
    './covers/../../secret.svg',
  ])
    assert.equal(localPicture(unsafe), false);
});

test('explorer double-click, back, up and home preserve path and content', (t) => {
  const previous = globalThis.document;
  const element = () => ({
    children: [],
    handlers: {},
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren() {
      this.children = [];
    },
    addEventListener(name, callback) {
      this.handlers[name] = callback;
    },
  });
  globalThis.document = { createElement: element };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const fields = new Map();
  const instance = {
    kind: 'computer',
    history: [],
    element: {
      querySelector(selector) {
        if (!fields.has(selector)) fields.set(selector, element());
        return fields.get(selector);
      },
    },
  };
  const app = new DesktopApplications(null, null);
  app.home(instance);
  fields.get('.explorer-items').children[0].handlers.dblclick();
  assert.equal(instance.current.address, 'C:\\');
  assert.equal(fields.get('.explorer-items').children.length, 3);
  fields.get('.explorer-items').children[0].handlers.dblclick();
  assert.equal(instance.current.address, 'C:\\Program Files');
  app.back(instance);
  assert.equal(instance.current.address, 'C:\\');
  app.up(instance);
  assert.equal(instance.current.id, 'computer');
  assert.equal(fields.get('.explorer-up').disabled, true);
  fields.get('.explorer-items').children[2].handlers.dblclick();
  assert.equal(instance.current.address, 'E:\\');
  app.home(instance);
  assert.equal(instance.current.id, 'computer');
  assert.equal(fields.get('.explorer-address strong').textContent, 'Poste de travail');
});

test('disks contain navigable folders, valid parents, safe previews and an empty CD', () => {
  const computer = explorerLocation('computer');
  assert.equal(computer.items.length, 3);
  const disk = explorerItem(computer, computer.items[0]);
  assert.equal(disk.address, 'C:\\');
  assert.deepEqual(
    disk.items.map((item) => item.name),
    ['Program Files', 'WINDOWS', 'Documents and Settings'],
  );
  const seen = new Set();
  function explore(location) {
    if (seen.has(location.id)) return;
    seen.add(location.id);
    if (location.parent) assert.ok(explorerLocation(location.parent));
    for (const item of location.items) {
      const target = explorerItem(location, item);
      if (item.icon === 'folder') assert.ok(item.location);
      if (item.location) explore(target);
      else {
        assert.equal(target.parent, location.id);
        assert.ok(target.text || target.image);
      }
    }
  }
  explore(computer);
  assert.ok(seen.size > 15);
  const cd = explorerItem(computer, computer.items[1]);
  assert.equal(cd.items.length, 0);
  assert.match(cd.emptyText, /Insérez un disque/);
  assert.ok(explorerItem(computer, computer.items[2]).items.length > 0);
  assert.throws(() => explorerLocation('C:\\Users\\real-user'));
  assert.throws(() => explorerLocation('__proto__'));
});

test('the menu CRT is original and distinct from the desktop computer', () => {
  assert.notEqual(icon('menu-computer'), icon('computer'));
  const svg = readFileSync(new URL('../public/icons/menu-computer.svg', import.meta.url), 'utf8');
  assert.match(svg, /crtGradient/);
  assert.doesNotMatch(svg, /<image|<script|href=/);
});

test('main contacts are visible offline initially and become available in place without duplicates', () => {
  const locked = visibleContacts({ [intro.id]: intro }, []);
  assert.equal(locked.length, 9);
  assert.ok(
    locked.every(
      (contact) => !contact.online && contact.status === 'Hors ligne' && !contact.available,
    ),
  );
  for (const contact of locked)
    assert.ok(
      readFileSync(new URL(`../public/${contact.avatar.slice(2)}`, import.meta.url)).length,
    );
  const unlocked = visibleContacts({ [intro.id]: intro }, [intro.id]);
  assert.deepEqual(
    locked
      .filter((contact) =>
        ['pixelgirl', 'turbo', 'luna', 'offline', 'k7', 'm0rbid'].includes(contact.id),
      )
      .map((contact) => contact.nickname),
    ['xX_PixelGirl_Xx', 'Turb0', '°•.LuNa.°•', '0FFLINE', 'K7', 'x_M0RBID_x'],
  );
  assert.equal(unlocked.length, 9);
  const pixel = unlocked.find((contact) => contact.id === 'pixelgirl');
  assert.equal(pixel.nickname, intro.contact.nickname);
  assert.equal(pixel.online, true);
  assert.equal(pixel.available, true);
  const connected = visibleContacts({ [intro.id]: intro }, [intro.id], undefined, {
    turbo: { status: 'online' },
  });
  assert.equal(connected.find((contact) => contact.id === 'turbo').online, true);
  assert.equal(new Set(connected.map((contact) => contact.id)).size, 9);
  for (const [id, nickname, personalMessage] of [
    ['k7', 'K7', '♫ ON AIR !!!'],
    ['m0rbid', 'x_M0RBID_x', ''],
  ]) {
    const contact = locked.find((entry) => entry.id === id);
    assert.equal(contact.kind, 'decorative');
    assert.equal(contact.nickname, nickname);
    assert.equal(contact.personalMessage, personalMessage);
    assert.equal(contact.status, 'Hors ligne');
    assert.equal(contact.online, false);
    assert.equal(contact.available, false);
    assert.equal(contact.dialogue, undefined);
    assert.equal(contact.connection, undefined);
  }
  assert.ok(locked.every((contact) => !['Raph', 'SUPER_BUDDY'].includes(contact.nickname)));
  const future = { ...intro, id: 'future-contact', contact: { ...intro.contact, name: 'Future' } };
  const roster = [{ id: 'future', kind: 'narrative', dialogue: future.id }];
  assert.deepEqual(visibleContacts({ [future.id]: future }, [], roster), []);
  assert.equal(visibleContacts({ [future.id]: future }, [future.id], roster)[0].id, 'future');
});

test('Turb0 keeps the existing connection presence and unlocks the scene conversation from its saved flag', () => {
  const definitions = { [intro.id]: intro, [turboScene.id]: turboScene };
  const connected = visibleContacts(definitions, [], undefined, { turbo: { status: 'online' } });
  const turboOnline = connected.find((contact) => contact.id === 'turbo');
  assert.equal(turboOnline.online, true);
  assert.equal(turboOnline.available, false);
  const restored = visibleContacts(
    definitions,
    [],
    undefined,
    { turbo: { status: 'online' } },
    {},
    { turboSmileyScene3ArrivalTriggered: true },
  );
  const turboUnlocked = restored.find((contact) => contact.id === 'turbo');
  assert.equal(turboUnlocked.nickname, 'Turb0');
  assert.equal(turboUnlocked.online, true);
  assert.equal(turboUnlocked.available, true);
  assert.equal(turboUnlocked.dialogue, turboScene.id);
});

test('locked contacts use read-only windows and resolve current availability after unlocking', () => {
  let unlocked = [];
  const received = [];
  const primary = {
    openOffline(contact) {
      received.push(`offline:${contact.id}`);
    },
    open() {
      received.push('online:pixelgirl');
    },
  };
  const messenger = new Messenger({ primary: () => primary, createConversation: () => primary });
  messenger.contacts = () => visibleContacts({ [intro.id]: intro }, unlocked);
  const locked = messenger.contacts().find((contact) => contact.id === 'pixelgirl');
  messenger.openContact(locked);
  unlocked = [intro.id];
  messenger.openContact(locked);
  assert.deepEqual(received, ['offline:pixelgirl', 'online:pixelgirl']);
});

test('0FFLINE can be narratively available while its visible status remains offline', () => {
  const definition = {
    ...intro,
    id: 'offline-intro',
    contact: { ...intro.contact, nickname: '0FFLINE' },
  };
  const contact = visibleContacts({ [definition.id]: definition }, [definition.id]).find(
    (contact) => contact.id === 'offline',
  );
  assert.equal(contact.available, true);
  assert.equal(contact.online, false);
  assert.equal(contact.status, 'Hors ligne');
});

test('contact presence does not unlock stories or alter saved dialogue data and New Game restores offline status', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const story = read('../src/config/story.json');
  const progression = new Progression(story, storage);
  const before = JSON.stringify(progression.data);
  visibleContacts({ [intro.id]: intro }, progression.data.unlockedConversations);
  assert.equal(JSON.stringify(progression.data), before);
  progression.begin();
  progression.complete('arcade-1');
  const session = new DialogueSession(intro, progression);
  session.deliver();
  progression.data.contactConnections.turbo = { status: 'online' };
  progression.save();
  const restored = new Progression(story, storage);
  const messages = JSON.stringify(restored.data.dialogues);
  const contacts = visibleContacts(
    { [intro.id]: intro },
    restored.data.unlockedConversations,
    undefined,
    restored.data.contactConnections,
  );
  assert.equal(contacts.find((contact) => contact.id === 'pixelgirl').online, true);
  assert.equal(JSON.stringify(restored.data.dialogues), messages);
  restored.newGame();
  const fresh = visibleContacts(
    { [intro.id]: intro },
    restored.data.unlockedConversations,
    undefined,
    restored.data.contactConnections,
  );
  assert.equal(fresh.length, 9);
  assert.ok(fresh.every((contact) => !contact.online && !contact.available));
});

test('Messenger keeps one independent window per contact including future contacts', () => {
  const records = [];
  const view = (id) => ({
    thread: { state: { history: ['old message'] } },
    open() {
      records.push(`open:${id}`);
    },
    openOffline(contact) {
      records.push(`offline:${contact.id}`);
    },
  });
  const primary = view('pixelgirl');
  const roster = [
    { id: 'pixelgirl', kind: 'narrative' },
    { id: 'skater', kind: 'decorative' },
    { id: 'princess', kind: 'decorative' },
    { id: 'future', kind: 'narrative' },
  ];
  const created = [];
  const messenger = new Messenger({
    primary: () => primary,
    createConversation(contact) {
      created.push(contact.id);
      return view(contact.id);
    },
  });
  messenger.contacts = () => roster;
  assert.equal(messenger.openContact(roster[0]), primary);
  const skater = messenger.openContact(roster[1]);
  const princess = messenger.openContact(roster[2]);
  const beforePrepare = records.length;
  const preparedFuture = messenger.prepareContact(roster[3]);
  assert.equal(records.length, beforePrepare, 'preparing an incoming scene does not open a window');
  const future = messenger.openContact(roster[3]);
  assert.notEqual(skater, princess);
  assert.notEqual(future, primary);
  assert.equal(future, preparedFuture, 'the notification reuses the prepared private window');
  assert.equal(messenger.openContact(roster[1]), skater);
  assert.equal(messenger.openContact(roster[3]), future);
  assert.deepEqual(created, ['skater', 'princess', 'future']);
  assert.equal(messenger.openContact({ id: 'locked' }), undefined);
  assert.deepEqual(primary.thread.state.history, ['old message']);
  assert.deepEqual(records, [
    'open:pixelgirl',
    'offline:skater',
    'offline:princess',
    'open:future',
    'offline:skater',
    'open:future',
  ]);
});

test('only the main Messenger contacts panel opts into resize and maximize', () => {
  const calls = [];
  const manager = {
    spawn(type, options) {
      calls.push({ type, options });
      return calls.length;
    },
  };
  const applications = {
    instances: new Map(),
    attachWindow(kind, id) {
      return {
        id,
        kind,
        element: { classList: { add() {} }, dataset: {} },
        task: { remove() {} },
      };
    },
  };
  const messenger = new Messenger({ manager, applications, onWindowState() {} });
  messenger.panel('contacts', 'Windows Love Messenger', '<div></div>');
  messenger.panel('options', 'Options', '<div></div>');

  assert.equal(calls[0].options.resizable, true);
  assert.equal(calls[0].options.maximizable, true);
  assert.equal(calls[0].options.minWidth, 300);
  assert.equal(calls[0].options.minHeight, 320);
  assert.equal(calls[1].options.resizable, undefined);
  assert.equal(calls[1].options.maximizable, undefined);
});

test('incoming conversations reuse one minimized window and respect saved explicit closes', () => {
  const contact = { id: 'future', available: true, dialogue: intro.id };
  const closedContact = { id: 'closed', available: true, dialogue: intro.id };
  const progression = {
    data: {
      conversations: {
        future: { unread: ['incoming-message'], windowClosed: true },
        closed: { unread: ['older-message'], windowClosed: true },
      },
    },
    saves: 0,
    save() {
      this.saves++;
    },
  };
  let opens = 0;
  const view = {
    element: { isConnected: false },
    thread: { state: progression.data.conversations.future },
    openMinimized() {
      opens++;
      this.element.isConnected = true;
    },
  };
  const messenger = new Messenger({
    progression,
    primary: () => null,
    createConversation: () => view,
  });
  messenger.contacts = () => [contact, closedContact];

  messenger.ensureBackground(contact);
  messenger.ensureBackground(contact);
  messenger.restoreUnreadConversations();

  assert.equal(opens, 1, 'the received conversation gets one taskbar window');
  assert.equal(progression.data.conversations.future.windowClosed, false);
  assert.equal(progression.data.conversations.closed.windowClosed, true);
  assert.equal(progression.saves, 1);
});

test('central incoming-message intake creates one background window and forwards the delivered messages', () => {
  const contact = { id: 'future', nickname: 'Future', available: true, dialogue: intro.id };
  const state = { unread: ['message-1'], windowClosed: true };
  let opens = 0;
  let focusChanges = 0;
  let callbackArgs = null;
  const taskClasses = new Set();
  const view = {
    element: { isConnected: false, hidden: true },
    thread: { state },
    messengerInstance: {
      task: {
        title: '',
        classList: {
          toggle(name, enabled) { if (enabled) taskClasses.add(name); else taskClasses.delete(name); },
        },
      },
    },
    openMinimized() {
      opens++;
      this.element.isConnected = true;
    },
    focus() { focusChanges++; },
  };
  const messenger = new Messenger({
    progression: { data: { conversations: { future: state } }, save() {} },
    primary: () => null,
    createConversation: () => view,
    onMessage: (...args) => callbackArgs = args,
  });
  messenger.contacts = () => [contact];
  const events = [{ id: 'event-1' }];
  const messages = [{ key: 'message-1', speaker: 'contact', author: 'future', text: 'bonjour' }];

  const result = messenger.receiveIncoming(contact, events, messages, view);
  assert.equal(result, view);
  assert.equal(opens, 1);
  assert.equal(focusChanges, 0);
  assert.equal(state.windowClosed, false);
  assert.equal(taskClasses.has('messenger-unread'), true);
  assert.deepEqual(callbackArgs, [contact, events, messages, view, { active: false, read: false }]);
  messenger.receiveIncoming(contact, events, messages, view);
  assert.equal(opens, 1, 'one conversation keeps one minimized window');
});

test('central incoming-message intake decides activity from the window manager and marks active delivery read', () => {
  const contact = { id: 'future', nickname: 'Future', available: true, dialogue: intro.id };
  const state = { unread: ['incoming:1'], windowClosed: false };
  const element = { isConnected: true, hidden: false, style: { zIndex: 2 } };
  let callbackState;
  let opened = 0;
  const view = {
    element,
    dialogue: { contact },
    thread: { state, markRead() { state.unread = []; } },
  };
  const manager = { isActive: (candidate) => candidate === element };
  const messenger = new Messenger({
    manager,
    progression: { data: { conversations: { future: state } }, save() {} },
    primary: () => null,
    onMessage: (...args) => callbackState = args[4],
    onContactOpened: () => opened++,
  });
  messenger.contacts = () => [contact];

  messenger.receiveIncoming(contact, [], [{ key: 'incoming:2' }], view);
  assert.deepEqual(callbackState, { active: true, read: true });
  assert.deepEqual(state.unread, []);
  assert.equal(opened, 1);

  manager.isActive = (candidate) => candidate !== element;
  state.unread = ['incoming:3'];
  messenger.receiveIncoming(contact, [], [{ key: 'incoming:4' }], view);
  assert.deepEqual(callbackState, { active: false, read: false });
  assert.deepEqual(state.unread, ['incoming:3']);
});

test('the first message discovers an unopened available contact and creates its background task button immediately', () => {
  const contact = { id: 'future', nickname: 'Future', available: true, kind: 'narrative', dialogue: intro.id };
  const state = { unread: [], windowClosed: false };
  const taskClasses = new Set();
  let delivered = false;
  let incomingCalls = 0;
  let opens = 0;
  const message = { key: 'future:1', speaker: 'contact', author: 'future', text: 'premier message' };
  const view = {
    dialogue: { contact },
    element: { isConnected: false, hidden: false, style: { zIndex: 1 } },
    thread: {
      state,
      receive() {
        if (delivered) return [];
        delivered = true;
        state.unread.push(message.key);
        this.lastIncomingMessages = [message];
        return [{ id: 'future-event' }];
      },
      markRead() { state.unread = []; },
    },
    messengerInstance: {
      task: {
        title: '',
        classList: { toggle(name, enabled) { if (enabled) taskClasses.add(name); else taskClasses.delete(name); } },
      },
    },
    openMinimized() {
      opens++;
      this.element.isConnected = true;
      this.element.hidden = true;
    },
    refresh() {},
  };
  const messenger = new Messenger({
    manager: { windows: new Map() },
    progression: {
      data: { conversations: { future: state }, unlockedConversations: [], contactConnections: {}, contactProfiles: {}, flags: {} },
      save() {},
    },
    primary: () => ({ offlineContact: true, refresh() {} }),
    definitions: () => ({}),
    createConversation: () => view,
    onMessage: (_contact, _events, messages) => {
      assert.deepEqual(messages, [message]);
      incomingCalls++;
    },
  });
  messenger.contacts = () => [contact];

  messenger.update();
  assert.equal(opens, 1);
  assert.equal(incomingCalls, 1);
  assert.equal(view.element.hidden, true);
  assert.equal(taskClasses.has('messenger-unread'), true);
  messenger.update();
  assert.equal(incomingCalls, 1);
});

test('active conversations clear unread state after delivery; background conversations keep their orange task signal', () => {
  const contact = { id: 'future', nickname: 'Future', available: true, dialogue: intro.id };
  const create = (visible) => {
    const state = { unread: [], windowClosed: false };
    const taskClasses = new Set();
    let delivered = false;
    let incomingCalls = 0;
    const event = { id: 'incoming' };
    const message = { key: 'incoming:1', speaker: 'contact', author: 'future', text: 'bonjour' };
    const view = {
      dialogue: { contact },
      thread: {
        state,
        receive() {
          if (delivered) return [];
          delivered = true;
          state.unread.push(message.key);
          this.lastIncomingMessages = [message];
          return [event];
        },
        markRead() { state.unread = []; },
      },
      element: { isConnected: true, hidden: !visible, style: { zIndex: visible ? 10 : 1 } },
      followLatest: false,
      messengerInstance: {
        task: {
          classList: {
            toggle(name, value) { if (value) taskClasses.add(name); else taskClasses.delete(name); },
          },
          title: '',
        },
      },
      refresh() {},
    };
    const progression = {
      data: { conversations: { future: state }, unlockedConversations: [], contactConnections: {}, contactProfiles: {}, flags: {} },
      save() {},
    };
    const primary = { offlineContact: true, refresh() {} };
    const messenger = new Messenger({
      progression,
      manager: { windows: new Map() },
      primary: () => primary,
      definitions: () => ({}),
      onMessage: () => incomingCalls++,
    });
    messenger.contacts = () => [contact];
    messenger.conversations.set(contact.id, view);
    return { messenger, view, state, taskClasses, get incomingCalls() { return incomingCalls; } };
  };

  const active = create(true);
  active.messenger.update();
  assert.equal(active.incomingCalls, 1);
  assert.deepEqual(active.state.unread, []);
  assert.equal(active.taskClasses.has('messenger-unread'), false);

  const background = create(false);
  background.messenger.update();
  assert.equal(background.incomingCalls, 1);
  assert.deepEqual(background.state.unread, ['incoming:1']);
  assert.equal(background.taskClasses.has('messenger-unread'), true);
});

test('queued choices survive a multi-node message sequence and only return after its last message', () => {
  const progression = new Progression(read('../src/config/story.json'));
  progression.begin();
  const first = new DialogueSession(intro, progression);
  while (first.nextMessage()) first.deliver();
  first.offerChoices();
  const before = structuredClone(progression.data.choiceOffers);
  const event = {
    ...intro,
    id: 'test-incoming',
    start: 'first',
    nodes: {
      first: {
        messages: [{ speaker: 'contact', text: 'un message', delayMs: 500, typingMs: 500 }],
        next: 'join',
      },
      join: { messages: [], next: 'last' },
      last: {
        messages: [{ speaker: 'contact', text: 'le dernier', delayMs: 1000, typingMs: 500 }],
        choices: [{ id: 'test-reply', text: 'ok', next: 'end' }],
      },
      end: { messages: [], end: true },
    },
  };
  const second = new DialogueSession(event, progression);
  const thread = new ConversationThread('pixelgirl', progression, () => [intro, event]);
  assert.equal(thread.pendingResponses.length, 1);
  assert.deepEqual(thread.availableResponses, []);
  second.deliver();
  assert.deepEqual(thread.availableResponses, []); // No flicker at an automatic join.
  second.advance();
  second.advance();
  assert.deepEqual(thread.availableResponses, []);
  second.deliver();
  assert.equal(thread.availableResponses.length, 2);
  assert.deepEqual(progression.data.choiceOffers, before);
  assert.equal(first.choices.length, 3);
});

test('desktop applications contain credible data and the trash starts genuinely empty', () => {
  assert.equal(desktopApps.bin.items.length, 0);
  assert.ok(desktopApps.computer.items.some((item) => item.name.includes('(C:)')));
  assert.ok(desktopApps.folder.items.some((item) => item.text));
  for (const kind of ['computer', 'folder', 'bin']) {
    const resource = icon(kind).match(/src="([^"]+)"/)[1];
    const svg = readFileSync(new URL(`../public/${resource.slice(2)}`, import.meta.url), 'utf8');
    assert.doesNotMatch(svg, /<image|<script|href=/);
  }
});

test('response rendering keeps all buttons below the transcript and queues narrative questions', (t) => {
  // Minimal DOM objects exercise the real renderer without launching the game.
  const createElement = (tag) => ({
    tag,
    children: [],
    dataset: {},
    handlers: {},
    disabled: false,
    isConnected: true,
    classList: { add() {}, remove() {} },
    append(...nodes) {
      this.children.push(...nodes);
    },
    replaceChildren(...nodes) {
      this.children.forEach((node) => {
        node.isConnected = false;
      });
      this.children = [];
      this.append(...nodes);
    },
    addEventListener(event, handler) {
      this.handlers[event] = handler;
    },
    querySelectorAll(selector) {
      return this.children.flatMap((node) => [
        ...(node.tag === selector ? [node] : []),
        ...(node.querySelectorAll?.(selector) ?? []),
      ]);
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0];
    },
    focus() {},
  });
  const previous = globalThis.document;
  globalThis.document = { createElement, createTextNode: (text) => ({ textContent: text }) };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const progression = new Progression(read('../src/config/story.json'));
  progression.begin();
  const definition = (id) => ({
    ...intro,
    id,
    start: 'question',
    nodes: {
      question: {
        messages: [{ speaker: 'contact', text: `question ${id}`, delayMs: 0, typingMs: 0 }],
        choices: [{ id: `answer-${id}`, text: `réponse ${id}`, next: 'end' }],
      },
      end: { messages: [], end: true },
    },
  });
  const events = [definition('one'), definition('two')];
  const sessions = new Map(
    events.map((event) => [event.id, new DialogueSession(event, progression)]),
  );
  sessions.get('one').deliver();
  const thread = new ConversationThread('pixelgirl', progression, () => events);
  const view = {
    choices: createElement('div'),
    log: createElement('div'),
    element: createElement('article'),
    thread,
    progression,
    sounds: { play() {} },
    sessionFor: (event) => sessions.get(event.id),
    renderResponses: ConversationWindow.prototype.renderResponses,
    appendHistory() {
      this.log.replaceChildren(
        ...thread
          .sync()
          .map((message) => ({ tag: 'p', textContent: message.text, speaker: message.speaker })),
      );
    },
    pump() {
      this.renderResponses();
    },
  };
  view.appendHistory();
  view.renderResponses();
  assert.equal(view.choices.querySelectorAll('button').length, 0); // Second sequence is still sending.
  sessions.get('two').deliver();
  thread.sync();
  view.appendHistory();
  view.renderResponses();
  assert.equal(thread.availableResponses.length, 2);
  assert.equal(view.choices.querySelectorAll('button').length, 1);
  assert.equal(view.choices.querySelector('button').dataset.choiceId, 'answer-one');
  assert.equal(view.log.querySelectorAll('button').length, 0);
  view.choices.querySelector('button').handlers.click();
  assert.equal(view.log.children.filter((message) => message.speaker === 'player').length, 1);
  assert.ok(view.log.children.some((message) => message.textContent === 'réponse one'));
  assert.equal(view.log.querySelectorAll('button').length, 0);
  assert.equal(view.choices.querySelector('button').dataset.choiceId, 'answer-two');
});

test('offline contacts reuse the conversation window, remain empty and preserve narrative history', (t) => {
  const previous = {
    document: globalThis.document,
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const element = () => ({
    children: [],
    style: {},
    dataset: {},
    handlers: {},
    attrs: {},
    isConnected: true,
    classList: { add() {}, remove() {}, toggle() {} },
    querySelector(selector) {
      this.nodes ??= new Map();
      if (!this.nodes.has(selector)) this.nodes.set(selector, element());
      return this.nodes.get(selector);
    },
    querySelectorAll(selector) {
      return [this.querySelector(selector)];
    },
    append(...items) {
      this.children.push(...items);
    },
    insertBefore() {},
    addEventListener(type, handler) {
      this.handlers[type] = handler;
    },
    setAttribute(key, value) {
      this.attrs[key] = value;
    },
    replaceChildren() {
      this.children = [];
    },
    focus() {},
    remove() {
      this.isConnected = false;
    },
  });
  Object.assign(globalThis, {
    document: {
      baseURI: 'http://game.local/',
      createElement: element,
      addEventListener() {},
      removeEventListener() {},
    },
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
  });
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  });
  const progression = new Progression(read('../src/config/story.json'));
  let completions = 0,
    spawns = 0;
  const manager = {
    windows: new Map(),
    z: 10,
    spawn(type, options) {
      const node = element();
      assert.doesNotMatch(
        options.content.body,
        /data-msn-action="emoticons"|read-latest|conversation-reader|Dernier(?:s)? message|Choisis une réponse ci-dessous/,
      );
      assert.match(options.content.body, /data-msn-action="wizz"/);
      node.dataset.windowId = ++spawns;
      this.windows.set(spawns, { element: node, options });
      return spawns;
    },
    close(id) {
      const entry = this.windows.get(id);
      entry.element.remove();
      this.windows.delete(id);
      entry.options.onDismiss({ reason: 'close' });
    },
  };
  const view = new ConversationWindow(
    manager,
    intro,
    progression,
    { unlock() {} },
    () => completions++,
    undefined,
    undefined,
    { isUnlocked: () => false },
  );
  const original = JSON.stringify(progression.data);
  const contact = read('../src/config/contacts.json')[0];
  view.openOffline(contact);
  const conversationOptions = manager.windows.get(Number(view.element.dataset.windowId)).options;
  assert.equal(conversationOptions.resizable, true);
  assert.equal(conversationOptions.maximizable, true);
  assert.equal(conversationOptions.minWidth, 480);
  assert.equal(conversationOptions.minHeight, 400);
  assert.equal(view.element.querySelector('.contact-name').textContent, contact.nickname);
  assert.ok(view.element.querySelector('.contact-status').textContent.startsWith('Hors ligne'));
  assert.equal(view.log.children.length, 0);
  assert.equal(view.choices.children.length, 0);
  assert.equal(view.session, null);
  assert.match(view.typing.textContent, /indisponible/);
  view.openOffline(contact);
  assert.equal(manager.windows.size, 1);
  assert.equal(spawns, 1);
  view.element.hidden = true;
  view.restore();
  assert.equal(view.element.hidden, false);
  view.refresh();
  view.pump();
  assert.equal(JSON.stringify(progression.data), original);
  manager.close(Number(view.element.dataset.windowId));
  assert.equal(completions, 0);
  assert.equal(manager.windows.size, 0);
  assert.equal(JSON.stringify(progression.data), original);
});
