import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { DialogueSession, validateDialogue } from '../src/story/dialogue.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import {
  BOMB_ARENA_REMINDER_SEQUENCES,
  BOMB_ARENA_REMINDER_VARIANTS,
  NarrativeOrchestrator,
} from '../src/story/narrative-orchestrator.js';
import { ConversationWindow } from '../src/ui/conversation.js';
import { createContactAvatar } from '../src/ui/contact-avatar.js';
import { DesktopApplications } from '../src/ui/desktop-apps.js';
import { VirtualFilesystem, virtualFileId } from '../src/story/virtual-filesystem.js';
import { bombArenaHandoffPending, completeBombArenaHandoff } from '../src/story/bomb-arena-handoff.js';
import { resolvePlayerText } from '../src/story/player-identity.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const story = read('../src/config/story.json');
const definitions = Object.fromEntries(
  readdirSync(new URL('../src/dialogues/', import.meta.url))
    .filter((file) => file.endsWith('.json'))
    .map((file) => {
      const definition = read(`../src/dialogues/${file}`);
      return [definition.id, definition];
    }),
);

function fixture() {
  const storage = new Map();
  const store = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  const progression = new Progression(story, store);
  const virtualFilesystem = new VirtualFilesystem(progression);
  let now = 1_000;
  const sentWizzes = [];
  const notifications = [];
  const groupMessages = [];
  let groupThread;
  const contacts = {
    turbo: { id: 'turbo', available: true, online: true },
    pixelgirl: { id: 'pixelgirl', available: true, online: true },
    'plumber-group': { id: 'plumber-group', available: true, online: true },
  };
  const dialogueEvents = { update() {}, triggerConnection() {} };
  const orchestrator = new NarrativeOrchestrator({
    progression,
    definitions,
    dialogueEvents,
    getContact: (id) => contacts[id],
    prepareContact: () => null,
    showConnectionNotification() {},
    showTurboMessageNotification() {},
    sendWizz: (...args) => {
      sentWizzes.push(args);
      return true;
    },
    getGroupThread: () => groupThread,
    showGroupNotification: (contact) => {
      notifications.push(contact?.id);
      return true;
    },
    onGroupMessage: (contact, incoming) =>
      groupMessages.push([contact?.id, ...incoming.map((event) => event.id)]),
    virtualFilesystem,
    now: () => now,
    random: () => 0.2,
  });
  virtualFilesystem.onDelete = (change) => orchestrator.onVirtualFilesDeleted(change);
  return {
    progression,
    virtualFilesystem,
    orchestrator,
    sentWizzes,
    notifications,
    groupMessages,
    storage,
    store,
    setGroupThread: (thread) => (groupThread = thread),
    get now() {
      return now;
    },
    set now(value) {
      now = value;
    },
  };
}

function createBombArenaGroupThread(context) {
  const { progression, orchestrator } = context;
  const thread = new ConversationThread('plumber-group', progression, () => [
    definitions['pixelgirl-super-plombier-group'],
    ...orchestrator.bombArenaReminderEvents(),
  ]);
  context.setGroupThread(thread);
  return thread;
}

function tickBombArenaReminders(orchestrator, thread, now) {
  orchestrator.updateBombArenaReminders(now);
  thread.receive(now);
}

function deliverActiveReminderSalvo(orchestrator, thread, firstScheduledAt) {
  const progress = orchestrator.progression.data.bombArena;
  const salvoNumber = progress.reminderBurstSalvo;
  const sequenceIndex = progress.reminderBurstSequence;
  const messages = [];
  let index = progress.reminderBurstSent - 1;
  let scheduledAt = firstScheduledAt;
  while (index < progress.reminderBurstMessageCount) {
    if (index >= progress.reminderBurstSent) {
      scheduledAt = progress.reminderBurstNextAt;
      orchestrator.updateBombArenaReminders(scheduledAt);
    }
    const expected = [...BOMB_ARENA_REMINDER_SEQUENCES, ...BOMB_ARENA_REMINDER_VARIANTS][sequenceIndex][index];
    const reminderId = `bomb-arena-reminder-salvo-${salvoNumber}-${sequenceIndex}-${index + 1}`;
    assert.deepEqual(thread.typingContacts(scheduledAt).map(({ nickname }) => nickname), [
      { xX_PixelGirl_Xx: 'PixelGirl', Turb0: 'Turb0', '°•.LuNa.°•': 'Luna' }[expected.author],
    ]);
    let receiveAt = scheduledAt + 800;
    let message = null;
    for (let update = 0; update < 20 && !message; update++, receiveAt++) {
      thread.receive(receiveAt);
      message = thread.state.history.find((entry) => entry.eventId === reminderId);
    }
    assert.ok(message, `salvo ${salvoNumber} message ${index + 1} is delivered after typing`);
    messages.push(message);
    index++;
  }
  return messages;
}

test('BombArena gameplay outcomes persist and arm the mandatory continuation gate without placeholder dialogue', () => {
  const { progression, orchestrator } = fixture();
  const current = progression.data.current;
  const completed = [...progression.data.completed];
  assert.equal(orchestrator.onBombArenaEvent({ type: 'launched' }), true);
  assert.equal(orchestrator.onBombArenaEvent({
    type: 'match-completed', matchId: 'narrative-hook-test', difficulty: 'PGM', winnerId: 'luna', roundsPlayed: 8,
    scores: { justme: 1, pixelgirl: 2, turbo: 2, luna: 3 },
  }), true);
  assert.equal(orchestrator.onBombArenaEvent({
    type: 'match-completed', matchId: 'narrative-hook-test', difficulty: 'PGM', winnerId: 'luna', roundsPlayed: 8,
    scores: { justme: 1, pixelgirl: 2, turbo: 2, luna: 3 },
  }), false);
  assert.equal(progression.data.bombArena.firstLaunchedAt !== null, true);
  assert.equal(progression.data.bombArena.firstGameWinner, 'luna');
  assert.equal(progression.data.bombArena.defeats, 1);
  assert.equal(progression.isBombArenaBlockingStory(), false, 'the gate is armed only when the group reaches its offer');
  assert.equal(progression.data.current, current);
  assert.deepEqual(progression.data.completed, completed);
  assert.deepEqual(progression.data.dialogues, {}, 'no placeholder Messenger conversation is created');
});

test('BombArena offer starts persistent unlimited Messenger reminders, suspends while open, and stops after return', () => {
  const context = fixture();
  const { progression, orchestrator } = context;
  progression.data.flags.superPlombierPostStarted = true;
  progression.data.flags.superPlombierGroupCreated = true;
  progression.data.dialogues['pixelgirl-super-plombier-group'] = {
    node: 'bomb-arena-transfer', cursor: 0, finished: false, transcript: [], revision: 5,
  };
  const thread = createBombArenaGroupThread(context);

  orchestrator.update(1_000);
  assert.equal(progression.data.bombArena.status, 'NOT_STARTED');
  assert.equal(progression.isBombArenaBlockingStory(), true);
  const firstDue = progression.data.bombArena.nextReminderAt;
  assert.ok(firstDue > 1_000);
  orchestrator.update(firstDue - 1);
  assert.equal(thread.state.history.filter((message) => message.eventId?.startsWith('bomb-arena-reminder-')).length, 0);
  tickBombArenaReminders(orchestrator, thread, firstDue);
  assert.equal(thread.state.history.filter((message) => message.eventId?.startsWith('bomb-arena-reminder-')).length, 0);
  assert.deepEqual(thread.typingContacts(firstDue).map(({ nickname }) => nickname), ['PixelGirl']);
  tickBombArenaReminders(orchestrator, thread, firstDue + 799);
  assert.equal(thread.state.history.filter((message) => message.eventId?.startsWith('bomb-arena-reminder-')).length, 0);
  const firstSalvo = deliverActiveReminderSalvo(orchestrator, thread, firstDue);
  assert.deepEqual(firstSalvo.map(({ author, text }) => [author, text]), [
    ['xX_PixelGirl_Xx', 'alleeez'], ['Turb0', "t'es nul"],
    ['xX_PixelGirl_Xx', 'viens on joue'], ['xX_PixelGirl_Xx', 'alleeez'],
  ]);
  assert.deepEqual(firstSalvo.map(({ text }) => text), [
    'alleeez', "t'es nul", 'viens on joue', 'alleeez',
  ], 'the first salvo keeps its original reminders');
  const firstMessageCount = thread.state.history.length;
  tickBombArenaReminders(orchestrator, thread, firstDue + 800);
  assert.equal(thread.state.history.length, firstMessageCount, 'repeated updates do not duplicate a delivered reminder');

  orchestrator.onBombArenaEvent({ type: 'launched' });
  tickBombArenaReminders(orchestrator, thread, progression.data.bombArena.nextReminderAt + 10_000);
  assert.equal(thread.state.history.filter((message) => message.eventId?.startsWith('bomb-arena-reminder-')).length, 4, 'open or minimized BombArena suspends Messenger reminders after preserving the delivered first salvo');
  orchestrator.onBombArenaEvent({ type: 'interrupted' });
  let clock = progression.data.bombArena.reminderBurstNextAt;
  tickBombArenaReminders(orchestrator, thread, clock);
  const burstMessages = deliverActiveReminderSalvo(orchestrator, thread, clock);
  assert.deepEqual(burstMessages.map(({ text }) => text), [
    'stppppp', "t'as lancé le jeu pour le fermer ou quoi mdr", 'mais revieeens xD', "on t'attend",
  ]);
  assert.equal(progression.data.bombArena.reminderSalvoCount, 2, 'the second salve continues the sequence after the first periodic salve');

  clock = progression.data.bombArena.nextReminderAt;
  assert.ok(clock > context.now && clock - context.now >= 20_000 && clock - context.now <= 45_000,
    'periodic reminders after an early close use the requested 20–45 second cadence');
  for (let count = 2; count <= 7; count++) {
    const startedAt = clock;
    const didStart = orchestrator.updateBombArenaReminders(startedAt);
    const sequenceIndex = progression.data.bombArena.reminderBurstSequence;
    assert.equal(didStart, true, `periodic salvo ${count} starts when its saved deadline is reached`);
    const delivered = deliverActiveReminderSalvo(orchestrator, thread, startedAt);
    assert.ok(delivered.length >= 4, 'periodic reminders deliver a complete multi-message salvo');
    assert.equal(progression.data.bombArena.reminderCount, count);
    if (count >= 2 && count <= 5) {
      assert.equal(sequenceIndex, count, 'each remaining fixed conversation is selected in order');
      assert.deepEqual(delivered.map(({ author, text }) => ({ author, text })),
        BOMB_ARENA_REMINDER_SEQUENCES[sequenceIndex].map((line) => ({
          ...line, text: resolvePlayerText(line.text, progression.data.playerIdentity),
        })));
    }
    if (count === 6) assert.equal(sequenceIndex, 6 + 1, 'the seventh salvo moves to the variant library');
    if (count === 7) assert.equal(sequenceIndex, 6 + 2, 'a variant is not repeated immediately');
    clock = progression.data.bombArena.nextReminderAt;
    assert.ok(clock - startedAt >= 20_000 && clock - startedAt <= 45_000);
  }

  orchestrator.onBombArenaEvent({
    type: 'match-completed', matchId: 'reminder-finished', difficulty: 'PGM', winnerId: 'pixelgirl', roundsPlayed: 8,
    scores: { justme: 1, pixelgirl: 3, turbo: 2, luna: 2 },
  });
  orchestrator.onBombArenaEvent({ type: 'returned-to-messenger' });
  const before = thread.state.history.length;
  tickBombArenaReminders(orchestrator, thread, clock + 1_000_000);
  assert.equal(thread.state.history.length, before, 'no reminder is sent after the player returns from results');
  assert.equal(progression.data.bombArena.status, 'COMPLETED');
});

test('every early BombArena closure creates a fresh four-message burst, cancels it on relaunch, and persists waiting state', () => {
  const context = fixture();
  const { progression, orchestrator, store } = context;
  progression.recordBombArenaEvent({ type: 'expected' }, context.now);
  const thread = createBombArenaGroupThread(context);

  orchestrator.onBombArenaEvent({ type: 'launched' });
  assert.equal(orchestrator.onBombArenaEvent({ type: 'interrupted' }), true);
  assert.equal(orchestrator.onBombArenaEvent({ type: 'interrupted' }), false, 'duplicate close notifications cannot create another burst');
  const firstBurstId = progression.data.bombArena.interruptionCount;
  let due = progression.data.bombArena.reminderBurstNextAt;
  tickBombArenaReminders(orchestrator, thread, due);
  const firstBurst = deliverActiveReminderSalvo(orchestrator, thread, due);
  assert.equal(firstBurst.length, 4);
  assert.ok(firstBurst[0].receivedAt < firstBurst[1].receivedAt &&
    firstBurst[1].receivedAt < firstBurst[2].receivedAt &&
    firstBurst[2].receivedAt < firstBurst[3].receivedAt,
  'the four messages arrive progressively instead of in one frame');
  assert.ok(firstBurst[3].receivedAt - firstBurst[0].receivedAt >= 5_000 &&
    firstBurst[3].receivedAt - firstBurst[0].receivedAt <= 12_000,
  'the initial burst spans approximately five to twelve seconds');

  orchestrator.onBombArenaEvent({ type: 'launched' });
  assert.equal(progression.data.bombArena.reminderBurstRemaining, 0, 'relaunch cancels unsent burst items');
  assert.equal(thread.typingContacts(due).length, 0, 'relaunch clears any pending reminder typing cue');
  assert.equal(thread.state.history.filter((message) => message.eventId?.startsWith(`bomb-arena-reminder-salvo-${firstBurstId}-`)).length, 4,
    'already received burst messages remain in group history');
  orchestrator.onBombArenaEvent({ type: 'interrupted' });
  const secondBurstId = progression.data.bombArena.interruptionCount;
  assert.equal(secondBurstId, firstBurstId + 1);
  due = progression.data.bombArena.reminderBurstNextAt;
  tickBombArenaReminders(orchestrator, thread, due);
  const secondBurst = deliverActiveReminderSalvo(orchestrator, thread, due);
  assert.equal(secondBurst.length, 4);
  assert.equal(progression.data.bombArena.reminderBurstRemaining, 0);

  // A game reload resumes one persisted periodic schedule rather than creating timers.
  const reloaded = new Progression(story, store);
  let reloadedThread;
  const reloadedOrchestrator = new NarrativeOrchestrator({
    progression: reloaded,
    definitions,
    dialogueEvents: { update() {}, triggerConnection() {} },
    getContact: (id) => id === 'plumber-group' ? { id, available: true, online: true } : null,
    getGroupThread: () => reloadedThread,
    onGroupMessage: () => {},
    now: () => context.now,
    random: () => 0.2,
  });
  reloadedThread = new ConversationThread('plumber-group', reloaded, () => [
    definitions['pixelgirl-super-plombier-group'],
    ...reloadedOrchestrator.bombArenaReminderEvents(),
  ]);
  const countBeforeReloadReminder = reloaded.data.bombArena.reminderCount;
  const persistedDueAt = reloaded.data.bombArena.nextReminderAt;
  reloadedOrchestrator.updateBombArenaReminders(persistedDueAt);
  assert.equal(reloaded.data.bombArena.reminderCount, countBeforeReloadReminder + 1);
  assert.ok(reloaded.data.bombArena.nextReminderAt - persistedDueAt >= 20_000 &&
    reloaded.data.bombArena.nextReminderAt - persistedDueAt <= 45_000);
  const restoredAgain = new Progression(story, store);
  let restoredAgainOrchestrator;
  let restoredAgainThread;
  restoredAgainOrchestrator = new NarrativeOrchestrator({
    progression: restoredAgain,
    definitions,
    dialogueEvents: { update() {}, triggerConnection() {} },
    getContact: (id) => id === 'plumber-group' ? { id, available: true, online: true } : null,
    getGroupThread: () => restoredAgainThread,
    now: () => context.now,
    random: () => 0.2,
  });
  restoredAgainThread = new ConversationThread('plumber-group', restoredAgain, () => [
    definitions['pixelgirl-super-plombier-group'],
    ...restoredAgainOrchestrator.bombArenaReminderEvents(),
  ]);
  assert.deepEqual(restoredAgainThread.typingContacts(persistedDueAt).map(({ nickname }) => nickname), ['Turb0'],
    'the saved typing interval resumes after reload with the correct group author');
  const pendingReminderId = `bomb-arena-reminder-salvo-${restoredAgain.data.bombArena.reminderBurstSalvo}-${restoredAgain.data.bombArena.reminderBurstSequence}-${restoredAgain.data.bombArena.reminderBurstSent}`;
  const receivedPendingReminder = () => restoredAgainThread.state.history.filter((message) => message.eventId === pendingReminderId).length;
  for (let now = persistedDueAt + 800; now < persistedDueAt + 2_000 && !receivedPendingReminder(); now++)
    restoredAgainThread.receive(now);
  assert.equal(receivedPendingReminder(), 1, 'the due periodic message appears exactly once');
  restoredAgainThread.receive(persistedDueAt + 900);
  assert.equal(receivedPendingReminder(), 1, 'a later update does not duplicate that same saved event');
});

test('relaunching BombArena cancels a saved pending reminder and clears its typing indicator', () => {
  const context = fixture();
  const { progression, orchestrator, store } = context;
  progression.recordBombArenaEvent({ type: 'expected' }, context.now);
  const thread = createBombArenaGroupThread(context);
  orchestrator.onBombArenaEvent({ type: 'launched' });
  orchestrator.onBombArenaEvent({ type: 'interrupted' });
  const typingStartsAt = progression.data.bombArena.reminderBurstNextAt;
  tickBombArenaReminders(orchestrator, thread, typingStartsAt);
  assert.deepEqual(thread.typingContacts(typingStartsAt).map(({ nickname }) => nickname), ['PixelGirl']);
  const pendingId = 'bomb-arena-reminder-salvo-1-0-1';
  assert.ok(Number.isFinite(progression.data.dialogues[pendingId].receiveDueAt));

  orchestrator.onBombArenaEvent({ type: 'launched' });
  assert.equal(progression.data.dialogues[pendingId].expired, true);
  assert.equal(progression.data.dialogues[pendingId].receiveDueAt, undefined);
  assert.deepEqual(thread.typingContacts(typingStartsAt + 100), []);
  thread.receive(typingStartsAt + 2_000);
  assert.equal(thread.state.history.some((message) => message.eventId === pendingId), false,
    'a canceled pending message is not received after the game resumes');

  orchestrator.onBombArenaEvent({ type: 'interrupted' });
  const finalTypingAt = progression.data.bombArena.reminderBurstNextAt;
  tickBombArenaReminders(orchestrator, thread, finalTypingAt);
  const finalPendingId = 'bomb-arena-reminder-salvo-2-1-1';
  assert.deepEqual(thread.typingContacts(finalTypingAt).map(({ nickname }) => nickname), ['PixelGirl']);
  assert.equal(orchestrator.onBombArenaEvent({
    type: 'match-completed',
    matchId: 'reminder-cancelled-on-finish',
    difficulty: 'PGM',
    winnerId: 'pixelgirl',
    roundsPlayed: 8,
    scores: { justme: 0, pixelgirl: 3, turbo: 1, luna: 2 },
  }), true);
  assert.equal(progression.data.dialogues[finalPendingId].expired, true,
    'final results cancel even a stale saved reminder');
  assert.deepEqual(thread.typingContacts(finalTypingAt + 100), []);
  thread.receive(finalTypingAt + 2_000);
  assert.equal(thread.state.history.some((message) => message.eventId === finalPendingId), false,
    'no reminder arrives after the final result is recorded');

  const restored = new Progression(story, {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  });
  let restoredThread;
  const restoredOrchestrator = new NarrativeOrchestrator({
    progression: restored,
    definitions,
    dialogueEvents: { update() {}, triggerConnection() {} },
    getContact: (id) => id === 'plumber-group' ? { id, available: true, online: true } : null,
    getGroupThread: () => restoredThread,
    now: () => context.now,
  });
  restoredThread = new ConversationThread('plumber-group', restored, () => [
    definitions['pixelgirl-super-plombier-group'],
    ...restoredOrchestrator.bombArenaReminderEvents(),
  ]);
  assert.deepEqual(restoredThread.typingContacts(finalTypingAt + 100), [],
    'the canceled indicator remains absent after reload');
  restoredThread.receive(finalTypingAt + 3_000);
  assert.equal(restoredThread.state.history.some((message) => message.eventId === pendingId || message.eventId === finalPendingId), false,
    'the canceled reminder is not delivered after reload');
});

test('closing the actual BombArena desktop window starts one persisted reminder burst and returns the group window', () => {
  const context = fixture();
  const { progression, orchestrator } = context;
  progression.recordBombArenaEvent({ type: 'expected' }, context.now);
  const thread = createBombArenaGroupThread(context);
  const element = { isConnected: true, querySelector: () => null };
  const manager = {
    options: null,
    spawn(_type, options) { this.options = options; return 41; },
    close() { element.isConnected = false; this.options.onDismiss({ reason: 'close' }); },
  };
  let openedGroup = 0;
  const app = Object.assign(Object.create(DesktopApplications.prototype), {
    manager,
    instances: new Map(),
    virtualFilesystem: { exists: () => true, progression },
    attachWindow(key, id) {
      const instance = { id, element, task: { remove() {} } };
      this.instances.set(key, instance);
      return instance;
    },
    restore() {},
    onWindowState() {},
    onBombArenaEvent: (event) => orchestrator.onBombArenaEvent(event),
    onBombArenaInterrupted() { openedGroup++; return true; },
  });

  const instance = app.openBombArena({}, 'bomb-arena-folder/bombarena.exe');
  manager.close(instance.id);
  assert.equal(openedGroup, 1, 'the close callback reactivates the existing group conversation route');
  assert.equal(progression.data.bombArena.reminderBurstRemaining, 4);
  let due = progression.data.bombArena.reminderBurstNextAt;
  tickBombArenaReminders(orchestrator, thread, due);
  deliverActiveReminderSalvo(orchestrator, thread, due);
  assert.equal(thread.state.history.filter((message) => message.eventId?.startsWith('bomb-arena-reminder-salvo-')).length, 4);
});

test('BombArena post-match dialogue branches on the saved final winner and converges on the exact shared sequence', () => {
  const definition = definitions['bomb-arena-postmatch'];
  const branches = {
    justme: [
      ['xX_PixelGirl_Xx', 'AAAAAA'], ['xX_PixelGirl_Xx', 'GG !!!'],
      ['Turb0', 'MAIS NAN'], ['Turb0', "j'y crois pas mdr"], ['°•.LuNa.°•', 'gg :)'],
      ['Turb0', 'ouais bon gg'], ['xX_PixelGirl_Xx', 'mdrrrrr turbo il est dégouté'],
      ['Turb0', 'même pas'],
    ],
    pixelgirl: [
      ['xX_PixelGirl_Xx', 'AAAAAAAA'], ['xX_PixelGirl_Xx', 'JAI GAGNéééé'],
      ['xX_PixelGirl_Xx', 'PTDRRRR'], ['Turb0', 'ouais bon ça va'], ['°•.LuNa.°•', 'gg :)'],
      ['xX_PixelGirl_Xx', 'merciiiii :3'], ['Turb0', 'profite ça arrivera pas deux fois mdr'],
      ['xX_PixelGirl_Xx', 'rage paaaas'],
    ],
    turbo: [
      ['Turb0', 'ET VOILAAAAA'], ['Turb0', 'JVOUS AVAIS DIT'], ['xX_PixelGirl_Xx', 'PTDRRRRR'],
      ['xX_PixelGirl_Xx', "t'es insupportable"], ['°•.LuNa.°•', 'gg'], ['Turb0', 'merci luna'],
      ['Turb0', 'au moins une personne qui reconnaît le talent ici'], ['xX_PixelGirl_Xx', 'MDRRRR'],
    ],
    luna: [
      ['°•.LuNa.°•', "j'ai gagné"], ['xX_PixelGirl_Xx', 'LUNAAAAAAA'],
      ['xX_PixelGirl_Xx', 'MAIS MDRRRRR'], ['Turb0', 'nan mais sérieux'],
      ['Turb0', 'elle dit rien et elle gagne tranquille'], ['°•.LuNa.°•', 'fallait peut-être essayer'],
      ['xX_PixelGirl_Xx', 'AHAHAHAHA'],
    ],
  };
  const common = [
    ['Turb0', 'bon par contre'], ['Turb0', "c'était quoi ce mode ultra difficile là mdr"],
    ['xX_PixelGirl_Xx', 'PTDRRRR'], ['xX_PixelGirl_Xx', "les dernières manches c'était n'importe quoi"],
    ['°•.LuNa.°•', "c'était un peu le principe"], ['Turb0', 'ouais bah merci'],
    ['xX_PixelGirl_Xx', 'mdrrrr'], ['xX_PixelGirl_Xx', 'en vrai c\'était trop bieeen :3'],
    ['Turb0', 'ouais grave'], ['°•.LuNa.°•', 'c\'était sympa :)'],
    ['xX_PixelGirl_Xx', 'ah au fait'], ['xX_PixelGirl_Xx', 'pensez à supprimer bombarena après, dans vos documents, dossier "Mes fichiers reçus" !!! :D'],
    ['xX_PixelGirl_Xx', 'il prend grave de place ce truc mdr'],
    ['Turb0', 'on vient de finir et tu veux déjà le virer ??'],
    ['xX_PixelGirl_Xx', 'bah oui xD'], ['xX_PixelGirl_Xx', "on y a joué c'est bon"],
  ];
  for (const [winner, branch] of Object.entries(branches)) {
    const { progression } = fixture();
    progression.data.flags.bombArenaWinner = winner;
    const session = new DialogueSession(definition, progression);
    const actual = [];
    let now = 10_000;
    for (;;) {
      const message = session.nextMessage();
      if (message) {
        actual.push([message.author, message.text]);
        session.deliver(now++);
      } else if (!session.advance()) break;
    }
    assert.deepEqual(actual, [...branch, ...common], `${winner} has one winner-specific branch followed by the same convergence`);
    assert.deepEqual(session.choices, []);
    assert.equal(session.state.finished, true);
  }
  assert.equal(definition.nodes['after-match'].messages[definition.nodes['after-match'].messages.findIndex((message) => message.text === 'ah au fait')].delayMs, 2200,
    'the pause before the deletion suggestion is represented only by a longer delivery delay');
});

test('final results start the existing post-match branch for each winner once', () => {
  const expectedFirstMessage = {
    justme: 'AAAAAA',
    pixelgirl: 'AAAAAAAA',
    turbo: 'ET VOILAAAAA',
    luna: "j'ai gagné",
  };
  for (const [index, [winner, firstMessage]] of Object.entries(expectedFirstMessage).entries()) {
    const { progression, orchestrator } = fixture();
    const scores = Object.fromEntries(['justme', 'pixelgirl', 'turbo', 'luna']
      .map((id) => [id, id === winner ? 8 : 0]));
    orchestrator.onBombArenaEvent({ type: 'expected' });
    orchestrator.onBombArenaEvent({
      type: 'match-completed', matchId: `immediate-results-${index}`, difficulty: 'PGM',
      winnerId: winner, roundsPlayed: 8, scores,
    });
    assert.equal(orchestrator.bombArenaPostMatchAvailable(), false,
      'the branch waits only for Messenger activation, not for BombArena to close');
    assert.equal(bombArenaHandoffPending(progression), true,
      'a saved final result immediately represents a pending handoff');
    assert.equal(completeBombArenaHandoff({
      progression,
      onBombArenaEvent: (event) => orchestrator.onBombArenaEvent(event),
      activateGroup: () => true,
    }), true);
    assert.equal(orchestrator.bombArenaPostMatchAvailable(), true);

    const postmatch = definitions['bomb-arena-postmatch'];
    const thread = new ConversationThread('plumber-group', progression, () => [postmatch]);
    thread.schedule(postmatch, 10_000);
    const dueAt = progression.data.dialogues[postmatch.id].receiveDueAt;
    assert.deepEqual(thread.receive(dueAt), [postmatch]);
    assert.equal(progression.data.dialogues[postmatch.id].transcript[0].text, firstMessage);
    assert.deepEqual(thread.receive(dueAt), []);
    assert.equal(progression.data.dialogues[postmatch.id].transcript.length, 1,
      'repeated updates do not duplicate the first message');
  }
});

test('BombArena post-match sequence unlocks at the Messenger handoff and resumes once in the existing group thread', () => {
  const context = fixture();
  const { progression, orchestrator, store } = context;
  const group = definitions['pixelgirl-super-plombier-group'];
  const postMatch = definitions['bomb-arena-postmatch'];
  progression.data.dialogues[group.id] = {
    node: 'bomb-arena-after-transfer', cursor: group.nodes['bomb-arena-after-transfer'].messages.length,
    finished: true, transcript: [], revision: group.revision,
  };
  const getEvents = () => [group,
    ...(orchestrator.bombArenaPostMatchAvailable() ? [postMatch] : []),
    ...orchestrator.bombArenaRedownloadEvents(),
  ];
  const thread = new ConversationThread('plumber-group', progression, getEvents);
  thread.state.history.push({ key: 'previous-group-message', eventId: group.id, speaker: 'contact', author: 'Turb0', text: 'history preserved', receivedAt: 1 });
  context.setGroupThread(thread);
  orchestrator.onBombArenaEvent({ type: 'expected' });
  orchestrator.onBombArenaEvent({ type: 'launched' });
  orchestrator.onBombArenaEvent({ type: 'interrupted' });
  assert.equal(getEvents().some((event) => event.id === postMatch.id), false,
    'closing an unfinished BombArena session does not unlock the post-match dialogue');
  const scores = { justme: 1, pixelgirl: 2, turbo: 3, luna: 4 };
  for (let round = 1; round <= 8; round++) {
    assert.equal(orchestrator.onBombArenaEvent({ type: 'round-completed', round, scores, winnerId: 'luna' }), true);
    assert.equal(getEvents().some((event) => event.id === postMatch.id), false,
      `the post-match event is still gated after round ${round}`);
  }
  assert.equal(orchestrator.onBombArenaEvent({
    type: 'match-completed', matchId: 'postmatch-test', difficulty: 'PGM', winnerId: 'luna', roundsPlayed: 8, scores,
  }), true);
  assert.equal(progression.data.bombArena.status, 'RESULTS_READY');
  assert.equal(bombArenaHandoffPending(progression), true, 'saved results make the immediate handoff recoverable');
  assert.equal(getEvents().some((event) => event.id === postMatch.id), false, 'the branch waits until the existing group is activated');
  assert.equal(completeBombArenaHandoff({
    progression,
    onBombArenaEvent: (event) => orchestrator.onBombArenaEvent(event),
    activateGroup: () => false,
  }), false, 'a missing group window leaves the handoff pending');
  assert.equal(progression.data.bombArena.status, 'RESULTS_READY');
  const activationOrder = [];
  assert.equal(completeBombArenaHandoff({
    progression,
    onBombArenaEvent: (event) => {
      activationOrder.push('completed');
      return orchestrator.onBombArenaEvent(event);
    },
    activateGroup: () => { activationOrder.push('group-opened'); return true; },
  }), true);
  assert.deepEqual(activationOrder, ['group-opened', 'completed']);
  assert.equal(bombArenaHandoffPending(progression), true, 'the delivered branch remains recoverable until it finishes');
  assert.equal(getEvents().some((event) => event.id === postMatch.id), true);
  assert.deepEqual(orchestrator.bombArenaRedownloadEvents(), [], 'scheduled reminders and reoffers are suppressed after results');
  assert.equal(progression.data.flags.bombArenaWinner, 'luna');

  thread.receive(100_000_000);
  thread.receive(100_001_000);
  const partial = thread.state.history.filter((entry) => entry.eventId === postMatch.id);
  assert.ok(partial.length > 0 && partial.length < 23, 'the group receives the dialogue progressively');
  assert.deepEqual([partial[0].author, partial[0].text], ['°•.LuNa.°•', "j'ai gagné"],
    'the first visible group message follows the saved winner branch');
  assert.equal(thread.state.history.some((entry) => entry.key === 'previous-group-message'), true);
  assert.equal(orchestrator.onBombArenaEvent({ type: 'returned-to-messenger' }), false, 'the return event is single-use');

  const reloaded = new Progression(story, store);
  const restoredOrchestrator = new NarrativeOrchestrator({
    progression: reloaded,
    definitions,
    dialogueEvents: { update() {}, triggerConnection() {} },
    getContact: () => ({ id: 'plumber-group' }),
    prepareContact() {}, showConnectionNotification() {},
  });
  const restoredThread = new ConversationThread('plumber-group', reloaded, () => [
    group,
    ...(restoredOrchestrator.bombArenaPostMatchAvailable() ? [postMatch] : []),
    ...restoredOrchestrator.bombArenaRedownloadEvents(),
  ]);
  let resumedAt = 200_000_000;
  for (let update = 0; update < 40 && !reloaded.data.dialogues[postMatch.id]?.finished; update++) {
    const dueAt = reloaded.data.dialogues[postMatch.id]?.receiveDueAt;
    restoredThread.receive(Number.isFinite(dueAt) ? Math.max(resumedAt, dueAt) : resumedAt);
    resumedAt += 100_000;
  }
  assert.equal(restoredThread.state.history.filter((entry) => entry.eventId === postMatch.id).length, 23,
    'reloading mid-dialogue resumes the saved sequence without duplicating messages');
  assert.equal(reloaded.data.dialogues[postMatch.id].finished, true);
  assert.equal(reloaded.data.bombArena.sessionWinner, 'luna', 'the saved final result is retained');
  assert.equal(bombArenaHandoffPending(reloaded), false, 'the startup replay is suppressed after the dialogue finishes');
});

test('a completed legacy BombArena save can select its recorded first-game winner for the new dialogue', () => {
  const context = fixture();
  const { progression, store } = context;
  progression.data.bombArena = {
    ...progression.data.bombArena,
    status: 'COMPLETED',
    returnedToMessengerAt: 15_000,
    sessionWinner: null,
    firstGameWinner: 'turbo',
  };
  progression.save();
  const reloaded = new Progression(story, store);
  const orchestrator = new NarrativeOrchestrator({
    progression: reloaded,
    definitions,
    dialogueEvents: { update() {}, triggerConnection() {} },
    getContact: () => ({ id: 'plumber-group' }),
    prepareContact() {}, showConnectionNotification() {},
  });
  assert.equal(orchestrator.bombArenaPostMatchAvailable(), true);
  assert.equal(reloaded.data.flags.bombArenaWinner, 'turbo');
  assert.equal(bombArenaHandoffPending(reloaded), true, 'a legacy completed save without the group dialogue can recover on startup');
});

test('Super Plombier fixes PixelGirl case at victory and schedules three Wizzes only for case A', () => {
  const { progression, orchestrator, sentWizzes } = fixture();
  progression.data.dialogues['pixelgirl-smiley-victory'] = { finished: false };
  orchestrator.onSuperPlombierStart();
  assert.equal(progression.data.flags.superPlombierPixelCase, undefined);
  progression.data.dialogues['pixelgirl-smiley-victory'] = {
    node: 's8-common-1',
    cursor: definitions['pixelgirl-smiley-victory'].nodes['s8-common-1'].messages.length,
    finished: true,
    transcript: [{ speaker: 'contact', text: 'bon jreviens :3', receivedAt: 1_000 }],
  };
  assert.equal(orchestrator.onSuperPlombierVictory(), true);
  assert.equal(progression.data.flags.superPlombierPixelCase, 'A');
  assert.equal(orchestrator.onSuperPlombierVictory(), false);
  progression.data.dialogues['turbo-super-plombier'] = {
    transcript: [{ speaker: 'contact', receivedAt: 1_000 }],
  };
  progression.data.dialogues['pixelgirl-smiley-victory'] = {
    node: 's8-common-1',
    cursor: definitions['pixelgirl-smiley-victory'].nodes['s8-common-1'].messages.length,
    finished: true,
    transcript: [{ speaker: 'contact', text: 'bon jreviens :3', receivedAt: 1_000 }],
  };

  orchestrator.updateSuperPlombierWizzes(20_999);
  assert.equal(sentWizzes.length, 0);
  orchestrator.updateSuperPlombierWizzes(21_000);
  orchestrator.updateSuperPlombierWizzes(31_000);
  orchestrator.updateSuperPlombierWizzes(39_000);
  orchestrator.updateSuperPlombierWizzes(50_000);

  assert.deepEqual(sentWizzes.map(([id, event]) => [id, event]), [
    ['pixelgirl', 'pixelgirl-super-plombier-wizz-1'],
    ['pixelgirl', 'pixelgirl-super-plombier-wizz-2'],
    ['pixelgirl', 'pixelgirl-super-plombier-wizz-3'],
  ]);
  assert.equal(progression.data.flags.superPlombierWizzCount, 3);
  assert.equal(orchestrator.isConversationUnlocked('pixelgirl-super-plombier-wizz'), true);
});

test('case B preserves the prior PixelGirl conversation and does not unlock the added Wizz dialogue', () => {
  const context = fixture();
  const { progression, orchestrator, sentWizzes } = context;
  const previousDialogue = {
    finished: false,
    node: 's1',
    transcript: [{ speaker: 'contact', text: 'ancien message' }],
  };
  progression.data.dialogues['pixelgirl-smiley-victory'] = previousDialogue;
  orchestrator.onSuperPlombierStart();
  assert.equal(progression.data.flags.superPlombierPixelCase, undefined);
  progression.data.flags.superPlombierPixelCase = 'A'; // Stale pre-victory snapshot from an older save.
  orchestrator.onSuperPlombierVictory();
  assert.equal(progression.data.flags.superPlombierPixelCase, 'B');
  progression.data.flags.superPlombierWizzCount = 3;
  progression.data.flags.superPlombierNextWizzAt = 20_000;
  progression.data.dialogues['turbo-super-plombier'] = {
    transcript: [{ speaker: 'contact', receivedAt: 1_000 }],
  };
  orchestrator.updateSuperPlombierWizzes(100_000);
  orchestrator.update(100_000);
  assert.equal(sentWizzes.length, 0);
  assert.equal(progression.data.flags.superPlombierNextWizzAt, undefined);
  assert.equal(progression.data.dialogues['pixelgirl-smiley-victory'], previousDialogue);
  assert.equal(progression.data.dialogues['pixelgirl-super-plombier-wizz'], undefined);
  assert.equal(orchestrator.isConversationUnlocked('pixelgirl-super-plombier-wizz'), false);
  assert.equal(orchestrator.pixelGirlPostDialogueFinished(), false);
  previousDialogue.finished = true;
  previousDialogue.node = 's8-common-1';
  previousDialogue.cursor = definitions['pixelgirl-smiley-victory'].nodes['s8-common-1'].messages.length;
  previousDialogue.transcript.push({ speaker: 'contact', text: 'bon jreviens :3', receivedAt: 90 });
  progression.data.dialogues['pixelgirl-super-plombier-wizz'] = {
    node: 'ending',
    cursor: definitions['pixelgirl-super-plombier-wizz'].nodes.ending.messages.length,
    finished: true,
    transcript: [{ text: 'allez bisousss :3', receivedAt: 100 }],
  };
  assert.equal(orchestrator.pixelGirlPostDialogueFinished(), true);
  progression.save();
  const restored = new Progression(story, {
    getItem: (key) => context.storage.get(key) ?? null,
    setItem: (key, value) => context.storage.set(key, value),
  });
  let restoredWizzCount = 0;
  const resumed = new NarrativeOrchestrator({
    progression: restored,
    definitions,
    dialogueEvents: { update() {} },
    getContact: () => null,
    prepareContact: () => null,
    showConnectionNotification() {},
    showTurboMessageNotification() {},
    sendWizz: () => {
      restoredWizzCount++;
      return true;
    },
  });
  resumed.updateSuperPlombierWizzes(500_000);
  assert.equal(restored.data.flags.superPlombierPixelCase, 'B');
  assert.equal(restoredWizzCount, 0);
});

test('an old saved Wizz-battle marker and deadline are inert', () => {
  const { progression, orchestrator, sentWizzes } = fixture();
  progression.data.flags.superPlombierPixelCase = 'A';
  progression.data.flags.pixelGirlSuperPlombierPlayerWizzSent = true;
  progression.data.flags.pixelGirlSuperPlombierReplyWizzCount = 0;
  progression.data.flags.pixelGirlSuperPlombierReplyWizzDueAt = 1_600;
  progression.data.dialogues['pixelgirl-super-plombier-wizz'] = {
    node: 'closing',
    cursor: 0,
    finished: false,
    transcript: [{ speaker: 'contact', text: 'BATAILLE DE WIZZ !!!', receivedAt: 1_000 }],
  };

  orchestrator.update(50_000);

  assert.deepEqual(sentWizzes, [], 'loading legacy battle state does not replay NPC Wizzes');
  assert.equal(progression.data.flags.pixelGirlSuperPlombierReplyWizzDueAt, 1_600,
    'legacy saved timing data remains untouched and has no active consumer');
});

test('case B sends exactly three saved reminder Wizzes at 20, 35 and 45 seconds, then stops after a reply', () => {
  const { progression, orchestrator, sentWizzes } = fixture();
  const definition = definitions['pixelgirl-smiley-victory'];
  progression.data.flags.superPlombierPostStarted = true;
  progression.data.flags.superPlombierPixelCase = 'B';
  progression.data.dialogues[definition.id] = {
    revision: definition.revision,
    node: 's1',
    cursor: definition.nodes.s1.messages.length,
    transcript: [{ speaker: 'contact', text: 'attente', receivedAt: 1_000 }],
    finished: false,
  };

  orchestrator.updatePixelGirlReplyReminders(20_999);
  assert.equal(sentWizzes.length, 0);
  orchestrator.updatePixelGirlReplyReminders(21_000);
  assert.equal(progression.data.flags.pixelGirlReplyReminderCount, 1);
  assert.equal(progression.data.flags.pixelGirlReplyReminderDueAt, 36_000);
  orchestrator.updatePixelGirlReplyReminders(36_000);
  assert.equal(progression.data.flags.pixelGirlReplyReminderCount, 2);
  assert.equal(progression.data.flags.pixelGirlReplyReminderDueAt, 46_000);
  orchestrator.updatePixelGirlReplyReminders(46_000);
  orchestrator.updatePixelGirlReplyReminders(100_000);
  assert.equal(progression.data.flags.pixelGirlReplyReminderCount, 3);
  assert.equal(sentWizzes.length, 3);
  assert.equal(progression.data.dialogues[definition.id].transcript.length, 1);
});

test('case B reminder deadlines resume from a save without restarting the sequence', () => {
  const context = fixture();
  const { progression, storage, sentWizzes } = context;
  const definition = definitions['pixelgirl-smiley-victory'];
  progression.data.flags.superPlombierPostStarted = true;
  progression.data.flags.superPlombierPixelCase = 'B';
  progression.data.dialogues[definition.id] = {
    revision: definition.revision,
    node: 's1',
    cursor: definition.nodes.s1.messages.length,
    transcript: [{ speaker: 'contact', text: 'attente', receivedAt: 1_000 }],
    finished: false,
  };
  context.orchestrator.updatePixelGirlReplyReminders(21_000);
  assert.equal(sentWizzes.length, 1);
  const restored = new Progression(story, {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  });
  const resumedWizzes = [];
  const resumed = new NarrativeOrchestrator({
    progression: restored,
    definitions,
    dialogueEvents: { update() {} },
    getContact: (id) => ({ id }),
    prepareContact: () => null,
    showConnectionNotification() {},
    showTurboMessageNotification() {},
    sendWizz: (...args) => { resumedWizzes.push(args); return true; },
  });
  assert.equal(restored.data.flags.pixelGirlReplyReminderCount, 1);
  assert.equal(restored.data.flags.pixelGirlReplyReminderDueAt, 36_000);
  resumed.updatePixelGirlReplyReminders(35_999);
  assert.equal(resumedWizzes.length, 0);
  resumed.updatePixelGirlReplyReminders(36_000);
  assert.equal(resumedWizzes.length, 1);
  assert.equal(restored.data.flags.pixelGirlReplyReminderCount, 2);
});

test('a player reply cancels remaining case B reminder Wizzes without rearming at the next choice', () => {
  const { progression, orchestrator, sentWizzes } = fixture();
  const definition = definitions['pixelgirl-smiley-victory'];
  progression.data.flags.superPlombierPostStarted = true;
  progression.data.flags.superPlombierPixelCase = 'B';
  progression.data.dialogues[definition.id] = {
    revision: definition.revision,
    node: 's1',
    cursor: definition.nodes.s1.messages.length,
    transcript: [{ speaker: 'contact', text: 'attente', receivedAt: 1_000 }],
    finished: false,
  };
  orchestrator.updatePixelGirlReplyReminders(21_000);
  assert.equal(sentWizzes.length, 1);
  orchestrator.onChoiceValidated(definition, { nodeId: 's1' });
  assert.equal(progression.data.flags.pixelGirlReplyReminderDueAt, undefined);
  assert.equal(progression.data.flags.pixelGirlReplyReminderStopped, true);
  progression.data.dialogues[definition.id].node = 's2';
  progression.data.dialogues[definition.id].cursor = definition.nodes.s2.messages.length;
  progression.data.dialogues[definition.id].transcript.push({ speaker: 'contact', text: 'nouvelle question', receivedAt: 50_000 });
  orchestrator.updatePixelGirlReplyReminders(100_000);
  assert.equal(sentWizzes.length, 1);
});

test('case B starts the humor Wizz sequence 20 seconds after the initial PixelGirl dialogue ends', () => {
  const { progression, orchestrator, sentWizzes } = fixture();
  progression.data.flags.superPlombierPostStarted = true;
  progression.data.flags.superPlombierPixelCase = 'B';
  progression.data.dialogues['pixelgirl-smiley-victory'] = {
    node: 's8-common-1',
    cursor: definitions['pixelgirl-smiley-victory'].nodes['s8-common-1'].messages.length,
    finished: true,
    transcript: [{ text: 'bon jreviens :3', receivedAt: 50_000 }],
  };
  orchestrator.updateSuperPlombierWizzes(69_999);
  assert.equal(sentWizzes.length, 0);
  orchestrator.updateSuperPlombierWizzes(70_000);
  assert.equal(sentWizzes.length, 1);
  assert.equal(progression.data.flags.superPlombierWizzCount, 1);
  assert.equal(progression.data.flags.superPlombierNextWizzAt, 80_000);
});

test('PixelGirl Wizz dialogue preserves its three opening choices and completes all closing choices', () => {
  const definition = definitions['pixelgirl-super-plombier-wizz'];
  validateDialogue(definition);
  assert.deepEqual(definition.nodes.opening.messages.map((message) => message.text), [
    'WIZZZZZZZ',
    'hihihihi xD',
  ]);
  assert.deepEqual(definition.nodes.opening.choices.map((choice) => choice.text), [
    'MAIS ARRETE MDR',
    'quoiiiii',
    '*wizz*',
  ]);
  assert.equal(definition.nodes.opening.choices.find((choice) => choice.id === 'wizz').action, 'wizz');

  for (const [branchIndex, openingChoice] of definition.nodes.opening.choices.entries()) {
    const { progression, orchestrator, sentWizzes } = fixture();
    progression.data.flags.superPlombierPixelCase = 'A';
    const session = new DialogueSession(definition, progression);
    session.deliver();
    session.deliver();
    session.choose(openingChoice.id);
    orchestrator.onChoiceValidated(definition, { nodeId: definition.start, choice: openingChoice });
    orchestrator.onChoiceValidated(definition, { nodeId: definition.start, choice: openingChoice });

    while (session.state.node !== 'closing') {
      if (session.nextMessage()) session.deliver();
      else assert.equal(session.advance(), true);
    }
    if (openingChoice.id === 'wizz') {
      assert.deepEqual(sentWizzes.map(([, eventId, speaker]) => [eventId, speaker]), [
        ['pixelgirl-super-plombier-player-wizz', 'player'],
      ]);
      assert.ok(session.state.transcript.some((message) => message.text === 'quoi, tu veux encore des wizz ??'));
      session.persist();
      orchestrator.update(20_000);
      assert.equal(sentWizzes.length, 1, 'the current dialogue does not start the removed Wizz battle');
      assert.equal(
        session.state.transcript.some((message) => /bataille de wizz/i.test(message.text)),
        false,
        'no removed battle line is present in the current dialogue',
      );
    } else {
      assert.deepEqual(sentWizzes, []);
    }

    while (session.nextMessage()) session.deliver();
    assert.deepEqual(session.choices.map((choice) => choice.text), [
      'merci ptdr',
      "j'y crois pas une seconde",
      'dommage je commen\u00e7ais \u00e0 aimer',
    ]);
    session.choose(session.choices[branchIndex].id);
    while (!session.state.finished) {
      if (session.nextMessage()) session.deliver();
      else session.advance();
    }
    assert.equal(session.state.transcript.at(-1).text, 'allez bisousss :3');
    assert.equal(session.state.finished, true);
    assert.equal(
      session.state.transcript.some((message) => message.text === 'fallait r\u00e9pondre aussi xD'),
      false,
    );
    const countAtEnd = sentWizzes.length;
    orchestrator.update(100_000);
    assert.equal(sentWizzes.length, countAtEnd);
  }
});

test('a structured Wizz action in another conversation routes through the shared Messenger Wizz path', () => {
  const { orchestrator, sentWizzes } = fixture();
  orchestrator.onChoiceValidated(
    { id: 'future-conversation', start: 'question', contact: { id: 'turbo' } },
    { nodeId: 'question', choice: { id: 'buzz', action: 'wizz' } },
  );
  assert.deepEqual(sentWizzes, [[
    'turbo',
    'future-conversation-question-player-wizz',
    'player',
    1000,
  ]]);
});

test('PixelGirl Wizz action keeps its narrative branch and sends one Wizz event', () => {
  const { progression, orchestrator, sentWizzes } = fixture();
  const definition = definitions['pixelgirl-super-plombier-wizz'];
  progression.data.flags.superPlombierPixelCase = 'A';
  const session = new DialogueSession(definition, progression);
  session.deliver();
  session.deliver();
  const choice = session.choices.find((item) => item.action === 'wizz');
  assert.ok(choice);
  session.choose(choice.id);
  orchestrator.onChoiceValidated(definition, { nodeId: definition.start, choice });
  orchestrator.onChoiceValidated(definition, { nodeId: definition.start, choice });
  assert.deepEqual(sentWizzes.map(([, id, speaker]) => [id, speaker]), [
    ['pixelgirl-super-plombier-player-wizz', 'player'],
  ]);
  assert.equal(session.state.node, 'wizz-reply');
  assert.equal(session.state.transcript.at(-1).text, choice.text);
  session.deliver();
  assert.equal(session.state.transcript.at(-1).text, 'quoi, tu veux encore des wizz ??');
  assert.equal(session.advance(), true);
  assert.equal(session.state.node, 'closing');
});

test('Wizz dialogue migration preserves an in-progress save and leaves completed saves finished', () => {
  const definition = definitions['pixelgirl-super-plombier-wizz'];
  const context = fixture();
  const { progression } = context;
  const oldMessages = ['WIZZZZZ', "t'es mort ou quoi xD"];
  progression.data.dialogues[definition.id] = {
    revision: 1,
    node: 'opening',
    cursor: 2,
    transcript: oldMessages.map((text, index) => ({
      speaker: 'contact',
      text,
      receivedAt: index + 1,
    })),
    finished: false,
  };
  progression.data.conversations.pixelgirl = {
    version: 1,
    history: oldMessages.map((text, index) => ({
      speaker: 'contact',
      text,
      key: `${definition.id}:1:${index}`,
    })),
    unread: [`${definition.id}:1:1`],
    activeEvent: definition.id,
    pendingEvents: [],
  };
  new NarrativeOrchestrator({
    progression,
    definitions,
    dialogueEvents: { update() {} },
    getContact: () => null,
    prepareContact: () => null,
    showConnectionNotification() {},
    showTurboMessageNotification() {},
  });
  assert.equal(progression.data.dialogues[definition.id].revision, 2);
  assert.equal(progression.data.dialogues[definition.id].cursor, 2);
  assert.deepEqual(
    new DialogueSession(definition, progression).choices.map((choice) => choice.id),
    ['stop', 'what', 'wizz'],
  );
  assert.deepEqual(progression.data.conversations.pixelgirl.unread, [`${definition.id}:2:1`]);
  assert.ok(progression.data.dialogueArchives[`${definition.id}:1`]);

  const finishedContext = fixture();
  finishedContext.progression.data.dialogues[definition.id] = {
    revision: 1,
    node: 'stop-reply',
    cursor: 2,
    transcript: [{ speaker: 'contact', text: 'ancien dernier message', receivedAt: 3 }],
    finished: true,
  };
  new NarrativeOrchestrator({
    progression: finishedContext.progression,
    definitions,
    dialogueEvents: { update() {} },
    getContact: () => null,
    prepareContact: () => null,
    showConnectionNotification() {},
    showTurboMessageNotification() {},
  });
  assert.equal(finishedContext.progression.data.dialogues[definition.id].revision, 1);
  assert.equal(finishedContext.progression.data.dialogues[definition.id].finished, true);
});

test('K7 waits for both private chats while the group clock is independent of K7 replies', () => {
  const context = fixture();
  const { progression, orchestrator, notifications } = context;
  let scheduled = 0;
  let received = 0;
  context.setGroupThread({
    state: { history: [] },
    schedule() {
      scheduled++;
      progression.data.dialogues['pixelgirl-super-plombier-group'] = {
        transcript: [],
        receiveDueAt: 158_800,
      };
    },
    receive() {
      received++;
    },
  });
  progression.data.flags.superPlombierPostStarted = true;
  progression.data.flags.superPlombierPixelCase = 'A';
  progression.data.flags.superPlombierTurboMigratedFinishAt = 500_000;
  progression.data.flags.superPlombierGroupRestDueAt = 158_000;
  progression.data.dialogues['turbo-super-plombier'] = {
    node: 'last-goodbye',
    cursor: definitions['turbo-super-plombier'].nodes['last-goodbye'].messages.length,
    finished: true,
    transcript: [{ text: 'allez a+', receivedAt: 4_000 }],
  };
  progression.data.dialogues['pixelgirl-smiley-victory'] = {
    node: 's8-common-1',
    cursor: definitions['pixelgirl-smiley-victory'].nodes['s8-common-1'].messages.length,
    finished: true,
    transcript: [{ text: 'bon jreviens :3', receivedAt: 6_000 }],
  };
  progression.data.dialogues['pixelgirl-super-plombier-wizz'] = {
    node: 'ending',
    cursor: definitions['pixelgirl-super-plombier-wizz'].nodes.ending.messages.length,
    finished: false,
    transcript: [{ receivedAt: 5_000 }],
  };
  orchestrator.updateGroup(10_000);
  assert.equal(progression.data.flags.k7IntroductionStarted, undefined);
  assert.equal(progression.data.contactConnections.k7, undefined);
  progression.data.dialogues['pixelgirl-super-plombier-wizz'].finished = true;
  progression.data.dialogues['pixelgirl-super-plombier-wizz'].transcript.push({ text: 'allez bisousss :3', receivedAt: 8_000 });
  orchestrator.updateGroup(10_000);
  assert.equal(progression.data.flags.k7IntroductionStarted, true);
  assert.equal(progression.data.contactConnections.k7.dueAt, 20_000);
  assert.equal(progression.data.flags.superPlombierGroupRestDueAt, 50_000);
  progression.data.dialogues['k7-intro'] = {
    node: 'good-luck-reply',
    cursor: definitions['k7-intro'].nodes['good-luck-reply'].messages.length,
    finished: true,
    transcript: [{ speaker: 'contact', text: 'merci jvais en avoir besoin', receivedAt: 10_000 }],
  };
  orchestrator.updateGroup(10_000);
  assert.equal(progression.data.flags.superPlombierGroupRestDueAt, 50_000);
  orchestrator.updateGroup(49_999);
  assert.equal(progression.data.flags.superPlombierGroupCreated, undefined);
  orchestrator.updateGroup(50_000);
  orchestrator.updateGroup(50_001);
  assert.equal(progression.data.flags.superPlombierGroupCreated, true);
  assert.equal(scheduled, 1);
  assert.equal(received, 2);
  assert.deepEqual(notifications, ['plumber-group']);
});

test('group message callbacks fire only when a new group event is received', () => {
  const context = fixture();
  const { progression, orchestrator, groupMessages } = context;
  progression.data.flags.superPlombierPostStarted = true;
  progression.data.flags.superPlombierGroupCreated = true;
  progression.data.flags.superPlombierGroupNotified = true;
  progression.data.dialogues['pixelgirl-super-plombier-group'] = {
    transcript: [{ speaker: 'contact', text: 'message déjà reçu' }],
  };
  let incoming = [];
  context.setGroupThread({
    state: { history: [] },
    receive: () => incoming,
  });

  orchestrator.updateGroup(1000);
  assert.deepEqual(groupMessages, []);
  incoming = [{ id: 'pixelgirl-super-plombier-group' }];
  orchestrator.updateGroup(2000);
  assert.deepEqual(groupMessages, [['plumber-group', 'pixelgirl-super-plombier-group']]);
  incoming = [];
  orchestrator.updateGroup(3000);
  assert.equal(groupMessages.length, 1);
});

test('legacy transcript timestamps do not cause K7 or group deadlines to fire immediately', () => {
  const { progression, orchestrator } = fixture();
  progression.data.flags.superPlombierPostStarted = true;
  progression.data.flags.superPlombierPixelCase = 'B';
  progression.data.flags.superPlombierTurboMigratedFinishAt = 900_000;
  progression.data.dialogues['turbo-super-plombier'] = {
    node: 'last-goodbye',
    cursor: definitions['turbo-super-plombier'].nodes['last-goodbye'].messages.length,
    finished: true,
    transcript: [
      { speaker: 'contact', text: 'MDRRRRRR', receivedAt: 100_000 },
      { speaker: 'contact', text: 'allez a+', receivedAt: 200_000 },
    ],
  };
  progression.data.dialogues['pixelgirl-smiley-victory'] = {
    node: 's8-common-1',
    cursor: definitions['pixelgirl-smiley-victory'].nodes['s8-common-1'].messages.length,
    finished: true,
    transcript: [{ text: 'bon jreviens :3', receivedAt: 205_000 }],
  };
  progression.data.dialogues['pixelgirl-super-plombier-wizz'] = {
    node: 'ending',
    cursor: definitions['pixelgirl-super-plombier-wizz'].nodes.ending.messages.length,
    finished: true,
    transcript: [{ text: 'allez bisousss :3', receivedAt: 210_000 }],
  };
  orchestrator.updateGroup(210_000);
  assert.equal(progression.data.contactConnections.k7.dueAt, 220_000);
  assert.equal(progression.data.flags.superPlombierGroupRestDueAt, 250_000);
  progression.data.dialogues['k7-intro'] = {
    node: 'good-luck-reply',
    cursor: definitions['k7-intro'].nodes['good-luck-reply'].messages.length,
    finished: true,
    transcript: [{ speaker: 'contact', text: 'merci jvais en avoir besoin', receivedAt: 220_000 }],
  };
  orchestrator.updateGroup(220_000);
  assert.equal(progression.data.flags.superPlombierGroupRestDueAt, 250_000);
  orchestrator.updateGroup(249_999);
  assert.equal(progression.data.flags.superPlombierGroupCreated, undefined);
  orchestrator.updateGroup(250_000);
  assert.equal(progression.data.flags.superPlombierGroupCreated, true);
  progression.data.flags.superPlombierGroupRestDueAt = 999_000;
  progression.data.flags.superPlombierGroupCreatedAt = 270_000;
  orchestrator.updateGroup(500_000);
  assert.equal(progression.data.flags.superPlombierGroupRestDueAt, 999_000);
  assert.equal(progression.data.flags.superPlombierGroupCreatedAt, 270_000);
});

test('both private completions start K7 once and the T+40 group deadline survives reload', () => {
  for (const order of ['turbo-first', 'pixelgirl-first']) {
    const context = fixture();
    const { progression, orchestrator, storage } = context;
    progression.data.flags.superPlombierPostStarted = true;
    progression.data.flags.superPlombierPixelCase = order === 'turbo-first' ? 'A' : 'B';
    progression.data.dialogues['pixelgirl-smiley-victory'] = {
      revision: definitions['pixelgirl-smiley-victory'].revision,
      node: 's8-common-1',
      cursor: 1,
      finished: order === 'pixelgirl-first',
      transcript: [{ speaker: 'contact', text: order === 'pixelgirl-first' ? 'bon jreviens :3' : 'en cours', receivedAt: 10_000 }],
    };
    progression.data.dialogues['pixelgirl-super-plombier-wizz'] = {
      revision: definitions['pixelgirl-super-plombier-wizz'].revision,
      node: 'ending',
      cursor: 2,
      finished: order === 'pixelgirl-first',
      transcript: [{ speaker: 'contact', text: order === 'pixelgirl-first' ? 'allez bisousss :3' : 'en cours', receivedAt: 10_000 }],
    };
    progression.data.dialogues['turbo-super-plombier'] = {
      revision: definitions['turbo-super-plombier'].revision,
      node: 'last-goodbye',
      cursor: 1,
      finished: order === 'turbo-first',
      transcript: [{ speaker: 'contact', text: order === 'turbo-first' ? 'allez a+' : 'en cours', receivedAt: 20_000 }],
    };
    orchestrator.updateGroup(20_000);
    assert.equal(progression.data.flags.k7IntroductionStarted, undefined, 'one completed private chat is insufficient');
    assert.equal(progression.data.contactConnections.k7, undefined);
    progression.data.dialogues['pixelgirl-smiley-victory'].finished = true;
    progression.data.dialogues['pixelgirl-smiley-victory'].transcript.at(-1).text = 'bon jreviens :3';
    progression.data.dialogues['pixelgirl-super-plombier-wizz'].finished = true;
    progression.data.dialogues['pixelgirl-super-plombier-wizz'].transcript.at(-1).text = 'allez bisousss :3';
    progression.data.dialogues['turbo-super-plombier'].finished = true;
    progression.data.dialogues['turbo-super-plombier'].transcript.at(-1).text = 'allez a+';
    orchestrator.updateGroup(40_000);
    const t0 = 40_000;
    const groupDueAt = t0 + 40_000;
    assert.equal(progression.data.flags.k7IntroductionStarted, true);
    assert.equal(progression.data.contactConnections.k7.dueAt, t0 + 10_000);
    assert.equal(progression.data.flags.superPlombierGroupRestDueAt, groupDueAt);

    orchestrator.updateGroup(45_000);
    assert.equal(progression.data.flags.superPlombierGroupRestDueAt, groupDueAt);
    progression.data.dialogues['k7-intro'] = {
      node: 'good-luck-reply',
      cursor: definitions['k7-intro'].nodes['good-luck-reply'].messages.length,
      finished: true,
      transcript: [{ speaker: 'contact', text: 'merci jvais en avoir besoin', receivedAt: 50_000 }],
    };
    orchestrator.updateGroup(50_000);
    assert.equal(progression.data.flags.superPlombierGroupRestDueAt, groupDueAt);
    progression.save();

    const restored = new Progression(story, {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    });
    let scheduled = 0;
    const resumed = new NarrativeOrchestrator({
      progression: restored,
      definitions,
      dialogueEvents: { update() {} },
      getContact: () => ({ id: 'plumber-group' }),
      prepareContact: () => null,
      showConnectionNotification() {},
      showTurboMessageNotification() {},
      getGroupThread: () => ({
        state: { history: [] },
        schedule() {
          scheduled++;
          restored.data.dialogues['pixelgirl-super-plombier-group'] = { receiveDueAt: 200_000 };
        },
        receive() {},
      }),
      showGroupNotification: () => true,
      now: () => 55_000,
    });
    resumed.updateGroup(55_000);
    assert.equal(restored.data.flags.superPlombierGroupRestDueAt, groupDueAt);
    resumed.updateGroup(groupDueAt - 1);
    assert.equal(restored.data.flags.superPlombierGroupCreated, undefined);
    resumed.updateGroup(groupDueAt);
    resumed.updateGroup(groupDueAt + 1);
    assert.equal(restored.data.flags.superPlombierGroupCreated, true);
    assert.equal(scheduled, 1);
  }
});

test('group dialogue keeps its original opening, persists each choice path, and converges at the quiet ending', () => {
  const definition = definitions['pixelgirl-super-plombier-group'];
  validateDialogue(definition);
  const originalOpening = [
    'COUCOUUUUUUU', '???', 'salut :)', 'voila maintenant vous etes tous la :D',
    'pk tu fais un groupe mdr', 'parce que jai envie xD', 'argument imparable', 'ptdrrrr',
  ];
  const selectedOpeningChoices = [
    ['on peut juste discuter non ?', 'des mains à la place des pieds', 'vous êtes vraiment débiles mdr'],
    ['on peut jouer à un truc', 'des pieds à la place des mains', 'moi je suis du côté de luna'],
    ["c'est toi qui nous as réunis mdr", 'je préfère garder mon corps actuel merci', 'SI'],
  ];
  const branchMessages = [
    ['merci captain obvious', 'MAIS VOUS ETES TOUS OBSEDES PAR LES MAINS'],
    ['evidemment que tu veux jouer toi', 'imagine jouer a la souris avec un pied'],
    ['MAIS ARRETEZ DE ME JUGER', 'MAIS LUNAAAA'],
  ];

  for (let path = 0; path < 3; path++) {
    const { progression } = fixture();
    const thread = new ConversationThread('plumber-group', progression, () => [definition]);
    const session = new DialogueSession(definition, progression);
    const choices = selectedOpeningChoices[path];
    let choiceIndex = 0;
    while (!session.state.finished) {
      const message = session.nextMessage();
      if (message) {
        session.deliver();
        continue;
      }
      if (session.choices.length) {
        session.offerChoices();
        const offered = session.choices;
        const targetText = choices[choiceIndex++];
        const selected = offered.find((choice) => choice.text === targetText);
        assert.ok(selected, `Missing ${targetText}; offered: ${offered.map(({ text }) => text).join(' | ')}`);
        session.choose(selected.id);
        continue;
      }
      if (session.node.transfer && session.activeTransfer?.status === 'pending') {
        progression.finishTransfer(session.activeTransfer.key);
        continue;
      }
      if (!session.advance()) break;
    }
    thread.sync();
    assert.equal(session.state.finished, true);
    assert.equal(choiceIndex, 3);
    assert.deepEqual(session.state.transcript.slice(0, 8).map(({ text }) => text), originalOpening);
    assert.ok(session.state.transcript.some(({ text }) => text === branchMessages[path][0]));
    assert.ok(session.state.transcript.some(({ text }) => text === branchMessages[path][1]));
    assert.ok(session.state.transcript.some(({ text }) => text === [
      'on fait de notre mieux :D', 'TRAHISON', 'PTDRRRRRRRRRRR',
    ][path]));
    assert.equal(session.state.transcript.at(-1).text, 'laisse-lui le temps');
    const downloadInstructions = 'voilààà cliquez pour télécharger :3 !! oubliez pas de l\'extraire';
    const fileIndex = session.state.transcript.findIndex((entry) => entry.type === 'file');
    const instructionsIndex = session.state.transcript.findIndex((entry) => entry.text === downloadInstructions);
    assert.equal(session.state.transcript[fileIndex].text, 'BombArena.zip');
    assert.equal(session.state.transcript.filter((entry) => entry.text === downloadInstructions).length, 1);
    assert.ok(fileIndex < instructionsIndex, 'the instructions follow the first archive offer');
    assert.equal(
      session.state.transcript.some((entry) => entry.text === "extrais le avec clique droit depuis tes documents, ça devrait être dans mes fichiers reçus !!!"),
      false,
    );
    assert.equal(session.state.transcript.some((entry) => entry.text === "ehhhh j'ai une idée :3"), false);
    assert.deepEqual(
      session.state.transcript.filter(({ speaker }) => speaker === 'player').map(({ text }) => text),
      choices,
    );
    assert.equal(thread.state.history.length, session.state.transcript.length);

    const restored = new ConversationThread('plumber-group', progression, () => [definition]);
    restored.sync();
    assert.equal(restored.state.history.length, session.state.transcript.length);
  }
});

test('each explicit Bomb Arena refusal schedules exactly one persisted reoffer without a retry limit', () => {
  const { progression, orchestrator, store, setGroupThread } = fixture();
  const definition = definitions['pixelgirl-super-plombier-group'];
  const thread = new ConversationThread('plumber-group', progression, () => [
    definition,
    ...orchestrator.bombArenaRedownloadEvents(),
  ]);
  setGroupThread(thread);
  const session = new DialogueSession(definition, progression);
  session.state.node = 'bomb-arena-transfer';
  session.persist();
  session.deliver();
  session.deliver();
  const firstTransfer = session.activeTransfer;
  assert.equal(firstTransfer.transferState, 'proposed');
  assert.equal(session.declineTransfer(firstTransfer.key), true);
  assert.equal(firstTransfer.transferState, 'declined');
  assert.equal(orchestrator.onBombArenaTransferDeclined(firstTransfer, definition.id), true);
  assert.equal(orchestrator.onBombArenaTransferDeclined(firstTransfer, definition.id), false);
  assert.equal(session.advance(), true);
  assert.equal(session.advance(), false);
  assert.equal(session.state.finished, true);
  assert.equal(session.state.node, 'bomb-arena-transfer-refused');

  let now = 20_000;
  for (let refusal = 1; refusal <= 10; refusal++) {
    const event = orchestrator.bombArenaRedownloadEvents()[refusal - 1];
    assert.equal(event.id, `bomb-arena-redownload-${refusal}`);
    const offer = new DialogueSession(event, progression);
    for (let update = 0; update < 10 && !offer.activeTransfer; update++) {
      const dueAt = progression.data.dialogues[event.id]?.receiveDueAt;
      now = Math.max(now + 1, Number.isFinite(dueAt) ? dueAt : now + 1);
      thread.receive(now);
    }
    assert.equal(offer.state.transcript.filter((entry) => entry.text === 'tiens tu peux le télécharger').length, 1);
    const transfer = offer.activeTransfer;
    assert.ok(transfer, `offer ${refusal} is awaiting a player action`);
    assert.notEqual(transfer.key, firstTransfer.key);
    assert.equal(offer.declineTransfer(transfer.key), true);
    assert.equal(orchestrator.onBombArenaTransferDeclined(transfer, event.id), true);
    assert.equal(orchestrator.onBombArenaTransferDeclined(transfer, event.id), false);
    now += 10_000;
  }
  assert.equal(orchestrator.bombArenaRedownloadEvents().length, 11);
  assert.deepEqual(
    orchestrator.bombArenaRedownloadEvents().map((event) => event.id),
    Array.from({ length: 11 }, (_, index) => `bomb-arena-redownload-${index + 1}`),
  );
  assert.equal(
    Object.values(progression.data.dialogues).filter((state) =>
      state.transcript?.some((entry) => entry.text === 'tiens tu peux le télécharger'),
    ).length,
    10,
  );
  const saved = new Progression(story, store);
  assert.equal(saved.data.flags[`bombArenaRefusalReoffer:${firstTransfer.key}`], true);
  assert.equal(Object.keys(saved.data.flags).filter((key) => key.startsWith('bombArenaRefusalReoffer:')).length, 11);
});

test('Bomb Arena re-download waits for the last manual deletion, uses new saved transfers, and ignores system cleanup', () => {
  const { progression, orchestrator, virtualFilesystem, setGroupThread, store } = fixture();
  const group = definitions['pixelgirl-super-plombier-group'];
  const thread = new ConversationThread('plumber-group', progression, () => [
    group,
    ...orchestrator.bombArenaRedownloadEvents(),
  ]);
  setGroupThread(thread);
  const zipId = virtualFileId('downloads', 'BombArena.zip');
  const folderId = virtualFileId('downloads', 'BombArena');
  const exeId = virtualFileId('bomb-arena-folder', 'BombArena.exe');
  const original = progression.receiveFile({
    id: 'bomb-arena', name: 'BombArena.zip', sizeLabel: '18 Mo', size: 18 * 1024 * 1024,
    description: 'Archive ZIP', deletable: true, extractable: 'bomb-arena', reusableAfterDelete: true,
  }, group.id, 'bomb-arena-transfer');
  progression.finishTransfer(original.key);
  assert.equal(virtualFilesystem.extractBombArena(zipId).ok, true);

  assert.equal(virtualFilesystem.deleteFile(zipId).ok, true);
  assert.deepEqual(orchestrator.bombArenaRedownloadEvents(), [], 'the EXE remains usable');
  assert.equal(orchestrator.onVirtualFilesDeleted({ origin: 'system', removedFileIds: [exeId] }), false);
  assert.deepEqual(orchestrator.bombArenaRedownloadEvents(), []);

  const removedFolder = virtualFilesystem.deleteFile(folderId);
  assert.deepEqual(removedFolder.removedFileIds, [folderId, exeId]);
  const [firstOffer] = orchestrator.bombArenaRedownloadEvents();
  assert.equal(firstOffer.id, 'bomb-arena-redownload-1');
  assert.equal(progression.data.dialogues[firstOffer.id].transcript.length, 0);
  assert.equal(Number.isFinite(progression.data.dialogues[firstOffer.id].receiveDueAt), true);
  assert.equal(orchestrator.onVirtualFilesDeleted(removedFolder), false, 'one folder deletion creates one proposal');

  thread.receive(1_850);
  assert.equal(progression.data.dialogues[firstOffer.id].transcript[0].text, 'tiens tu peux le télécharger');
  thread.receive(2_500);
  const offerState = progression.data.dialogues[firstOffer.id];
  const offerSession = new DialogueSession(firstOffer, progression);
  assert.equal(offerState.transcript[1].text, 'BombArena.zip');
  assert.equal(offerSession.activeTransfer.status, 'pending', 'the message does not accept its own transfer');
  const offerHistoryLength = thread.state.history.length;

  const reloaded = new Progression(story, store);
  const reloadedFilesystem = new VirtualFilesystem(reloaded);
  let reloadedThread;
  const reloadedOrchestrator = new NarrativeOrchestrator({
    progression: reloaded,
    definitions,
    dialogueEvents: { update() {}, triggerConnection() {} },
    getContact: () => null,
    prepareContact: () => null,
    showConnectionNotification() {},
    virtualFilesystem: reloadedFilesystem,
    getGroupThread: () => reloadedThread,
  });
  reloadedThread = new ConversationThread('plumber-group', reloaded, () => [
    group,
    ...reloadedOrchestrator.bombArenaRedownloadEvents(),
  ]);
  const reloadedOffer = reloadedOrchestrator.bombArenaRedownloadEvents()[0];
  reloadedThread.sync();
  assert.equal(reloaded.data.dialogues[reloadedOffer.id].transcript[0].text, 'tiens tu peux le télécharger');
  assert.equal(reloaded.data.dialogues[reloadedOffer.id].transcript.filter((entry) => entry.text === 'tiens tu peux le télécharger').length, 1);
  assert.equal(new DialogueSession(reloadedOffer, reloaded).activeTransfer.status, 'pending');

  progression.finishTransfer(offerSession.activeTransfer.key);
  offerSession.advance();
  offerSession.advance();
  thread.sync();
  assert.equal(offerSession.state.finished, true);
  assert.equal(thread.state.history.length, offerHistoryLength, 'finishing the transfer adds no duplicate chat rows');
  assert.equal(virtualFilesystem.exists(zipId), true);
  assert.equal(virtualFilesystem.extractBombArena(zipId).ok, true);
  assert.equal(virtualFilesystem.extractBombArena(zipId).existing, true, 'duplicate extraction does not add another EXE');

  virtualFilesystem.deleteFile(folderId);
  assert.deepEqual(orchestrator.bombArenaRedownloadEvents().map((event) => event.id), ['bomb-arena-redownload-1']);
  virtualFilesystem.deleteFile(zipId);
  assert.deepEqual(
    orchestrator.bombArenaRedownloadEvents().map((event) => event.id),
    ['bomb-arena-redownload-1', 'bomb-arena-redownload-2'],
  );
  assert.equal(virtualFilesystem.exists(zipId), false);
});

test('deleting BombArena after the completed mandatory session never reopens an old download offer', () => {
  const { progression, orchestrator, virtualFilesystem, setGroupThread, store } = fixture();
  const group = definitions['pixelgirl-super-plombier-group'];
  const thread = new ConversationThread('plumber-group', progression, () => [
    group,
    ...orchestrator.bombArenaRedownloadEvents(),
  ]);
  setGroupThread(thread);
  orchestrator.onBombArenaEvent({ type: 'expected' });
  orchestrator.onBombArenaEvent({ type: 'match-started', difficulty: 'PRO' });
  for (let round = 1; round <= 8; round++) {
    assert.equal(orchestrator.onBombArenaEvent({
      type: 'round-completed', round, winnerId: 'justme',
      scores: { justme: round, pixelgirl: 0, turbo: 0, luna: 0 },
    }), true);
  }
  assert.equal(orchestrator.onBombArenaEvent({
    type: 'match-completed', matchId: 'deleted-after-victory', difficulty: 'PGM',
    winnerId: 'justme', roundsPlayed: 8,
    scores: { justme: 8, pixelgirl: 0, turbo: 0, luna: 0 },
  }), true);
  assert.equal(progression.data.bombArena.status, 'RESULTS_READY');
  assert.equal(orchestrator.onBombArenaEvent({ type: 'returned-to-messenger' }), true);
  assert.equal(orchestrator.bombArenaPostMatchAvailable(), true);
  const postmatch = new DialogueSession(definitions['bomb-arena-postmatch'], progression);
  while (!postmatch.state.finished) {
    if (postmatch.nextMessage()) postmatch.deliver();
    else postmatch.advance();
  }

  const zipId = virtualFileId('downloads', 'BombArena.zip');
  const exeId = virtualFileId('bomb-arena-folder', 'BombArena.exe');
  const archive = progression.receiveFile({
    id: 'bomb-arena', name: 'BombArena.zip', sizeLabel: '18 Mo', size: 18 * 1024 * 1024,
    description: 'Archive ZIP', deletable: true, extractable: 'bomb-arena', reusableAfterDelete: true,
  }, group.id, 'bomb-arena-transfer');
  progression.finishTransfer(archive.key);
  assert.equal(virtualFilesystem.extractBombArena(zipId).ok, true);
  assert.equal(virtualFilesystem.deleteFile(exeId).ok, true);
  assert.equal(virtualFilesystem.deleteFile(zipId).ok, true);
  assert.equal(virtualFilesystem.exists(exeId), false);
  assert.equal(virtualFilesystem.exists(zipId), false);
  assert.deepEqual(orchestrator.bombArenaRedownloadEvents(), []);
  assert.deepEqual(thread.eligibleEvents().map((event) => event.id), [group.id]);
  assert.equal(orchestrator.onBombArenaTransferDeclined({
    extractable: 'bomb-arena', status: 'declined', key: 'old-file',
  }, group.id), false);

  const restored = new Progression(story, store);
  const restoredFilesystem = new VirtualFilesystem(restored);
  const restoredOrchestrator = new NarrativeOrchestrator({
    progression: restored,
    definitions,
    dialogueEvents: { update() {}, triggerConnection() {} },
    getContact: () => null,
    prepareContact() {},
    showConnectionNotification() {},
    virtualFilesystem: restoredFilesystem,
  });
  assert.equal(restored.data.dialogues['bomb-arena-postmatch'].finished, true);
  assert.equal(restored.data.bombArena.status, 'COMPLETED');
  assert.equal(restored.data.bombArena.sessionWinner, 'justme');
  assert.deepEqual(restoredOrchestrator.bombArenaRedownloadEvents(), []);
});

test('a saved group opening resumes at the new dialogue without replaying its original messages', () => {
  const { progression } = fixture();
  const definition = definitions['pixelgirl-super-plombier-group'];
  const transcript = definition.nodes.opening.messages.map((message, index) => ({
    speaker: message.speaker,
    author: message.author,
    text: message.text,
    receivedAt: 1_000 + index,
  }));
  progression.data.dialogues[definition.id] = {
    node: 'opening', cursor: 8, transcript, finished: true, revision: 1,
  };
  progression.data.conversations['plumber-group'] = {
    version: 1,
    history: transcript.map((message, index) => ({
      ...message,
      key: `${definition.id}:1:${index}`,
      eventId: definition.id,
    })),
    unread: [],
    activeEvent: definition.id,
    pendingEvents: [],
  };

  new NarrativeOrchestrator({
    progression,
    definitions,
    dialogueEvents: { update() {}, triggerConnection() {} },
    getContact: () => null,
    prepareContact: () => null,
    showConnectionNotification() {},
  });

  const saved = progression.data.dialogues[definition.id];
  assert.equal(saved.revision, 5);
  assert.equal(saved.node, 'a');
  assert.equal(saved.cursor, 0);
  assert.equal(saved.finished, false);
  assert.equal(saved.transcript.length, 8);
  assert.deepEqual(
    progression.data.conversations['plumber-group'].history.map(({ key }) => key),
    transcript.map((_, index) => `${definition.id}:5:${index}`),
  );
  assert.ok(progression.data.dialogueArchives[`${definition.id}:1`]);
});

test('a previously completed group save resumes at the appended Bomb Arena introduction', () => {
  const { progression } = fixture();
  const definition = definitions['pixelgirl-super-plombier-group'];
  const transcript = definition.nodes.h.messages.map((message, index) => ({
    speaker: message.speaker,
    author: message.author,
    text: message.text,
    receivedAt: 5_000 + index,
  }));
  progression.data.dialogues[definition.id] = {
    node: 'h', cursor: definition.nodes.h.messages.length, transcript, finished: true, revision: 2,
  };
  progression.data.conversations['plumber-group'] = {
    version: 1,
    history: transcript.map((message, index) => ({
      ...message, key: `${definition.id}:2:${index}`, eventId: definition.id,
    })),
    unread: [], activeEvent: definition.id, pendingEvents: [],
  };
  new NarrativeOrchestrator({
    progression,
    definitions,
    dialogueEvents: { update() {}, triggerConnection() {} },
    getContact: () => null,
    prepareContact: () => null,
    showConnectionNotification() {},
  });
  const saved = progression.data.dialogues[definition.id];
  assert.equal(saved.node, 'bomb-arena-intro');
  assert.equal(saved.cursor, 0);
  assert.equal(saved.finished, false);
  assert.equal(saved.transcript.length, transcript.length);
  assert.equal(progression.data.conversations['plumber-group'].history.length, transcript.length);
});

test('group conversation status keeps the participant list alongside its normal contact profile', () => {
  const status = ConversationWindow.prototype.contactStatus.call(
    { player: { nickname: 'Moi' } },
    definitions['pixelgirl-super-plombier-group'],
  );
  assert.match(status, /xX_PixelGirl_Xx, Turb0/);
  assert.match(status, /Moi/);
  assert.match(status, /En ligne/);
  assert.match(status, /Conversation de groupe/);
});

test('the group avatar is composed from the three existing character avatars', (t) => {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => ({
      tagName: tagName.toUpperCase(),
      attributes: {},
      children: [],
      dataset: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      append(child) { this.children.push(child); },
    }),
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });

  const avatar = createContactAvatar(definitions['pixelgirl-super-plombier-group'].contact);
  assert.equal(avatar.className, 'contact-avatar-composition');
  assert.equal(avatar.attributes.role, 'img');
  assert.deepEqual(avatar.children.map(({ src, dataset }) => [src, dataset.avatar]), [
    ['./avatars/pixelgirl.svg', 'pixelgirl'],
    ['./avatars/turbo.svg', 'turb0'],
    ['./avatars/luna.svg', 'luna'],
  ]);
});

test('group transcript color IDs follow saved authors, while private conversations stay unchanged', (t) => {
  const previous = globalThis.document;
  globalThis.document = {
    createElement: (tagName) => ({
      tagName,
      children: [],
      dataset: {},
      append(...children) { this.children.push(...children); },
      setAttribute() {},
    }),
    createTextNode: (textContent) => ({ textContent }),
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const groupRows = [];
  const groupView = {
    dialogue: definitions['pixelgirl-super-plombier-group'],
    flow: { append: (row) => groupRows.push(row) },
    scrollLatest() {},
  };
  for (const [speaker, author, authorId, label] of [
    ['contact', 'xX_PixelGirl_Xx', 'pixelgirl', 'xX_PixelGirl_Xx dit :'],
    ['contact', 'Turb0', 'turbo', 'Turb0 dit :'],
    ['contact', '°•.LuNa.°•', 'luna', '°•.LuNa.°• dit :'],
    ['player', undefined, 'player', 'Moi dit :'],
  ]) {
    ConversationWindow.prototype.appendMessage.call(groupView, {
      speaker, author, text: 'message de test',
    });
    const row = groupRows.at(-1);
    assert.equal(row.dataset.authorId, authorId);
    assert.equal(row.children[0].textContent, label);
  }
  const privateRows = [];
  ConversationWindow.prototype.appendMessage.call({
    dialogue: definitions['pixelgirl-smiley-victory'],
    flow: { append: (row) => privateRows.push(row) },
    scrollLatest() {},
  }, { speaker: 'contact', author: 'Turb0', text: 'message privé' });
  assert.equal(privateRows[0].dataset.authorId, undefined);

  const styles = readFileSync(new URL('../src/styles-story.css', import.meta.url), 'utf8');
  for (const color of ['#d21883', '#178849', '#7950a0', '#252525'])
    assert.ok(styles.includes(color));
  assert.match(styles, /\.group-conversation \.conversation-message\[data-author-id\] > p/);
  assert.match(styles, /\.group-conversation \.conversation-message\[data-author-id\] > small/);
  assert.match(styles, /\.conversation-message small \{[\s\S]*?color: #8795a5;/);
});

test('Turbo post-game dialogue preserves its opening and all six choice groups converge on the final line', () => {
  const definition = definitions['turbo-super-plombier'];
  validateDialogue(definition);
  const expectedOpenings = new Map([
    ['impossible-record', 'ptdrrrr mauvais perdant'],
    ['struggled', 'HAHAHAHA'],
    ['bad-game', "rage pas parce que t'es nul mdr"],
  ]);
  const choiceNodes = ['challenge', 'bug-found', 'bugs-passion', 'mom', 'friends', 'food'];
  for (const targetNode of choiceNodes) {
    for (const targetChoice of definition.nodes[targetNode].choices) {
      const { progression } = fixture();
      const session = new DialogueSession(definition, progression);
      while (!session.state.finished) {
        if (session.nextMessage()) session.deliver();
        else if (session.choices.length) {
          const choice = session.state.node === targetNode
            ? targetChoice
            : session.choices[0];
          session.choose(choice.id);
        } else session.advance();
      }
      const text = session.state.transcript.map((entry) => entry.text);
      assert.ok(text.includes("alors noob ta fini ? xD"));
      assert.ok(text.includes("bon j'avoue"));
      assert.ok(text.includes("MDRRRRRR"));
      assert.ok(text.includes('allez a+'));
      assert.equal(text.at(-1), 'allez a+');
      assert.ok(!text.includes('ah merde pixelgirl me wizz aussi'));
      assert.ok(!text.includes('elle est relou ptdr'));
      if (targetNode === 'challenge') assert.ok(text.includes(expectedOpenings.get(targetChoice.id)));
      if (targetNode === 'mom' && targetChoice.id === 'age') assert.ok(text.includes('13 ans'));
      assert.equal(progression.data.choices.filter((entry) => entry.dialogue === definition.id).length, 6);
    }
  }
});

test('old saves at the removed PixelGirl lines finish after the common reply without losing history', () => {
  const context = fixture();
  const { progression, storage } = context;
  const previousDefinition = structuredClone(definitions['turbo-super-plombier']);
  previousDefinition.revision = 1;
  delete previousDefinition.nodes.common.end;
  previousDefinition.nodes.common.next = 'pixelgirl-wizz';
  previousDefinition.nodes['pixelgirl-wizz'] = {
    messages: [
      { speaker: 'contact', text: 'ah merde pixelgirl me wizz aussi', delayMs: 0, typingMs: 0 },
      { speaker: 'contact', text: 'elle est relou ptdr', delayMs: 0, typingMs: 0 },
    ],
    end: true,
  };
  const oldSession = new DialogueSession(previousDefinition, progression);
  oldSession.deliver();
  oldSession.choose('bad-game');
  while (oldSession.state.node !== 'pixelgirl-wizz') {
    if (oldSession.nextMessage()) oldSession.deliver();
    else if (oldSession.choices.length) oldSession.choose(oldSession.choices[0].id);
    else oldSession.advance();
  }
  oldSession.deliver();
  const oldThread = new ConversationThread('turbo', progression, () => [previousDefinition]);
  oldThread.sync();
  const oldHistoryLength = oldThread.state.history.length;

  new NarrativeOrchestrator({
    progression,
    definitions,
    dialogueEvents: { update() {} },
    getContact: () => null,
    prepareContact: () => null,
    showConnectionNotification() {},
    showTurboMessageNotification() {},
  });
  const saved = progression.data.dialogues['turbo-super-plombier'];
  assert.equal(saved.revision, 3);
  assert.equal(saved.finished, true);
  assert.ok(saved.transcript.some((message) => message.text === 'ah merde pixelgirl me wizz aussi'));
  assert.ok(progression.data.dialogueArchives['turbo-super-plombier:1']);
  const currentThread = new ConversationThread('turbo', progression, () => [
    definitions['turbo-super-plombier'],
  ]);
  assert.equal(currentThread.state.history.length, oldHistoryLength);
  assert.equal(currentThread.state.history.at(-1).key, `turbo-super-plombier:3:${saved.transcript.length - 1}`);
  assert.equal(new DialogueSession(definitions['turbo-super-plombier'], progression).nextMessage(), null);
  assert.equal(storage.size > 0, true);
});
