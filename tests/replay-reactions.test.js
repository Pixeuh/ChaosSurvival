import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ReplayReactions } from '../src/story/replays.js';
import { Progression } from '../src/story/progression.js';
import { DialogueSession } from '../src/story/dialogue.js';
import { ConnectionMessages } from '../src/story/connection-messages.js';
const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const story = read('../src/config/story.json');
const config = read('../src/config/replay-reactions.json');
const connectionConfig = read('../src/config/connection-messages.json');
const definitions = Object.fromEntries(
  readdirSync(new URL('../src/dialogues/', import.meta.url))
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const d = read(`../src/dialogues/${file}`);
      return [d.id, d];
    }),
);
function setup() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.data.playerIdentity = {
    nickname: 'JustMe', identityGender: 'boy', grammaticalGender: 'male', completed: true,
  };
  progression.begin();
  return { storage, progression, reactions: new ReplayReactions(progression, definitions, config) };
}
function meet(progression, complete = true) {
  progression.complete('arcade-1');
  const session = new DialogueSession(definitions['pixelgirl-intro'], progression);
  session.deliver();
  if (complete) finish(session, progression);
  return session;
}
function finish(session, progression) {
  for (let step = 0; step < 150 && !session.state.finished; step++) {
    if (session.nextMessage()) {
      session.deliver();
      continue;
    }
    if (session.advance()) continue;
    if (session.choices.length) {
      session.choose(session.choices[0].id);
      continue;
    }
    if (session.activeTransfer?.status === 'pending')
      progression.finishTransfer(session.activeTransfer.key);
  }
  assert.ok(session.state.finished);
}
function finishScheduledEvent(thread, progression, definition, now) {
  for (let update = 0; update < 100 && !progression.data.dialogues[definition.id]?.finished; update++) {
    const dueAt = progression.data.dialogues[definition.id]?.receiveDueAt;
    now = Math.max(now, Number.isFinite(dueAt) ? dueAt : now);
    thread.receive(now);
    now++;
  }
  assert.equal(progression.data.dialogues[definition.id]?.finished, true, `${definition.id} finishes through scheduled reception`);
  return now;
}
test('attempts are counted immediately, including abandonments, without reactions before the first meeting', () => {
  const { progression, reactions } = setup();
  reactions.launch(0);
  reactions.launch(1000);
  assert.equal(progression.data.level1Launches, 2);
  assert.deepEqual(reactions.flush(10000), []);
  meet(progression);
  reactions.launch(11000);
  assert.equal(config.delayMs, 2000);
  assert.deepEqual(reactions.flush(12999), []);
  const incoming = reactions.flush(13000);
  assert.equal(incoming.length, 1);
  assert.equal(progression.data.replayReactions[0].template, config.first);
  assert.equal(progression.data.dialogues[incoming[0].id].transcript.length, 1);
  assert.equal(reactions.thread.availableResponses.length, 0);
  assert.deepEqual(reactions.flush(13749), []);
  assert.equal(reactions.flush(13750).length, 1);
  assert.equal(progression.data.dialogues[incoming[0].id].transcript.length, 2);
  assert.equal(reactions.thread.availableResponses.length, 0);
  assert.equal(reactions.flush(14500).length, 1);
  assert.deepEqual(reactions.flush(99999), []);
  const saved = progression.data.dialogues[incoming[0].id];
  assert.equal(saved.transcript.length, 3);
  assert.equal(saved.transcript[0].text, 'et bah !!!');
  assert.equal(progression.data.choiceOffers[`${incoming[0].id}:hello`], undefined);
  assert.equal(saved.finished, true);
  assert.equal(reactions.thread.availableResponses.length, 0);
  assert.equal(progression.current.id, 'pixelgirl-hello');
});

test('PixelGirl first message uses the shared three-second desktop connection deadline and resumes once', () => {
  const { storage, progression, reactions } = setup();
  assert.deepEqual(reactions.flush(1000), []);
  assert.equal(progression.data.dialogues['pixelgirl-intro'], undefined);

  progression.complete('arcade-1', { score: 100, closed: 4 }, 5000);
  assert.ok(progression.data.unlockedConversations.includes('pixelgirl-intro'));
  assert.deepEqual(reactions.flush(5000, { canReceive: false }), []);
  assert.equal(progression.data.dialogues['pixelgirl-intro'], undefined);
  const connectionMessages = new ConnectionMessages(
    progression,
    definitions,
    connectionConfig,
    (id) => id === 'pixelgirl' ? reactions.thread : null,
  );
  assert.equal(connectionMessages.connect('pixelgirl', 5000), true);
  assert.equal(progression.data.dialogues['pixelgirl-intro'].receiveDueAt, 8000);
  assert.equal(connectionMessages.connect('pixelgirl', 6000), true);
  assert.equal(progression.data.dialogues['pixelgirl-intro'].receiveDueAt, 8000);

  assert.deepEqual(reactions.flush(7999), []);
  const [intro] = reactions.flush(8000);
  assert.equal(intro.id, 'pixelgirl-intro');
  assert.equal(progression.data.dialogues[intro.id].transcript[0].text, 'heyyyy :DDD');
  assert.equal(progression.data.dialogues[intro.id].receiveDueAt, 8800);
  assert.deepEqual(reactions.flush(8000), []);
  assert.equal(progression.data.dialogues[intro.id].transcript.length, 1);

  const restored = new ReplayReactions(new Progression(story, storage), definitions, config);
  const restoredScheduler = new ConnectionMessages(
    restored.progression,
    definitions,
    connectionConfig,
    (id) => id === 'pixelgirl' ? restored.thread : null,
  );
  restoredScheduler.restorePending();
  assert.equal(restored.progression.data.dialogues[intro.id].receiveDueAt, 8800);
  assert.deepEqual(restored.flush(8799), []);
  assert.equal(restored.flush(8800).length, 1);
  assert.equal(restored.progression.data.dialogues[intro.id].transcript.length, 2);
});

test('closed Messenger and relaunch preserve message-only replays and narrative choices', () => {
  const { storage, progression, reactions } = setup();
  reactions.launch(0);
  meet(progression);
  reactions.launch(1000);
  const choices = structuredClone(progression.data.choices);
  const reopened = new Progression(story, storage);
  const restored = new ReplayReactions(reopened, definitions, config);
  const [incoming] = restored.flush(7000);
  finishScheduledEvent(restored.thread, reopened, incoming, 7000);
  const session = new DialogueSession(incoming, reopened);
  assert.equal(session.state.finished, true);
  assert.deepEqual(session.choices, []);
  assert.throws(() => session.choose('replay-music'));
  assert.ok(session.state.transcript.every((message) => message.speaker === 'contact'));
  assert.deepEqual(reopened.data.choices, choices);
  assert.equal(reopened.current.id, 'pixelgirl-hello');
  assert.deepEqual(
    new ReplayReactions(new Progression(story, storage), definitions, config).flush(8000),
    [],
  );
});
test('later reactions rotate through all variants and NEW GAME discards every old replay record', () => {
  const { storage, progression, reactions } = setup();
  reactions.launch(0);
  meet(progression);
  for (let index = 0; index < 8; index++) {
    reactions.launch(index * 6000);
    reactions.flush(index * 6000 + 5000);
  }
  const variants = progression.data.replayReactions.slice(1).map((event) => event.template);
  for (let index = 1; index < variants.length; index++)
    assert.notEqual(variants[index], variants[index - 1]);
  assert.equal(new Set(variants).size, config.variants.length);
  progression.newGame();
  assert.equal(progression.data.level1Launches, 0);
  assert.deepEqual(progression.data.replayReactions, []);
  assert.equal(storage.getItem('chaos-survival-history-v1'), null);
  reactions.launch(100000);
  assert.equal(progression.data.level1Launches, 1);
  assert.deepEqual(reactions.flush(106000), []);
});

test('every replay variant consists only of PixelGirl messages and cannot offer answers', () => {
  for (const id of [config.first, ...config.variants]) {
    const { progression } = setup();
    const definition = definitions[id];
    const session = new DialogueSession(definition, progression);
    assert.equal(Object.keys(definition.nodes).length, 1);
    while (session.nextMessage()) {
      assert.deepEqual(session.choices, []);
      session.deliver();
    }
    assert.deepEqual(session.choices, []);
    session.advance();
    assert.equal(session.state.finished, true);
    assert.ok(session.state.transcript.every((message) => message.speaker === 'contact'));
    assert.equal(progression.data.choices.length, 0);
  }
});

test('replay messages arrive after two seconds even while the original choice is pending', () => {
  const { progression, reactions } = setup();
  reactions.launch(0);
  const intro = meet(progression, false);
  while (intro.nextMessage()) intro.deliver();
  intro.offerChoices();
  const choices = structuredClone(intro.choices);
  reactions.launch(1000);
  assert.deepEqual(reactions.flush(2999), []);
  const [incoming] = reactions.flush(3000);
  assert.ok(incoming);
  assert.deepEqual(intro.choices, choices);
  assert.equal(reactions.thread.state.activeEvent, incoming.id);
  assert.equal(reactions.thread.state.pendingEvents.length, 1);
  assert.equal(Object.keys(progression.data.dialogues).length, 2);
  assert.deepEqual(
    reactions.thread.pendingResponses.map((group) => group.definition.id),
    ['pixelgirl-intro'],
  );
  assert.deepEqual(reactions.thread.availableResponses, []);
  reactions.flush(3750);
  reactions.flush(4500);
  assert.equal(reactions.thread.availableResponses.length, 1);
  const previousHistory = structuredClone(reactions.thread.state.history);
  finish(intro, progression);
  assert.deepEqual(reactions.flush(7000), []);
  const history = reactions.thread.state.history;
  assert.equal(history[0].text, 'heyyyy :DDD');
  assert.deepEqual(history.slice(0, previousHistory.length), previousHistory);
  assert.equal(
    history.findLast((entry) => entry.eventId === incoming.id).text,
    "t'as décidé de devenir champion du monde de fermeture de fenêtres ou quoi xD",
  );
  assert.equal(history.length, intro.state.transcript.length + 3);
});

test('completed message-only replays survive restart without blocking subsequent variants', () => {
  const { storage, progression, reactions } = setup();
  reactions.launch(0);
  meet(progression);
  reactions.launch(1000);
  reactions.flush(6000);
  const firstEvent = reactions.definition(progression.data.replayReactions[0]);
  finishScheduledEvent(reactions.thread, progression, firstEvent, 6000);
  const history = structuredClone(reactions.thread.state.history);
  const restored = new ReplayReactions(new Progression(story, storage), definitions, config);
  assert.deepEqual(restored.thread.state.history, history);
  restored.launch(7000);
  restored.flush(9000);
  const secondEvent = restored.definition(restored.progression.data.replayReactions.at(-1));
  finishScheduledEvent(restored.thread, restored.progression, secondEvent, 9000);
  assert.equal(restored.thread.availableResponses.length, 0);
  assert.ok(restored.thread.state.history.some((entry) => entry.text === 'ENCORE ??? MDRRR'));
  assert.equal(restored.progression.data.level1Launches, 3);
  assert.deepEqual(restored.flush(99999), []);
  restored.thread.markRead();
  assert.deepEqual(restored.thread.state.unread, []);
});

test('legacy selectable scenarios migrate once into a chronological history without losing pending replies', () => {
  const { storage, progression, reactions } = setup();
  const intro = meet(progression, false);
  reactions.launch(0);
  const event = progression.data.replayReactions[0];
  event.ready = true;
  const replay = new DialogueSession(reactions.definition(event), progression);
  while (replay.nextMessage()) replay.deliver();
  replay.offerChoices();
  intro.state.transcript[0].receivedAt = 100;
  replay.state.transcript.forEach((entry, index) => (entry.receivedAt = 200 + index));
  const before = structuredClone(progression.data.dialogues);
  delete progression.data.conversations;
  progression.save();
  const restored = new ReplayReactions(new Progression(story, storage), definitions, config);
  assert.deepEqual(
    restored.progression.data.dialogues['pixelgirl-intro'],
    before['pixelgirl-intro'],
  );
  assert.deepEqual(
    restored.progression.data.dialogues[event.id].transcript,
    before[event.id].transcript,
  );
  assert.equal(restored.progression.data.dialogues[event.id].finished, true);
  assert.equal(restored.thread.state.history.length, 4);
  assert.equal(restored.thread.state.history[0].text, 'heyyyy :DDD');
  assert.equal(restored.thread.activeDefinition.id, 'pixelgirl-intro');
  assert.deepEqual(restored.flush(99999), []);
  const again = new ReplayReactions(new Progression(story, storage), definitions, config);
  assert.deepEqual(again.thread.state.history, restored.thread.state.history);
  finish(new DialogueSession(definitions['pixelgirl-intro'], again.progression), again.progression);
  assert.equal(again.thread.activeDefinition.id, event.id);
  assert.equal(new DialogueSession(again.definition(event), again.progression).choices.length, 0);
});

test('legacy five-second deadlines migrate to two seconds without changing received history or choices', () => {
  const { storage, progression } = setup();
  meet(progression);
  progression.data.level1Launches = 2;
  progression.data.replayReactions.push({
    attempt: 2,
    id: 'legacy-attempt',
    template: config.first,
    dueAt: 6000,
    ready: false,
  });
  const choices = structuredClone(progression.data.choices);
  const transcript = structuredClone(progression.data.dialogues['pixelgirl-intro'].transcript);
  progression.save();
  const restored = new ReplayReactions(new Progression(story, storage), definitions, config);
  assert.equal(restored.progression.data.replayReactions[0].dueAt, 3000);
  assert.deepEqual(restored.flush(2999), []);
  assert.equal(restored.flush(3000).length, 1);
  assert.deepEqual(restored.progression.data.choices, choices);
  assert.deepEqual(restored.progression.data.dialogues['pixelgirl-intro'].transcript, transcript);
  const resumed = new ReplayReactions(new Progression(story, storage), definitions, config);
  resumed.flush(99999);
  const legacyDefinition = resumed.definition(resumed.progression.data.replayReactions[0]);
  finishScheduledEvent(resumed.thread, resumed.progression, legacyDefinition, 99999);
  assert.equal(resumed.progression.data.dialogues['legacy-attempt'].transcript.length, 3);
  assert.deepEqual(resumed.flush(100000), []);
});

test('partial receipt resumes once and preserves the original narrative response group', () => {
  const { storage, progression, reactions } = setup();
  const intro = meet(progression, false);
  while (intro.nextMessage()) intro.deliver();
  intro.offerChoices();
  reactions.launch(0);
  const event = progression.data.replayReactions[0];
  event.ready = true;
  const session = new DialogueSession(reactions.definition(event), progression);
  session.deliver();
  const restored = new ReplayReactions(new Progression(story, storage), definitions, config);
  assert.deepEqual(restored.flush(2000), []);
  assert.equal(restored.thread.availableResponses.length, 0);
  assert.equal(restored.flush(2750).length, 1);
  assert.equal(restored.progression.data.dialogues[event.id].transcript.length, 2);
  assert.equal(restored.flush(3500).length, 1);
  assert.equal(restored.progression.data.dialogues[event.id].transcript.length, 3);
  assert.equal(restored.thread.pendingResponses.length, 1);
  assert.equal(restored.thread.pendingResponses[0].definition.id, 'pixelgirl-intro');
  assert.deepEqual(
    new DialogueSession(restored.definition(event), restored.progression).choices,
    [],
  );
  assert.equal(restored.progression.data.choiceOffers['pixelgirl-intro:first-contact'].length, 3);
  assert.deepEqual(restored.flush(9000), []);
});

test('a timed replay resumes its saved next-message deadline across two app sessions', () => {
  const { storage, progression, reactions } = setup();
  meet(progression);
  reactions.launch(1000);
  const [event] = reactions.flush(3000);
  assert.equal(progression.data.dialogues[event.id].receiveDueAt, 3750);
  const second = new ReplayReactions(new Progression(story, storage), definitions, config);
  assert.deepEqual(second.flush(3749), []);
  assert.equal(second.thread.availableResponses.length, 0);
  assert.equal(second.flush(3750).length, 1);
  assert.equal(second.progression.data.dialogues[event.id].transcript.length, 2);
  const third = new ReplayReactions(new Progression(story, storage), definitions, config);
  assert.deepEqual(third.flush(4499), []);
  assert.equal(third.flush(4500).length, 1);
  assert.equal(third.thread.availableResponses.length, 0);
  assert.equal(third.progression.data.dialogues[event.id].transcript.length, 3);
  assert.deepEqual(third.flush(8000), []);
});

test('legacy pending and selected replay answers are retired without losing history or saved choices', () => {
  for (const selected of [false, true]) {
    const { storage, progression, reactions } = setup();
    const intro = meet(progression, false);
    while (intro.nextMessage()) intro.deliver();
    intro.offerChoices();
    reactions.launch(0);
    const event = progression.data.replayReactions[0];
    event.ready = true;
    const replay = new DialogueSession(reactions.definition(event), progression);
    while (replay.nextMessage()) replay.deliver();
    const offers = [
      { id: 'replay-music', text: 'la musique est trop bien', next: 'music' },
      { id: 'replay-score', text: 'score !', next: 'score' },
    ];
    progression.offer(event.id, 'hello', offers);
    if (selected) {
      progression.choose(event.id, 'hello', offers[0], offers);
      replay.state.transcript.push({
        speaker: 'player',
        text: offers[0].text,
        receivedAt: Date.now(),
      });
      replay.state.transcript.push({
        speaker: 'contact',
        text: "j'avoue elle reste dans la t?te :3",
        receivedAt: Date.now(),
      });
      replay.state.node = 'music';
      replay.state.cursor = 1;
    }
    replay.persist();
    reactions.thread.sync();
    const before = structuredClone(progression.data);
    const restored = new ReplayReactions(new Progression(story, storage), definitions, config);
    assert.deepEqual(restored.progression.data.choices, before.choices);
    assert.deepEqual(restored.progression.data.choiceOffers, before.choiceOffers);
    assert.deepEqual(
      restored.progression.data.dialogues['pixelgirl-intro'],
      before.dialogues['pixelgirl-intro'],
    );
    assert.deepEqual(restored.thread.state.history, before.conversations.pixelgirl.history);
    assert.equal(restored.thread.pendingResponses.length, 1);
    assert.equal(restored.thread.pendingResponses[0].definition.id, 'pixelgirl-intro');
    assert.equal(restored.progression.data.dialogues[event.id].finished, true);
    assert.deepEqual(restored.flush(9000), []);
    const again = new ReplayReactions(new Progression(story, storage), definitions, config);
    assert.deepEqual(again.thread.state.history, restored.thread.state.history);
    assert.deepEqual(again.progression.data.choices, before.choices);
  }
});

test('legacy replay templates without launch records keep their messages in the unique history', () => {
  const { storage, progression } = setup();
  meet(progression);
  const replay = new DialogueSession(definitions[config.first], progression);
  while (replay.nextMessage()) replay.deliver();
  replay.persist();
  const transcript = structuredClone(replay.state.transcript);
  const restored = new ReplayReactions(new Progression(story, storage), definitions, config);
  assert.equal(restored.progression.data.replayReactions.length, 0);
  assert.deepEqual(
    restored.thread.state.history
      .filter((message) => message.eventId === config.first)
      .map(({ key, eventId, ...message }) => message),
    transcript,
  );
  assert.equal(restored.thread.availableResponses.length, 0);
  const history = structuredClone(restored.thread.state.history);
  const again = new ReplayReactions(new Progression(story, storage), definitions, config);
  assert.deepEqual(again.thread.state.history, history);
  assert.deepEqual(again.flush(99999), []);
});

test('replay typing follows the next-message deadline without postponing the two-second arrival or offering replies', () => {
  const { progression, reactions, storage } = setup();
  meet(progression);
  reactions.launch(10000);
  reactions.flush(12000);
  const id = progression.data.replayReactions[0].id;
  assert.equal(progression.data.dialogues[id].transcript[0].text, 'et bah !!!');
  assert.equal(reactions.thread.typingContact(12000), null);
  assert.equal(reactions.thread.typingContact(12600).nickname, 'xX_PixelGirl_Xx');
  assert.equal(reactions.thread.availableResponses.length, 0);
  const reopened = new ReplayReactions(new Progression(story, storage), definitions, config);
  assert.equal(reopened.thread.typingContact(12600).nickname, 'xX_PixelGirl_Xx');
  reopened.flush(12750);
  assert.equal(reopened.thread.typingContact(12750), null);
  reopened.flush(99999);
  assert.equal(reopened.thread.typingContact(99999), null);
  assert.equal(reopened.thread.availableResponses.length, 0);
});
