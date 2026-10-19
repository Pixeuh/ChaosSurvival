import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA_HEIGHT, ARENA_WIDTH, createGame, placeBomb, setPlayerControls, startRound, togglePause, updateGame } from '../src/minigames/bomb-arena/engine.js';

function gameInPlay() {
  const state = createGame({ rng: () => 0.9 });
  state.phase = 'playing';
  state.arena = Array.from({ length: ARENA_HEIGHT }, (_, y) => Array.from({ length: ARENA_WIDTH }, (_, x) =>
    x === 0 || y === 0 || x === ARENA_WIDTH - 1 || y === ARENA_HEIGHT - 1 ? 'wall' : 'floor'));
  state.blocks.clear(); state.bombs = []; state.fires = []; state.bonuses = [];
  state.players.forEach((player, i) => { player.x = [2.5, 10.5, 10.5, 2.5][i]; player.y = [2.5, 8.5, 2.5, 8.5][i]; player.alive = true; player.controls = {}; player.route = []; player.bombIds.clear(); player.escapeBombs.clear(); });
  return state;
}
function tick(state, count, dt = 50) { for (let i = 0; i < count; i++) updateGame(state, dt); }

function settleRound(state, winnerId) {
  state.phase = 'playing';
  state.players.forEach((player) => { player.alive = player.id === winnerId; });
  updateGame(state, 16);
}

function advanceRound(state) {
  tick(state, 50, 50);
  state.phase = 'playing';
}

test('BombArena starts with four balanced players in PRO and automatically changes to PGM after round four', () => {
  const state = createGame({ rng: () => 0.9 });
  assert.deepEqual(state.players.map((p) => p.name), ['JustMe', 'PixelGirl', 'Turbo', 'Luna']);
  assert.equal(state.difficulty, 'PRO');
  const physicalStats = state.players.map((p) => [p.capacity, p.range, p.speed]);
  for (let round = 1; round <= 4; round++) {
    settleRound(state, 'justme');
    assert.notEqual(state.phase, 'match-end', 'no winner is declared before the eighth round');
    if (round < 4) advanceRound(state);
  }
  assert.equal(state.phase, 'difficulty-transition');
  assert.equal(state.difficulty, 'PGM');
  assert.equal(state.wins.justme, 4, 'the score is retained at the transition');
  advanceRound(state);
  assert.equal(state.round, 5);
  assert.equal(state.difficulty, 'PGM');
  assert.deepEqual(state.players.map((p) => [p.capacity, p.range, p.speed]), physicalStats, 'difficulty never grants physical advantages');
  assert.ok(state.players[1].think < 430, 'PGM uses the existing more deliberate AI settings');
});

test('eight rounds are required and tied leaders play PGM tiebreakers with all four players', () => {
  const state = createGame({ rng: () => 0.9 });
  const winners = ['justme', 'pixelgirl', 'turbo', 'luna', 'justme', 'pixelgirl', 'turbo', 'luna'];
  for (let index = 0; index < winners.length; index++) {
    settleRound(state, winners[index]);
    if (index < winners.length - 1) {
      assert.notEqual(state.phase, 'match-end');
      advanceRound(state);
    }
  }
  assert.equal(state.round, 8);
  assert.equal(state.phase, 'round-end', 'a tied top score continues to a tiebreak');
  assert.deepEqual(Object.values(state.wins), [2, 2, 2, 2]);
  advanceRound(state);
  assert.equal(state.round, 9);
  assert.equal(state.difficulty, 'PGM');
  assert.ok(state.players.every((player) => player.alive), 'all participants return for the tiebreak round');

  state.players.forEach((player) => { player.alive = false; });
  updateGame(state, 16);
  assert.equal(state.phase, 'round-end', 'a tied tiebreak or draw does not end the match');
  advanceRound(state);
  assert.equal(state.round, 10);
  assert.ok(state.players.every((player) => player.alive));
  settleRound(state, 'luna');
  assert.equal(state.phase, 'match-end');
  assert.equal(state.matchWinnerId, 'luna');
  const result = state.events.findLast((event) => event.type === 'match_won');
  assert.deepEqual(result.scores, { justme: 2, pixelgirl: 2, turbo: 2, luna: 3 });
  assert.equal(result.roundsPlayed, 10);
});

test('resuming after five completed rounds keeps scores and starts the sixth round in PGM', () => {
  const state = createGame({
    rng: () => 0.9,
    progress: { completedRounds: 5, scores: { justme: 2, pixelgirl: 1, turbo: 1, luna: 1 } },
  });
  assert.equal(state.round, 6);
  assert.equal(state.difficulty, 'PGM');
  assert.equal(state.phase, 'ready');
  assert.deepEqual(state.wins, { justme: 2, pixelgirl: 1, turbo: 1, luna: 1 });
});

test('player movement is continuous, normalized diagonally and blocked by solid arena cells', () => {
  const state = gameInPlay(); const player = state.players[0];
  for (const [direction, dx, dy] of [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]]) {
    player.x = 6.5; player.y = 5.5; setPlayerControls(state, { [direction]: true }); updateGame(state, 50);
    assert.ok(Math.sign(player.x - 6.5) === dx && Math.sign(player.y - 5.5) === dy, `${direction} moves in the expected direction`);
  }
  player.x = 2.5; player.y = 2.5;
  setPlayerControls(state, { right: true, up: true }); updateGame(state, 50);
  assert.ok(Math.abs(Math.hypot(player.x - 2.5, player.y - 2.5) - player.speed * .05) < .002);
  player.x = 2.5; player.y = 3.5; state.arena[3][3] = 'wall';
  setPlayerControls(state, { right: true }); updateGame(state, 50);
  assert.ok(player.x < 2.73, 'the player radius prevents entering a wall tile');
});

test('bomb placement respects capacity, permits escape, then makes the bomb tile solid', () => {
  const state = gameInPlay(); const player = state.players[0];
  assert.equal(placeBomb(state, player), true);
  assert.equal(placeBomb(state, player), false);
  setPlayerControls(state, { right: true }); tick(state, 7);
  assert.ok(player.x > 2.5, 'owner can leave the bomb cell');
  const xAfterLeave = player.x;
  setPlayerControls(state, { left: true }); tick(state, 7);
  assert.ok(player.x > 3.1 && player.x < xAfterLeave, 'player is stopped by the bomb instead of passing back through it');
});

test('explosions stop at walls and blocks, destroy blocks, and trigger chained bombs once', () => {
  const state = gameInPlay(); const owner = state.players[0]; owner.capacity = 3;
  state.blocks.add('3,2'); state.blocks.add('7,2'); state.arena[2][6] = 'wall';
  state.bombs = [
    { id: 'a', x: 2, y: 2, owner: owner.id, range: 4, fuse: 1, exploded: false },
    { id: 'b', x: 2, y: 4, owner: state.players[1].id, range: 2, fuse: 1600, exploded: false },
  ];
  owner.bombIds.add('a'); state.players[1].bombIds.add('b');
  updateGame(state, 50);
  assert.equal(state.blocks.has('3,2'), false);
  assert.equal(state.blocks.has('7,2'), true, 'wall shielded the block beyond it');
  assert.equal(state.fires.some((f) => f.cells.some((c) => c.x === 2 && c.y === 4)), true, 'chain bomb explodes immediately');
  assert.equal(state.fires.some((f) => f.cells.some((c) => c.x === 2 && c.y === 6)), true, 'chain bomb uses its own blast');
  assert.equal(state.fires.some((f) => f.cells.some((c) => c.x === 7 && c.y === 2)), false, 'permanent wall stops blast propagation');
  assert.equal(state.bombs.length, 0);
});

test('bonuses apply capped upgrades to human and AI participants', () => {
  const state = gameInPlay(); const player = state.players[0]; player.x = 4.5; player.y = 4.5;
  state.bonuses = [
    { x: 4, y: 4, type: 'flame' },
    { x: 5, y: 4, type: 'bomb' },
    { x: 6, y: 4, type: 'speed' },
    { x: 7, y: 4, type: 'shield' },
  ];
  updateGame(state, 1); assert.equal(player.range, 3); assert.equal(player.bonuses, undefined);
  player.x = 5.5; updateGame(state, 1); assert.equal(player.capacity, 2);
  player.x = 6.5; updateGame(state, 1); assert.ok(player.speed > 3.15);
  player.x = 7.5; updateGame(state, 1); assert.equal(player.shields, 1);
});

test('power-ups reset between rounds while round scores persist, and simultaneous elimination is a draw', () => {
  const state = gameInPlay();
  state.wins.turbo = 1;
  state.players[0].range = 6; state.players[0].capacity = 4; state.players[0].speed = 4.5; state.players[0].shields = 2;
  startRound(state);
  assert.equal(state.wins.turbo, 1);
  assert.deepEqual(state.players.map((p) => [p.range, p.capacity, p.speed, p.shields]), Array.from({ length: 4 }, () => [2, 1, 3.15, 0]));
  state.phase = 'playing'; state.players.forEach((player) => { player.alive = false; });
  updateGame(state, 16);
  assert.equal(state.phase, 'round-end'); assert.equal(state.message, 'DRAW!');
  assert.deepEqual(state.wins, { justme: 0, pixelgirl: 0, turbo: 1, luna: 0 });
});

test('AI players move without user input and react to bomb danger', () => {
  const state = gameInPlay(); const ai = state.players[1]; const initial = [ai.x, ai.y];
  for (let i = 0; i < 80; i++) updateGame(state, 50);
  assert.notDeepEqual([ai.x, ai.y], initial);
  state.bombs = []; state.fires = []; state.players.forEach((p) => { p.bombIds.clear(); p.escapeBombs.clear(); });
  ai.alive = true; ai.x = 5.5; ai.y = 5.5; ai.think = 0; ai.route = [];
  const bomb = { id: 'threat', x: Math.floor(ai.x), y: Math.floor(ai.y), owner: state.players[2].id, range: 2, fuse: 1200, exploded: false };
  state.bombs.push(bomb); state.players[2].bombIds.add(bomb.id); ai.escapeBombs.add(bomb.id);
  const before = [ai.x, ai.y];
  tick(state, 12);
  assert.notDeepEqual([ai.x, ai.y], before, 'AI selects an escape route when threatened');
});

test('round scores, delayed match victory, pause, and sudden-death walls update game state', () => {
  const state = gameInPlay(); state.players[0].alive = false; state.players[2].alive = false; state.players[3].alive = false;
  updateGame(state, 16); assert.equal(state.wins.pixelgirl, 1); assert.equal(state.phase, 'round-end');
  state.wins.justme = 2; state.round = 8; state.players[0].alive = true; state.players[1].alive = false; state.players[2].alive = false; state.players[3].alive = false; state.phase = 'playing';
  updateGame(state, 16); assert.equal(state.wins.justme, 3); assert.equal(state.phase, 'match-end');
  togglePause(state); assert.equal(state.phase, 'match-end');
  const sudden = gameInPlay(); sudden.roundTime = 90000; for (let i = 0; i < 18; i++) updateGame(sudden, 50);
  assert.equal(sudden.arena[1][1], 'wall');
});

test('pause halts simulation and resume restarts from the same round state', () => {
  const state = gameInPlay(); const x = state.players[0].x, roundTime = state.roundTime;
  assert.equal(togglePause(state), 'paused'); updateGame(state, 2000); assert.equal(state.players[0].x, x); assert.equal(state.roundTime, roundTime);
  assert.equal(togglePause(state), 'playing');
});
