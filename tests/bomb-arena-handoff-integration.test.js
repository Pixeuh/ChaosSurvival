import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { DialogueSession } from '../src/story/dialogue.js';
import { NarrativeOrchestrator } from '../src/story/narrative-orchestrator.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { VirtualFilesystem } from '../src/story/virtual-filesystem.js';
import { createGame, drainGameEvents, updateGame } from '../src/minigames/bomb-arena/engine.js';
import { bombArenaHandoffPending, createBombArenaHandoffRetrier, dispatchBombArenaEvent } from '../src/story/bomb-arena-handoff.js';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const story = read('../src/config/story.json');
const group = read('../src/dialogues/pixelgirl-super-plombier-group.json');
const postmatch = read('../src/dialogues/bomb-arena-postmatch.json');
const definitions = Object.fromEntries(readdirSync(new URL('../src/dialogues/', import.meta.url))
  .filter((file) => file.endsWith('.json'))
  .map((file) => { const dialogue = read(`../src/dialogues/${file}`); return [dialogue.id, dialogue]; }));

function createStoryHarness(progression, now = () => Date.now()) {
  let thread;
  const contact = { id: 'plumber-group', available: true, online: true };
  const orchestrator = new NarrativeOrchestrator({
    progression,
    definitions,
    dialogueEvents: {},
    getContact: (id) => id === 'plumber-group' ? contact : null,
    prepareContact: () => null,
    showConnectionNotification() {},
    getGroupThread: () => thread,
    showGroupNotification: () => true,
    onGroupMessage() {},
    now,
  });
  const events = () => [group, ...(orchestrator.bombArenaPostMatchAvailable() ? [postmatch] : [])];
  thread = new ConversationThread('plumber-group', progression, events);
  return { orchestrator, thread, events };
}

function advanceRealBombArenaMatch(orchestrator, reportMatchCompleted = (event) => orchestrator.onBombArenaEvent(event)) {
  const game = createGame({ rng: () => 0.9 });
  orchestrator.onBombArenaEvent({ type: 'match-started', difficulty: game.difficulty });
  for (let round = 1; round <= 8; round++) {
    game.phase = 'playing';
    for (const player of game.players) player.alive = player.id === 'justme';
    updateGame(game, 16);
    for (const event of drainGameEvents(game)) {
      if (event.type === 'round_completed') orchestrator.onBombArenaEvent({
        type: 'round-completed', round: event.round, winnerId: event.playerId, scores: event.scores,
      });
    }
    if (round < 8) {
      game.messageMs = 0;
      updateGame(game, 1);
      drainGameEvents(game);
    }
  }
  assert.equal(game.phase, 'match-end');
  assert.equal(game.round, 8);
  assert.equal(game.matchWinnerId, 'justme');
  assert.equal(reportMatchCompleted({
    type: 'match-completed', matchId: 'shortcut-session-1', difficulty: game.difficulty,
    winnerId: game.matchWinnerId, scores: game.wins, roundsPlayed: game.round,
  }), true);
  return game;
}

test('a tied eight-round result never starts the post-match handoff before a unique tiebreak winner exists', () => {
  const progression = new Progression(story, { getItem: () => null, setItem() {} });
  progression.begin();
  const { orchestrator } = createStoryHarness(progression, () => 100);
  orchestrator.onBombArenaEvent({ type: 'expected' });
  const tiedScores = { justme: 3, pixelgirl: 3, turbo: 1, luna: 1 };
  assert.equal(orchestrator.onBombArenaEvent({
    type: 'match-completed', matchId: 'tied-regulation', difficulty: 'PGM',
    winnerId: 'justme', roundsPlayed: 8, scores: tiedScores,
  }), false, 'a tied score is not a final session result');
  assert.equal(progression.data.bombArena.status, 'NOT_STARTED');
  assert.equal(bombArenaHandoffPending({ data: progression.data }), false);

  assert.equal(orchestrator.onBombArenaEvent({
    type: 'match-completed', matchId: 'unique-overtime', difficulty: 'PGM',
    winnerId: 'pixelgirl', roundsPlayed: 9,
    scores: { justme: 3, pixelgirl: 4, turbo: 1, luna: 1 },
  }), true);
  assert.equal(progression.data.bombArena.status, 'RESULTS_READY');
  assert.equal(progression.data.bombArena.sessionWinner, 'pixelgirl');
  assert.equal(bombArenaHandoffPending(progression), true);
});

test('a saved group-intro checkpoint advances the real offer, retries Messenger, and sends the postmatch branch', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.begin();
  progression.data.flags.keepNormalRun = 'intact';
  let now = Date.now();
  progression.data.flags.superPlombierGroupCreated = true;
  progression.data.flags.superPlombierPostStarted = true;
  progression.data.flags.superPlombierGroupCreatedAt = now;
  progression.data.flags.superPlombierGroupNotified = true;
  progression.data.unlockedConversations = [group.id];
  progression.data.dialogues[group.id] = {
    node: 'bomb-arena-intro', cursor: 0, transcript: [], finished: false,
    revision: group.revision ?? 1,
  };
  progression.save();
  const firstStory = createStoryHarness(progression, () => now);

  // Resume the usual orchestrator from a saved group intro checkpoint.
  firstStory.orchestrator.updateGroup(now);
  now += 60_000;
  firstStory.orchestrator.updateGroup(now);
  assert.equal(progression.data.dialogues[group.id].node, 'bomb-arena-transfer');
  assert.ok(Number.isFinite(progression.data.bombArena.expectedAt), 'the offer arms the mandatory gate');
  assert.equal(progression.data.bombArena.status, 'NOT_STARTED');

  const archive = Object.values(progression.data.files).find((file) => file.extractable === 'bomb-arena');
  assert.ok(archive, 'the shortcut advances the normal narrative to the real ZIP offer');
  assert.equal(progression.acceptTransfer(archive.key), true);
  assert.equal(progression.startTransfer(archive.key, now), true);
  progression.finishTransfer(archive.key);
  const filesystem = new VirtualFilesystem(progression);
  assert.equal(filesystem.extractBombArena('downloads/bombarena.zip').ok, true);
  assert.equal(filesystem.exists('bomb-arena-folder/bombarena.exe'), true);
  const groupSession = new DialogueSession(group, progression);
  assert.equal(groupSession.advance(), true, 'accepted transfer advances the existing group dialogue');
  now += 60_000;
  firstStory.orchestrator.updateGroup(now);
  now += 60_000;
  firstStory.orchestrator.updateGroup(now);
  assert.equal(progression.data.dialogues[group.id].finished, true,
    'the normal group thread finishes its post-transfer messages before match results');

  let firstAttempts = 0;
  let firstTimerCallback;
  const firstRetrier = createBombArenaHandoffRetrier({
    progression,
    onBombArenaEvent: (event) => firstStory.orchestrator.onBombArenaEvent(event),
    activateGroup: () => { firstAttempts++; return false; },
    setTimeoutFn: (callback, delay) => { assert.equal(delay, 1_000); firstTimerCallback = callback; return 1; },
    clearTimeoutFn: () => { firstTimerCallback = null; },
  });
  let recordedFinalResult;
  const bombArenaWindowOpen = true;
  advanceRealBombArenaMatch(firstStory.orchestrator, (event) => {
    recordedFinalResult = dispatchBombArenaEvent(event, {
      onBombArenaEvent: (reportedEvent) => firstStory.orchestrator.onBombArenaEvent(reportedEvent),
      handoffRetrier: firstRetrier,
    });
    return recordedFinalResult;
  });
  assert.equal(progression.data.bombArena.status, 'RESULTS_READY');
  assert.equal(progression.data.bombArena.sessionRoundsPlayed, 8);
  assert.equal(progression.data.bombArena.sessionWinner, 'justme');
  assert.equal(recordedFinalResult, true, 'the final result is immediately sent through the narrative handoff');
  assert.equal(firstAttempts, 1);
  assert.equal(firstRetrier.scheduled, true, 'a transient Messenger failure remains retryable');
  assert.equal(bombArenaWindowOpen, true, 'the handoff does not close BombArena');
  assert.equal(progression.data.flags.keepNormalRun, 'intact', 'unrelated saved progression remains intact');

  // Reload the saved run while the immediate result handoff is pending.
  const resumed = new Progression(story, storage);
  const resumedStory = createStoryHarness(resumed, () => now);
  let attempts = 0;
  const retrier = createBombArenaHandoffRetrier({
    progression: resumed,
    onBombArenaEvent: (event) => resumedStory.orchestrator.onBombArenaEvent(event),
    activateGroup: () => { attempts++; return true; },
  });
  assert.equal(retrier.attempt(), true, 'startup resumes the saved transition without waiting for a window close');
  assert.equal(resumed.data.bombArena.status, 'COMPLETED');
  assert.equal(attempts, 1);
  assert.equal(retrier.scheduled, false);
  assert.equal(firstRetrier.scheduled, true, 'an old runtime timer is not needed for recovery after reload');
  assert.equal(typeof firstTimerCallback, 'function');
  assert.equal(firstRetrier.cancel(), true, 'the reloaded runtime can discard its obsolete timer');

  assert.equal(resumedStory.orchestrator.bombArenaPostMatchAvailable(), true);
  assert.equal(resumed.data.flags.bombArenaWinner, 'justme');
  resumedStory.thread.receive(now);
  const incoming = resumedStory.thread.receive(now + 20_000);
  assert.ok(incoming.includes(postmatch), 'the existing group thread receives the real postmatch dialogue');
  assert.equal(resumed.data.dialogues[postmatch.id].transcript[0].text, 'AAAAAA');
  const postmatchHistoryCount = resumedStory.thread.state.history.filter((message) => message.eventId === postmatch.id).length;
  assert.ok(postmatchHistoryCount > 0, 'the branch is written to the existing group conversation history');

  const reloadedAgain = new Progression(story, storage);
  const againStory = createStoryHarness(reloadedAgain, () => now + 30_000);
  assert.equal(againStory.orchestrator.bombArenaPostMatchAvailable(), true);
  const restoredHistory = againStory.thread.state.history;
  assert.equal(restoredHistory.filter((message) => message.eventId === postmatch.id).length, postmatchHistoryCount,
    'reloading restores the same transcript without adding duplicate messages');
  assert.equal(reloadedAgain.data.dialogues[postmatch.id].transcript[0].text, 'AAAAAA');
  assert.equal(reloadedAgain.data.flags.keepNormalRun, 'intact');
});
