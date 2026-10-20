import test from 'node:test';
import assert from 'node:assert/strict';
import { Progression } from '../src/story/progression.js';
import { DialogueSession } from '../src/story/dialogue.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { ConversationWindow } from '../src/ui/conversation.js';

const story = {
  version: 1,
  start: 'chat',
  sequences: [{ id: 'chat', type: 'conversation', dialogue: 'intro', next: null }],
};
const definition = {
  id: 'intro',
  deliveryPolicy: 'progressive',
  version: 1,
  contact: { name: 'Friend', nickname: 'xX_Friend_Xx', status: 'En ligne' },
  player: { nickname: 'Me' },
  start: 'hello',
  nodes: {
    hello: {
      messages: [
        { speaker: 'contact', text: 'hello', delayMs: 800, typingMs: 0 },
        { speaker: 'contact', text: 'another message', delayMs: 1200, typingMs: 200 },
      ],
      choices: [{ id: 'yes', text: 'OK', next: 'end' }],
    },
    end: { messages: [{ speaker: 'contact', text: 'bye', delayMs: 500, typingMs: 0 }], end: true },
  },
};
function setup() {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.begin();
  const thread = new ConversationThread('friend', progression, () => [definition]);
  thread.schedule(definition, 1000);
  return { progression, thread, storage };
}

test('typing uses existing waits, disappears between messages and exposes choices only after the last delivery', () => {
  const { progression, thread } = setup();
  assert.equal(thread.typingContact(1619), null);
  assert.equal(thread.typingContact(1620).nickname, 'xX_Friend_Xx');
  assert.equal(thread.receive(1799).length, 0);
  assert.equal(thread.availableResponses.length, 0);
  thread.receive(1800);
  assert.equal(progression.data.dialogues.intro.transcript.length, 1);
  assert.equal(thread.typingContact(1800), null);
  assert.equal(thread.typingContact(2999), null);
  assert.equal(thread.typingContact(3000).nickname, 'xX_Friend_Xx');
  thread.receive(3200);
  assert.equal(thread.typingContact(3200), null);
  assert.equal(thread.availableResponses[0].choices[0].id, 'yes');
  assert.equal(progression.data.choices.length, 0);
  assert.equal(progression.data.dialogues.intro.transcript.length, 2);
  const session = new DialogueSession(definition, progression);
  session.offerChoices();
  session.choose('yes');
  thread.schedule(definition, 4000);
  thread.receive(4500);
  assert.equal(progression.data.dialogues.intro.finished, true);
  assert.equal(thread.typingContact(5000), null);
});

test('incoming message batches contain only newly delivered history rows, including after reload', () => {
  const { thread, progression, storage } = setup();
  assert.deepEqual(thread.receive(1800), [definition]);
  assert.deepEqual(thread.lastIncomingMessages.map((message) => message.text), ['hello']);
  assert.deepEqual(thread.receive(3200), [definition]);
  assert.deepEqual(thread.lastIncomingMessages.map((message) => message.text), ['another message']);
  assert.deepEqual(thread.receive(3200), []);
  assert.deepEqual(thread.lastIncomingMessages, []);

  const restored = new ConversationThread('friend', new Progression(story, storage), () => [definition]);
  assert.deepEqual(restored.receive(3200), []);
  assert.deepEqual(restored.lastIncomingMessages, []);
  assert.equal(restored.state.history.length, 2);
  assert.equal(progression.data.conversations.friend.history.length, 2);
});

test('scheduled messages and typing deadlines survive closed/reduced windows and restart without an indicator in history', () => {
  const { progression, thread, storage } = setup();
  assert.equal(thread.typingContact(1700).nickname, 'xX_Friend_Xx');
  const loaded = new Progression(story, storage);
  const reopened = new ConversationThread('friend', loaded, () => [definition]);
  assert.equal(reopened.typingContact(1700).nickname, 'xX_Friend_Xx');
  reopened.receive(3200); // No window is needed for receiving; overdue messages do not flush together.
  assert.equal(reopened.typingContact(3200), null);
  assert.equal(reopened.state.history.length, 1);
  assert.equal(loaded.data.dialogues.intro.receiveDueAt, 4600,
    'the next message is scheduled from the actual receipt time after reload');
  reopened.receive(4600);
  assert.equal(reopened.state.history.length, 2);
  assert.equal(loaded.data.choices.length, 0);
  assert.deepEqual(
    reopened.state.history.map((message) => message.text),
    ['hello', 'another message'],
  );
  assert.equal(loaded.data.dialogues.intro.receiveDueAt, undefined);
  const view = {
    thread: reopened,
    typingIndicator: { textContent: 'stale', classList: { toggle() {} }, remove() {} },
    scrollLatest() {},
  };
  ConversationWindow.prototype.renderTyping.call(view, 3200);
  assert.equal(view.typingIndicator.textContent, '');
  view.typingIndicator = null;
  assert.doesNotThrow(() => ConversationWindow.prototype.renderTyping.call(view, 3200));
});

test('the view uses the real nickname, does not announce unchanged text repeatedly, and ignores offline contacts', () => {
  const { thread } = setup();
  let text = '',
    writes = 0,
    active = false;
  const indicator = {
    remove() {
      this.parentNode = null;
    },
    get textContent() {
      return text;
    },
    set textContent(value) {
      text = value;
      writes++;
    },
    classList: {
      toggle(name, value) {
        active = value;
      },
    },
  };
  const view = {
    thread,
    typingIndicator: indicator,
    log: {
      append(node) {
        node.parentNode = this;
      },
    },
    scrollLatest() {},
  };
  ConversationWindow.prototype.renderTyping.call(view, 1700);
  assert.equal(text, "xX_Friend_Xx est en train d'\u00e9crire...");
  assert.equal(active, true);
  ConversationWindow.prototype.renderTyping.call(view, 1701);
  assert.equal(writes, 1);
  const offline = structuredClone(definition);
  offline.contact.status = 'Hors ligne';
  const hidden = new ConversationThread('friend', thread.progression, () => [offline]);
  assert.equal(hidden.typingContact(1700), null);
  thread.receive(1800);
  ConversationWindow.prototype.renderTyping.call(view, 1800);
  assert.equal(text, '');
  assert.equal(active, false);
});

test('group typing lists only currently active authors, concurrently and in presentation order', () => {
  const authors = [
    ['xX_PixelGirl_Xx', 'PixelGirl'],
    ['Turb0', 'Turb0'],
    ['°•.LuNa.°•', 'Luna'],
  ];
  const make = (selected) => {
    const entries = new Map();
    const storage = { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
    const progression = new Progression(story, storage);
    progression.begin();
    const events = selected.map(([author], index) => ({
      id: `group-${index}`,
      version: 1,
      contact: { id: 'plumber-group', name: 'Groupe', nickname: 'PixelGirl, Turb0 et Luna', status: 'En ligne' },
      player: { nickname: 'Me' },
      start: 'typing',
      nodes: { typing: { messages: [{ speaker: 'contact', author, text: 'message', delayMs: 1000, typingMs: 500 }], end: true } },
    }));
    const thread = new ConversationThread('plumber-group', progression, () => events);
    for (const event of events) {
      progression.data.dialogues[event.id] = {
        node: 'typing', cursor: 0, transcript: [], finished: false, revision: 1, receiveDueAt: 1500,
      };
    }
    return { thread, events, progression };
  };
  const cases = [
    [[authors[0]], "PixelGirl est en train d'écrire..."],
    [[authors[1]], "Turb0 est en train d'écrire..."],
    [[authors[2]], "Luna est en train d'écrire..."],
    [[authors[0], authors[1]], "PixelGirl et Turb0 sont en train d'écrire..."],
    [[authors[1], authors[2]], "Turb0 et Luna sont en train d'écrire..."],
    [[authors[0], authors[2]], "PixelGirl et Luna sont en train d'écrire..."],
    [authors, "PixelGirl, Turb0 et Luna sont en train d'écrire..."],
  ];
  for (const [selected, expected] of cases) {
    const { thread } = make(selected);
    const names = thread.typingContacts(1200).map((contact) => contact.nickname);
    assert.deepEqual(names, selected.map(([, name]) => name));
    let text = '';
    const view = {
      thread,
      typingIndicator: { textContent: '', classList: { toggle() {} } },
      scrollLatest() {},
    };
    Object.defineProperty(view.typingIndicator, 'textContent', {
      get: () => text,
      set: (value) => { text = value; },
    });
    ConversationWindow.prototype.renderTyping.call(view, 1200);
    assert.equal(text, expected);
  }

  const { thread, events, progression } = make(authors);
  thread.receive(1500);
  assert.deepEqual(thread.typingContacts(1500), []);
  assert.equal(events.every((event) => !Number.isFinite(progression.data.dialogues[event.id].receiveDueAt)), true);

  const partial = make([authors[0], authors[1]]);
  partial.progression.data.dialogues[partial.events[0].id].receiveDueAt = 1500;
  partial.progression.data.dialogues[partial.events[1].id].receiveDueAt = 1700;
  assert.deepEqual(partial.thread.typingContacts(1300).map(({ nickname }) => nickname), ['PixelGirl', 'Turb0']);
  partial.thread.receive(1500);
  assert.deepEqual(partial.thread.typingContacts(1600).map(({ nickname }) => nickname), ['Turb0']);
});

test('typing stays outside the scrolling messages through messages, Wizz spam, hiding and transcript rebuilds', (t) => {
  const previous = globalThis.document;
  const node = () => ({
    children: [],
    dataset: {},
    textContent: '',
    isConnected: true,
    classList: { toggle() {} },
    setAttribute() {},
    append(...items) {
      for (const item of items) {
        item.remove();
        this.children.push(item);
        item.parentNode = this;
      }
    },
    remove() {
      if (this.parentNode)
        this.parentNode.children = this.parentNode.children.filter((item) => item !== this);
      this.parentNode = null;
    },
  });
  globalThis.document = {
    createElement: node,
    createTextNode(text) {
      const item = node();
      item.textContent = text;
      return item;
    },
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const log = node();
  log.scrollHeight = 500;
  log.scrollTop = 0;
  const indicator = node();
  const history = node();
  history.append(log, indicator);
  const view = {
    log,
    history,
    typingIndicator: indicator,
    dialogue: definition,
    followLatest: true,
    thread: { typingContact: () => definition.contact },
    scrollLatest: ConversationWindow.prototype.scrollLatest,
  };
  const first = ConversationWindow.prototype.appendMessage.call(view, {
    speaker: 'contact',
    text: 'hello',
  });
  ConversationWindow.prototype.renderTyping.call(view, 0);
  assert.deepEqual(log.children, [first]);
  assert.deepEqual(history.children, [log, indicator]);
  assert.equal(indicator.hidden, false);
  assert.equal(log.scrollTop, 500);
  view.followLatest = false;
  log.scrollTop = 80;
  const next = ConversationWindow.prototype.appendMessage.call(view, {
    speaker: 'player',
    text: 'another message',
  });
  assert.equal(next.children[0].textContent, 'JustMe dit :');
  assert.deepEqual(log.children, [first, next]);
  ConversationWindow.prototype.renderTyping.call(view, 1);
  assert.deepEqual(log.children, [first, next]);
  assert.deepEqual(history.children, [log, indicator]);
  assert.equal(log.scrollTop, 80);
  for (let i = 0; i < 10; i++)
    ConversationWindow.prototype.appendMessage.call(view, {
      key: `wizz:${i}`,
      type: 'wizz',
      speaker: 'player',
      text: 'JustMe vous a envoyé un wizz !',
    });
  assert.equal(log.children.length, 12);
  assert.deepEqual(history.children, [log, indicator]);
  assert.equal(indicator.hidden, false);
  assert.equal(log.scrollTop, 80);
  view.thread.typingContact = () => null;
  ConversationWindow.prototype.renderTyping.call(view, 2);
  assert.equal(log.children.length, 12);
  assert.deepEqual(history.children, [log, indicator]);
  assert.equal(indicator.hidden, true);
  assert.equal(log.scrollTop, 80);
  log.replaceChildren = () => {
    log.children = [];
  };
  view.appendHistory = () => {};
  ConversationWindow.prototype.renderTranscript.call(view);
  assert.deepEqual(log.children, []);
  assert.deepEqual(history.children, [log, indicator]);
});
