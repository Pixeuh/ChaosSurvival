import test from 'node:test';
import assert from 'node:assert/strict';
import { createBombArenaChat } from '../src/minigames/bomb-arena/chat-system.js';
import { createGame, drainGameEvents, updateGame } from '../src/minigames/bomb-arena/engine.js';

function advance(chat, ms) { for (let elapsed = 0; elapsed < ms; elapsed += 100) chat.advance(Math.min(100, ms - elapsed)); }

test('human BombArena mentions resolve explicit nickname tokens through the live event queue', () => {
  const draws = [0.99, 0.4, 0, 0.99, 0];
  const chat = createBombArenaChat({ rng: () => draws.shift() ?? 0, playerNickname: 'PixelFan', grammaticalGender: 'female' });
  chat.onGameEvent({ id: 1, round: 1, type: 'round_started' });
  chat.onGameEvent({ id: 2, round: 1, type: 'player_eliminated', playerId: 'justme', cause: 'unknown' });
  advance(chat, 2000);
  assert.equal(chat.messages.at(-1).text, 'rip PixelFan');
  assert.equal(chat.messages.at(-1).authorId, 'turbo');
  draws.push(0.4, 0, 0, 0);
  chat.onGameEvent({ id: 3, round: 1, type: 'round_won', playerId: 'justme', draw: false });
  advance(chat, 2000);
  assert.equal(chat.messages.at(-1).text, 'gg PixelFan');
  assert.equal(chat.sendPlayerMessage('gg'), true);
  assert.equal(chat.messages.at(-1).authorId, 'justme');
  assert.equal(chat.messages.at(-1).author, 'PixelFan');
  assert.equal(chat.messages.every(({ text }) => !text.includes('{player.')), true);
  chat.dispose();
});

test('gameplay events drive correctly attributed, deduplicated reactions with a per-round cap', () => {
  const chat = createBombArenaChat({ rng: () => 0 });
  chat.onGameEvent({ id: 1, round: 1, type: 'round_started' });
  const firstQueueSize = chat.pendingCount;
  chat.onGameEvent({ id: 1, round: 1, type: 'round_started' });
  assert.equal(chat.pendingCount, firstQueueSize, 'an event is consumed at most once');
  advance(chat, 1800);
  assert.equal(chat.messages[0].authorId, 'pixelgirl');
  assert.equal(chat.messages[0].color, '#ff74b9');

  chat.onGameEvent({ id: 2, round: 1, type: 'player_eliminated', playerId: 'turbo', eliminatedBy: 'pixelgirl', cause: 'bomb' });
  assert.ok(chat.pendingCount > 0);
  advance(chat, 5000);
  assert.ok(chat.messages.some((message) => message.authorId === 'pixelgirl'), 'the attributed killer may react');
  assert.ok(chat.messages.some((message) => message.authorId === 'turbo'), 'the eliminated player can still chat');

  for (let id = 3; id < 20; id++) chat.onGameEvent({ id, round: 1, type: 'chain_reaction', bombCount: 4 });
  assert.ok(chat.pendingCount <= 5, 'NPC reactions cannot exceed five for a round');
  chat.dispose();
  assert.equal(chat.pendingCount, 0);
});

test('unknown and sudden-death eliminations do not credit another player', () => {
  const chat = createBombArenaChat({ rng: () => 0 });
  chat.onGameEvent({ id: 1, round: 1, type: 'round_started' });
  advance(chat, 1200);
  chat.onGameEvent({ id: 2, round: 1, type: 'player_eliminated', playerId: 'turbo', eliminatedBy: null, cause: 'sudden-death' });
  advance(chat, 1600);
  const latest = chat.messages.at(-1);
  assert.equal(latest.authorId, 'turbo');
  assert.equal(latest.text, 'bon…', 'the neutral pool is used when no attacker exists');
  chat.dispose();
});

test('JustMe messages use the local quick-message list and history survives the next round', () => {
  const chat = createBombArenaChat({ rng: () => 0 });
  chat.onGameEvent({ id: 1, round: 1, type: 'round_started' });
  assert.equal(chat.sendPlayerMessage('laugh'), true);
  assert.deepEqual(chat.messages[0], {
    id: 1, authorId: 'justme', author: 'JustMe', color: '#f2c94c', text: 'mdrrrr', time: 0,
  });
  assert.equal(chat.sendPlayerMessage('not-a-message'), false);
  const responseCount = chat.pendingCount;
  assert.equal(chat.sendPlayerMessage('gg'), true);
  assert.equal(chat.pendingCount, responseCount, 'rapid player messages do not queue a response for each one');
  chat.onGameEvent({ id: 2, round: 2, type: 'round_started' });
  assert.equal(chat.messages[0].text, 'mdrrrr');
  chat.dispose();
});

test('the internal PRO-to-PGM transition does not expose a difficulty label in chat', () => {
  const chat = createBombArenaChat({ rng: () => 0 });
  chat.onGameEvent({ id: 40, round: 4, type: 'round_started' });
  const before = chat.pendingCount;
  chat.onGameEvent({ id: 41, round: 4, type: 'difficulty_changed', difficulty: 'PGM' });
  assert.equal(chat.pendingCount, before);
  chat.onGameEvent({ id: 41, round: 4, type: 'difficulty_changed', difficulty: 'PGM' });
  assert.equal(chat.pendingCount, before, 'the internal event stays invisible to players');
  chat.dispose();
});

test('engine publishes round and bomb elimination events with verified ownership', () => {
  const game = createGame({ rng: () => 0.9 });
  const initialEvents = drainGameEvents(game);
  assert.deepEqual(initialEvents.map((event) => event.type), ['round_started']);
  game.phase = 'playing';
  game.blocks.clear(); game.bombs = []; game.fires = [];
  game.players.forEach((player, index) => { player.x = 2.5 + index; player.y = 2.5; player.alive = true; player.controls = {}; });
  const victim = game.players[2]; victim.x = 5.5; victim.y = 5.5;
  game.bombs.push({ id: 'owned-hit', x: 5, y: 5, owner: 'pixelgirl', range: 2, fuse: 1, exploded: false });
  updateGame(game, 50);
  const events = drainGameEvents(game);
  const eliminated = events.find((event) => event.type === 'player_eliminated' && event.playerId === victim.id);
  assert.deepEqual({ eliminatedBy: eliminated.eliminatedBy, cause: eliminated.cause }, { eliminatedBy: 'pixelgirl', cause: 'bomb' });
  assert.equal(drainGameEvents(game).length, 0, 'drained events cannot be delivered again');
});

test('engine distinguishes self eliminations, chains, and the actual round and match winners', () => {
  const selfGame = createGame({ rng: () => 0.9 });
  drainGameEvents(selfGame); selfGame.phase = 'playing'; selfGame.blocks.clear(); selfGame.bombs = [];
  selfGame.players.forEach((player, index) => { player.x = 2.5 + index; player.y = 2.5; player.alive = true; player.controls = {}; player.think = 100000; });
  const self = selfGame.players.find((player) => player.id === 'turbo'); self.x = 6.5; self.y = 5.5;
  selfGame.fires = [{ cells: [{ x: 6, y: 5 }], remaining: 500, owner: 'turbo' }];
  updateGame(selfGame, 50);
  const selfEvent = drainGameEvents(selfGame).find((event) => event.type === 'player_eliminated');
  assert.equal(selfEvent.cause, 'self');
  assert.equal(selfEvent.eliminatedBy, 'turbo');

  const chainGame = createGame({ rng: () => 0.9 });
  drainGameEvents(chainGame); chainGame.phase = 'playing'; chainGame.blocks.clear(); chainGame.bombs = [];
  chainGame.players.forEach((player, index) => { player.x = 2.5 + index; player.y = 8.5; player.alive = true; player.controls = {}; player.think = 100000; });
  chainGame.bombs = [
    { id: 'first', x: 5, y: 5, owner: 'justme', range: 2, fuse: 1, exploded: false },
    { id: 'second', x: 6, y: 5, owner: 'pixelgirl', range: 2, fuse: 1800, exploded: false },
  ];
  updateGame(chainGame, 50);
  const chain = drainGameEvents(chainGame).find((event) => event.type === 'chain_reaction');
  assert.equal(chain.bombCount, 2);

  const resultGame = createGame({ rng: () => 0.9 });
  drainGameEvents(resultGame); resultGame.phase = 'playing'; resultGame.round = 8; resultGame.wins.luna = 2;
  resultGame.players.forEach((player) => { player.alive = player.id === 'luna'; });
  updateGame(resultGame, 16);
  const resultEvents = drainGameEvents(resultGame);
  assert.equal(resultEvents.find((event) => event.type === 'round_won').playerId, 'luna');
  assert.equal(resultEvents.find((event) => event.type === 'match_won').playerId, 'luna');
  assert.equal(resultEvents.find((event) => event.type === 'match_won').roundsPlayed, 8);
});
