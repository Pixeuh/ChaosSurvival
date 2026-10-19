import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { DialogueSession } from '../src/story/dialogue.js';
import { Progression } from '../src/story/progression.js';
import { DialogueEvents } from '../src/story/dialogue-events.js';
import { ConnectionMessages } from '../src/story/connection-messages.js';
import { ConversationWindow } from '../src/ui/conversation.js';
import {
  installDevelopmentConversationShortcut,
  prepareBombArenaForDevelopment,
} from '../src/dev/finish-shortcut.js';
import { VirtualFilesystem, virtualFileId } from '../src/story/virtual-filesystem.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const story = read('../src/config/story.json');
const turbo = read('../src/dialogues/turbo-smiley-catcher.json');
const pixelgirlIntro = read('../src/dialogues/pixelgirl-intro.json');
const pixelgirlAfterSmiley = read('../src/dialogues/pixelgirl-smiley-victory.json');
const plumberGroup = read('../src/dialogues/pixelgirl-super-plombier-group.json');
const connectionConfig = read('../src/config/connection-messages.json');

function createView(dialogue = turbo, events = [dialogue]) {
  const values = new Map();
  const progression = new Progression(story, {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  progression.begin();
  const thread = new ConversationThread(dialogue.contact.id ?? 'turbo', progression, () => events);
  const view = Object.assign(Object.create(ConversationWindow.prototype), {
    dialogue,
    progression,
    thread,
    sessions: new Map(),
    session: new DialogueSession(dialogue, progression),
    element: {
      isConnected: true,
      classList: { toggle() {}, remove() {} },
    },
    typing: { textContent: '' },
    typingIndicator: { textContent: '', hidden: false, classList: { remove() {} } },
    onChoiceValidated() {},
    onCheckpoint: () => {},
    onFilesChanged() {},
    appendHistory() {},
    renderResponses() {},
    scrollLatest() {},
  });
  return view;
}

function pressFinishShortcut(view) {
  let listener;
  const remove = installDevelopmentConversationShortcut(
    { addEventListener: (_type, callback) => (listener = callback), removeEventListener() {} },
    () => view,
  );
  listener({
    key: 'F', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false,
    repeat: false, target: { closest: () => null }, preventDefault() {},
  });
  remove();
}

test('development conversation shortcut runs one random branch through the saved dialogue engine', () => {
  const view = createView();
  const logs = [];
  assert.equal(
    view.finishImmediately(
      () => 0.5,
      (line) => logs.push(line),
    ),
    true,
  );
  const saved = view.progression.data.dialogues[turbo.id];
  assert.deepEqual(
    saved.transcript.map((message) => message.text).slice(0, 4),
    [
      'mdrrrr noob',
      turbo.nodes.opening.choices[1].text,
      'bah ouais je voyais ton jeu mdr',
      'pourquoi tu demandes ça ???',
    ],
  );
  assert.equal(saved.finished, true);
  assert.equal(saved.transcript.at(-1).text, 'jvais chercher un truc');
  assert.equal(saved.transcript.filter((message) => message.speaker === 'player').length, 4);
  assert.equal(view.progression.data.choices[0].choice, 'screen');
  assert.equal(view.progression.data.choices.at(-1).choice, 'video-funny');
  assert.equal(view.thread.state.history.length, saved.transcript.length);
  assert.equal(logs.filter((line) => line.startsWith('[DEV] Choix')).length, 4);
  assert.equal(logs.at(-1), '[DEV] Conversation terminée');

  assert.equal(
    view.finishImmediately(
      () => 0,
      (line) => logs.push(line),
    ),
    false,
  );
  assert.equal(saved.transcript.length, 24);
});

test('development fast-forward cannot bypass a pending connection first-message deadline', () => {
  const view = createView(turbo);
  view.progression.data.flags.turboSmileyScene3ArrivalTriggered = true;
  view.progression.data.contactConnections.turbo = { status: 'pending', dueAt: 12_000 };
  const scheduler = new ConnectionMessages(
    view.progression,
    { [turbo.id]: turbo },
    connectionConfig,
    (id) => id === 'turbo' ? view.thread : null,
  );
  view.pump = () => {};

  const originalNow = Date.now;
  try {
    Date.now = () => 11_999;
    assert.equal(view.finishImmediately(() => 0.5, () => {}), false);
    assert.equal(view.progression.data.dialogues[turbo.id].transcript.length, 0);
    assert.equal(view.progression.data.pendingConnectionMessages['turbo-first-connection'], undefined);

    view.progression.data.contactConnections.turbo = { status: 'online', connectedAt: 12_000 };
    scheduler.connect('turbo', 12_000);
    Date.now = () => 14_999;
    assert.equal(view.finishImmediately(() => 0.5, () => {}), false);
    assert.equal(view.progression.data.dialogues[turbo.id].transcript.length, 0);
    assert.equal(view.progression.data.pendingConnectionMessages['turbo-first-connection'].dueAt, 15_000);

    Date.now = () => 15_000;
    assert.equal(view.finishImmediately(() => 0.5, () => {}), true);
    assert.equal(view.progression.data.dialogues[turbo.id].transcript[0].text, 'mdrrrr noob');
    assert.equal(view.progression.data.pendingConnectionMessages['turbo-first-connection'], undefined);
  } finally {
    Date.now = originalNow;
  }
});

test('partially received messages are preserved and Ctrl+Shift+F ignores text fields', () => {
  const view = createView();
  view.session.deliver();
  view.thread.sync();
  const calls = [];
  let listener;
  const target = {
    addEventListener(type, handler) {
      listener = handler;
    },
    removeEventListener() {},
  };
  const remove = installDevelopmentConversationShortcut(target, () => ({
    finishImmediately: () => calls.push('finish'),
  }));
  const base = {
    ctrlKey: true,
    shiftKey: true,
    altKey: false,
    metaKey: false,
    repeat: false,
    key: 'f',
    preventDefault() {},
  };
  listener({ ...base, target: { closest: () => 'input' } });
  assert.deepEqual(calls, []);
  listener({ ...base, target: { closest: () => null } });
  assert.deepEqual(calls, ['finish']);
  remove();

  assert.equal(
    view.finishImmediately(
      () => 0,
      () => {},
    ),
    true,
  );
  assert.equal(view.progression.data.dialogues[turbo.id].transcript[0].text, 'mdrrrr noob');
  assert.equal(view.progression.data.dialogues[turbo.id].transcript.length, 22);
});

test('development conversation shortcut resolves successive choices and transfer steps without delays', () => {
  const view = createView(pixelgirlIntro);
  const checkpoints = [];
  view.onCheckpoint = (id) => checkpoints.push(id);
  const logs = [];
  assert.equal(
    view.finishImmediately(
      () => 0.99,
      (line) => logs.push(line),
    ),
    true,
  );
  assert.equal(view.progression.data.dialogues[pixelgirlIntro.id].finished, true);
  assert.ok(view.progression.data.choices.length > 1);
  assert.ok(Object.values(view.progression.data.files).some((file) => file.status === 'complete'));
  assert.deepEqual(checkpoints, [pixelgirlIntro.id]);
  assert.equal(logs.at(-1), '[DEV] Conversation terminée');
});

test('development fast-forward triggers Turb0 arrival when it validates PixelGirl first reply', () => {
  const view = createView(pixelgirlAfterSmiley);
  const arrivals = [];
  const effects = new DialogueEvents(
    view.progression,
    { [pixelgirlAfterSmiley.id]: pixelgirlAfterSmiley },
    (contactId) => arrivals.push(contactId),
    { deferredConnectionDialogues: [pixelgirlAfterSmiley.id] },
  );
  view.onChoiceValidated = (definition, { nodeId }) => {
    if (definition.id === pixelgirlAfterSmiley.id && nodeId === definition.start)
      effects.triggerConnection('turbo');
  };

  assert.equal(
    view.finishImmediately(
      () => 0.5,
      () => {},
    ),
    true,
  );
  assert.deepEqual(arrivals, []);
  assert.equal(view.progression.data.contactConnections.turbo.status, 'pending');
  const dueAt = view.progression.data.contactConnections.turbo.dueAt;
  effects.update(dueAt - 1);
  assert.deepEqual(arrivals, []);
  effects.update(dueAt);
  assert.deepEqual(arrivals, ['turbo']);
  assert.equal(view.progression.data.contactConnections.turbo.status, 'online');
  assert.equal(
    view.progression.data.choices.filter((entry) => entry.dialogue === pixelgirlAfterSmiley.id)
      .length,
    10,
  );
});

test('development fast-forward finishes Turb0 scene and queues Luna connection once', () => {
  const view = createView(turbo);
  const connected = [];
  const events = new DialogueEvents(view.progression, { [turbo.id]: turbo }, (id) =>
    connected.push(id),
  );
  assert.equal(view.finishImmediately(() => 0.5, () => {}), true);
  assert.equal(view.progression.data.dialogues[turbo.id].finished, true);

  const finishedAt = 20_000;
  events.update(finishedAt);
  assert.deepEqual(view.progression.data.contactConnections.luna, {
    status: 'pending',
    dueAt: finishedAt + 3000,
  });
  events.update(finishedAt + 2999);
  assert.deepEqual(connected, []);
  events.update(finishedAt + 3000);
  events.update(finishedAt + 9000);
  assert.deepEqual(connected, ['luna']);
});

test('Ctrl+Shift+F finishes only the open PixelGirl conversation and leaves BombArena unavailable', () => {
  const view = createView(pixelgirlIntro, [pixelgirlIntro, plumberGroup]);
  const filesystem = new VirtualFilesystem(view.progression);

  pressFinishShortcut(view);

  assert.equal(view.progression.data.dialogues[pixelgirlIntro.id].finished, true);
  assert.equal(view.progression.data.dialogues[plumberGroup.id]?.transcript?.length ?? 0, 0);
  assert.equal(filesystem.exists(virtualFileId('downloads', 'BombArena.zip')), false);
  assert.equal(filesystem.exists(virtualFileId('downloads', 'BombArena')), false);
  assert.equal(filesystem.exists(virtualFileId('bomb-arena-folder', 'BombArena.exe')), false);
});

test('Ctrl+Shift+F completes the current group BombArena transfer without extracting it', () => {
  const view = createView(plumberGroup);
  const filesystem = new VirtualFilesystem(view.progression);
  let desktopRefreshes = 0;
  view.onFilesChanged = () => {
    desktopRefreshes++;
    assert.equal(filesystem.exists(virtualFileId('downloads', 'BombArena.zip')), true);
  };

  pressFinishShortcut(view);

  const archiveId = virtualFileId('downloads', 'BombArena.zip');
  assert.equal(view.progression.data.dialogues[plumberGroup.id].finished, true);
  assert.equal(filesystem.getFile(archiveId)?.status, 'complete');
  assert.equal(desktopRefreshes, 1, 'the normal desktop-file refresh runs on transfer completion');
  assert.equal(filesystem.exists(virtualFileId('downloads', 'BombArena')), false);
  assert.equal(filesystem.exists(virtualFileId('bomb-arena-folder', 'BombArena.exe')), false);
  assert.equal(
    Object.values(view.progression.data.files).filter((file) => file.extractable === 'bomb-arena').length,
    1,
    'the scripted transfer creates one archive record',
  );
});

test('Ctrl+Shift+D prepares one usable BombArena install after the group dialogue finishes', () => {
  const values = new Map();
  const progression = new Progression(story, {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  const filesystem = new VirtualFilesystem(progression);
  let listener;
  let finished = false;
  const conversation = {
    finishImmediately() {
      finished = true;
      progression.data.dialogues[plumberGroup.id] = {
        node: 'bomb-arena-after-transfer', cursor: 0, finished: true, transcript: [],
      };
    },
  };
  const remove = installDevelopmentConversationShortcut(
    { addEventListener: (_type, callback) => (listener = callback), removeEventListener() {} },
    () => conversation,
    () => prepareBombArenaForDevelopment(progression, filesystem, plumberGroup),
    'd',
  );
  const event = {
    key: 'D', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, repeat: false,
    preventDefault() {},
  };
  listener(event);
  assert.equal(finished, true);
  const archiveId = virtualFileId('downloads', 'BombArena.zip');
  const executableId = virtualFileId('bomb-arena-folder', 'BombArena.exe');
  assert.equal(filesystem.getFile(archiveId)?.status, 'complete');
  assert.equal(filesystem.getFile(virtualFileId('downloads', 'BombArena'))?.directory, true);
  assert.equal(filesystem.getFile(executableId)?.virtualApp, 'bomb-arena');
  listener(event);
  assert.equal(Object.values(progression.data.files).filter((file) => file.extractable === 'bomb-arena').length, 1);
  assert.equal(Object.keys(filesystem.state.added).filter((id) => id === executableId).length, 1);

  progression.newGame();
  const resetFilesystem = new VirtualFilesystem(progression);
  assert.equal(resetFilesystem.exists(archiveId), false);
  assert.equal(resetFilesystem.exists('downloads/bombarena'), false);
  assert.equal(resetFilesystem.exists(executableId), false);

  remove();
});
