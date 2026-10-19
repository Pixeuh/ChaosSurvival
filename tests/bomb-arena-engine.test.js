import test from 'node:test';
import assert from 'node:assert/strict';
import { ARENA_HEIGHT, ARENA_WIDTH, arenaCellAt, createGame, placeBomb, setPlayerControls, startRound, togglePause, updateGame } from '../src/minigames/bomb-arena/engine.js';

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

function prepareActorMove(state, actor, x, y, direction, destination = null) {
  state.phase = 'playing'; state.roundTime = 0; state.suddenClock = 0; state.suddenIndex = 0;
  state.players.forEach((player) => {
    player.x = x + 0.5; player.y = y + 0.5; player.alive = true;
    player.controls = {}; player.route = []; player.think = 1_000_000;
    player.bombIds.clear(); player.escapeBombs.clear(); player.invulnerable = 0;
  });
  state.blocks.clear(); state.bombs = []; state.fires = []; state.bonuses = [];
  state.arena = Array.from({ length: ARENA_HEIGHT }, (_, cy) => Array.from({ length: ARENA_WIDTH }, (_, cx) =>
    cx === 0 || cy === 0 || cx === ARENA_WIDTH - 1 || cy === ARENA_HEIGHT - 1 ? 'wall' : 'floor'));
  if (actor.human) setPlayerControls(state, direction);
  else {
    actor.route = [{ x: destination?.x ?? x + Number(direction.right) - Number(direction.left), y: destination?.y ?? y + Number(direction.down) - Number(direction.up) }];
  }
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

test('every open interior cell is traversable with shared collision rules for JustMe and all three NPCs', () => {
  const state = gameInPlay();
  for (const actor of state.players) {
    for (let y = 1; y < ARENA_HEIGHT - 1; y++) for (let x = 1; x < ARENA_WIDTH - 1; x++) {
      for (const [direction, dx, dy] of [
        [{ left: true }, -1, 0], [{ right: true }, 1, 0], [{ up: true }, 0, -1], [{ down: true }, 0, 1],
      ]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 1 || ny < 1 || nx >= ARENA_WIDTH - 1 || ny >= ARENA_HEIGHT - 1) continue;
        prepareActorMove(state, actor, x, y, direction, { x: nx, y: ny });
        tick(state, 8, 50);
        const progress = (actor.x - (x + 0.5)) * dx + (actor.y - (y + 0.5)) * dy;
        assert.ok(progress > 0.9, `${actor.id} traverses open cell ${x},${y} toward ${nx},${ny}`);
      }
    }
  }
});

test('spawn-adjacent lanes stay traversable across deterministic generated arenas', () => {
  for (let seed = 1; seed <= 16; seed++) {
    let randomState = seed;
    const rng = () => ((randomState = (randomState * 1664525 + 1013904223) >>> 0) / 0x100000000);
    const state = createGame({ rng });
    for (const actor of state.players) {
      const origin = arenaCellAt(actor.x, actor.y);
      assert.equal(state.blocks.has(`${origin.x},${origin.y}`), false, `seed ${seed}: ${actor.id} does not spawn inside a crate`);
      for (const [direction, dx, dy] of [
        [{ left: true }, -1, 0], [{ right: true }, 1, 0], [{ up: true }, 0, -1], [{ down: true }, 0, 1],
      ]) {
        const target = { x: origin.x + dx, y: origin.y + dy };
        if (target.x <= 0 || target.y <= 0 || target.x >= ARENA_WIDTH - 1 || target.y >= ARENA_HEIGHT - 1 || state.blocks.has(`${target.x},${target.y}`)) continue;
        state.phase = 'playing'; state.roundTime = 0;
        state.players.forEach((player) => {
          player.x = origin.x + 0.5; player.y = origin.y + 0.5;
          player.route = []; player.think = 1_000_000; player.controls = {};
        });
        if (actor.human) setPlayerControls(state, direction);
        else actor.route = [target];
        tick(state, 8, 50);
        const progress = (actor.x - (origin.x + 0.5)) * dx + (actor.y - (origin.y + 0.5)) * dy;
        assert.ok(progress > 0.9, `seed ${seed}: ${actor.id} can move from spawn to open lane ${target.x},${target.y}`);
      }
    }
  }
});

test('wall, crate, corridor and corner contacts resolve without phantom blockers and allow natural sliding', () => {
  const state = gameInPlay();
  const justme = state.players[0];
  for (const actor of state.players) {
    prepareActorMove(state, actor, 3, 5, { right: true }, { x: 6, y: 5 });
    state.arena[5][4] = 'wall';
    tick(state, 30, 50);
    assert.ok(actor.x <= 3.73 + 1e-6, `${actor.id} is blocked by the wall with shared physics`);
    assert.ok(actor.x > 3.72, 'swept movement resolves right up to the wall contact');
  }

  prepareActorMove(state, justme, 3, 5, { right: true });
  state.blocks.add('4,5');
  tick(state, 30, 50);
  assert.ok(justme.x <= 3.73 + 1e-6, 'a destructible block blocks movement while present');
  state.blocks.delete('4,5');
  tick(state, 8, 50);
  assert.ok(justme.x > 4.5, 'removing the crate immediately removes its collision');

  prepareActorMove(state, justme, 2, 5, { right: true });
  for (let x = 1; x < ARENA_WIDTH - 1; x++) {
    state.arena[4][x] = 'wall'; state.arena[6][x] = 'wall';
  }
  tick(state, 45, 50);
  assert.ok(justme.x > 9, 'the hitbox passes through a one-cell-wide corridor');

  prepareActorMove(state, justme, 3, 3, { right: true, down: true });
  state.arena[3][4] = 'wall';
  tick(state, 3, 50);
  assert.ok(justme.y > 3.5, 'the free axis continues while the other axis slides along a wall');
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

test('flames eliminate every unprotected character whose hitbox overlaps a danger cell', () => {
  const state = gameInPlay();
  state.players.forEach((player) => { player.x = 5.5; player.y = 5.5; });
  state.bombs = [{ id: 'center', x: 5, y: 5, owner: 'pixelgirl', range: 1, fuse: 1, exploded: false }];
  state.players[1].bombIds.add('center');
  updateGame(state, 16);
  assert.ok(state.players.every((player) => !player.alive), 'all four identities use identical explosion damage');
  assert.deepEqual(state.events.filter((event) => event.type === 'player_eliminated').map((event) => event.playerId).sort(),
    ['justme', 'luna', 'pixelgirl', 'turbo']);
  tick(state, 4);
  assert.equal(state.events.filter((event) => event.type === 'player_eliminated').length, 4,
    'a dead character is eliminated only once');
});

test('danger detection uses the same flame cells and catches partial and swept hitbox contact', () => {
  const edge = gameInPlay();
  const player = edge.players[0];
  edge.players.slice(1).forEach((other, index) => { other.x = 2.5 + index; other.y = 8.5; });
  player.x = 7.2; player.y = 5.5; // Center is in cell 7; the radius overlaps the fire cell 6.
  edge.bombs = [{ id: 'edge', x: 5, y: 5, owner: 'turbo', range: 1, fuse: 1, exploded: false }];
  updateGame(edge, 16);
  assert.equal(player.alive, false, 'a visually dangerous neighboring tile catches a partially overlapping hitbox');
  assert.ok(edge.fires[0].cells.some((cell) => cell.x === 6 && cell.y === 5));

  const swept = gameInPlay();
  const fast = swept.players[0];
  swept.players.slice(1).forEach((other, index) => { other.x = 2.5 + index; other.y = 8.5; });
  fast.x = 4.5; fast.y = 5.5; fast.speed = 40;
  setPlayerControls(swept, { right: true });
  swept.fires = [{ cells: [{ x: 5, y: 5 }], remaining: 560, owner: 'luna' }];
  updateGame(swept, 50);
  assert.ok(fast.x > 6, 'the stress step ends beyond the danger cell');
  assert.equal(fast.alive, false, 'swept collision catches crossing the active fire between endpoints');
});

test('simultaneous and crossing blasts eliminate each affected participant only once', () => {
  const state = gameInPlay();
  const positions = [[3.5, 5.5], [7.5, 5.5], [5.5, 5.5], [6.5, 5.5]];
  state.players.forEach((player, index) => { [player.x, player.y] = positions[index]; });
  state.bombs = [
    { id: 'left', x: 3, y: 5, owner: 'justme', range: 4, fuse: 1, exploded: false },
    { id: 'right', x: 7, y: 5, owner: 'turbo', range: 4, fuse: 1, exploded: false },
  ];
  state.players[0].bombIds.add('left'); state.players[2].bombIds.add('right');
  updateGame(state, 16);
  assert.ok(state.players.every((player) => !player.alive));
  assert.equal(state.fires.length, 2, 'both crossing blasts retain their own damage zones');
  assert.deepEqual(state.events.filter((event) => event.type === 'player_eliminated').map((event) => event.playerId).sort(),
    ['justme', 'luna', 'pixelgirl', 'turbo']);
  assert.ok(state.fires.some((fire) => fire.cells.some((cell) => cell.x === 5 && cell.y === 5)));
});

test('simultaneous blasts use the same pre-explosion destructible-block snapshot', () => {
  const state = gameInPlay();
  state.blocks.add('5,5');
  state.bombs = [
    { id: 'left-simultaneous', x: 3, y: 5, owner: 'justme', range: 4, fuse: 1, exploded: false },
    { id: 'right-simultaneous', x: 7, y: 5, owner: 'turbo', range: 4, fuse: 1, exploded: false },
  ];
  updateGame(state, 16);
  assert.equal(state.blocks.has('5,5'), false, 'both blasts remove the struck crate');
  assert.equal(state.fires.length, 2);
  assert.ok(state.fires.every((fire) => fire.cells.some((cell) => cell.x === 5 && cell.y === 5)));
  const left = state.fires.find((fire) => fire.owner === 'justme');
  const right = state.fires.find((fire) => fire.owner === 'turbo');
  assert.equal(left.cells.some((cell) => cell.x === 6 && cell.y === 5), false);
  assert.equal(right.cells.some((cell) => cell.x === 4 && cell.y === 5), false,
    'neither same-step blast propagates through a block removed by the other');
});

test('fire lifetime is checked against contact time, and one shield absorbs a single hit', () => {
  const expiredBeforeEntry = gameInPlay();
  const late = expiredBeforeEntry.players[0]; late.x = 3.7; late.y = 5.5; late.speed = 4.8;
  setPlayerControls(expiredBeforeEntry, { right: true });
  expiredBeforeEntry.fires = [{ cells: [{ x: 4, y: 5 }], remaining: 5, owner: 'turbo' }];
  updateGame(expiredBeforeEntry, 50);
  assert.equal(late.alive, true, 'contact after the final active portion of a flame does not damage');
  assert.equal(expiredBeforeEntry.fires.length, 0);

  const shielded = gameInPlay();
  const player = shielded.players[0]; player.x = 5.5; player.y = 5.5; player.shields = 1;
  shielded.players.slice(1).forEach((other, index) => { other.x = 2.5 + index; other.y = 8.5; });
  shielded.fires = [{ cells: [{ x: 5, y: 5 }, { x: 6, y: 5 }], remaining: 1200, owner: 'pixelgirl' }];
  updateGame(shielded, 16);
  assert.equal(player.alive, true);
  assert.equal(player.shields, 0);
  assert.ok(player.invulnerable > 0);
  tick(shielded, 5, 50);
  assert.equal(player.shields, 0, 'the same active flame cannot consume multiple shields during invulnerability');
  assert.equal(player.alive, true);
  tick(shielded, 10, 50);
  assert.equal(player.alive, false, 'temporary invulnerability expires and does not become permanent immunity');
});

test('active-fire contact is consistent across simulated update intervals', () => {
  for (const interval of [10, 25, 50]) {
    const state = gameInPlay();
    const player = state.players[0]; player.x = 3.4; player.y = 5.5; player.speed = 4.8;
    state.players.slice(1).forEach((other, index) => { other.x = 2.5 + index; other.y = 8.5; });
    setPlayerControls(state, { right: true });
    state.fires = [{ cells: [{ x: 4, y: 5 }], remaining: 72, owner: 'turbo' }];
    for (let elapsed = 0; elapsed < 100; elapsed += interval) updateGame(state, interval);
    assert.equal(player.alive, false, `a flame hit is not skipped with ${interval} ms simulation updates`);
    assert.equal(state.events.filter((event) => event.type === 'player_eliminated' && event.playerId === player.id).length, 1);
  }
});

test('wall contact and open-path distance stay stable across simulated update intervals', () => {
  const contacts = [];
  for (const interval of [10, 25, 50]) {
    const state = gameInPlay();
    const player = state.players[0]; player.x = 3.4; player.y = 5.5; player.speed = 4.8;
    state.players.slice(1).forEach((other, index) => { other.x = 2.5 + index; other.y = 8.5; });
    state.arena[5][5] = 'wall';
    setPlayerControls(state, { right: true });
    for (let elapsed = 0; elapsed < 500; elapsed += interval) updateGame(state, interval);
    contacts.push(player.x);
  }
  assert.ok(contacts.every((x) => Math.abs(x - 4.73) < 1e-5), `wall contact is stable: ${contacts.join(', ')}`);
});

test('an exploded bomb leaves no physical blocker, and a destroyed crate clears its cell', () => {
  const state = gameInPlay();
  const player = state.players[0];
  state.blocks.add('4,5');
  player.x = 3.5; player.y = 5.5;
  state.bombs = [{ id: 'clear-crate', x: 4, y: 3, owner: 'turbo', range: 2, fuse: 1, exploded: false }];
  state.players.slice(1).forEach((other, index) => { other.x = 2.5 + index; other.y = 8.5; });
  updateGame(state, 16);
  assert.equal(state.blocks.has('4,5'), false, 'the destructible tile is removed by the blast');
  assert.equal(state.bombs.length, 0, 'exploded bombs are removed before the next movement step');
  // The blast may leave a fire in the tile, so wait for the visual/damage window to finish.
  tick(state, 12, 50);
  player.alive = true; state.phase = 'playing'; state.blocks.clear(); state.fires = [];
  player.x = 3.5; player.y = 5.5;
  setPlayerControls(state, { right: true }); tick(state, 10, 50);
  assert.ok(player.x > 4.5, 'the cell is traversable after its crate is destroyed and fire has expired');
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
