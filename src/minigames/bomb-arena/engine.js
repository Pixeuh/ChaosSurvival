import { PLAYER_COLORS } from './player-colors.js';

export const ARENA_WIDTH = 13;
export const ARENA_HEIGHT = 11;
export const DIFFICULTIES = Object.freeze({
  PRO: { label: 'PRO', thinkMs: 430, risk: 0.28, hunt: 0.52, mistake: 0.1 },
  PGM: { label: 'PGM', thinkMs: 250, risk: 0.44, hunt: 0.78, mistake: 0.025 },
});
export const REGULATION_ROUNDS = 8;
export const PGM_START_ROUND = 5;
const DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SPAWNS = [[1, 1], [11, 9], [11, 1], [1, 9]];
const PLAYER_INFO = [
  { id: 'justme', name: 'JustMe', color: PLAYER_COLORS.justme, human: true },
  { id: 'pixelgirl', name: 'PixelGirl', color: PLAYER_COLORS.pixelgirl, personality: 'wild' },
  { id: 'turbo', name: 'Turbo', color: PLAYER_COLORS.turbo, personality: 'aggressive' },
  { id: 'luna', name: 'Luna', color: PLAYER_COLORS.luna, personality: 'careful' },
];
const BONUS_TYPES = ['flame', 'bomb', 'speed', 'shield'];
const key = (x, y) => `${x},${y}`;
const rand = (rng) => Math.max(0, Math.min(0.999999, rng()));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function randomBlocks(rng, round) {
  const cells = new Set();
  for (let y = 1; y < ARENA_HEIGHT - 1; y++) for (let x = 1; x < ARENA_WIDTH - 1; x++) {
    if ((x % 2 === 0 && y % 2 === 0) || SPAWNS.some(([sx, sy]) => Math.abs(sx - x) + Math.abs(sy - y) < 3)) continue;
    if (rand(rng) < 0.48 + (round % 3) * 0.025) cells.add(key(x, y));
  }
  return cells;
}

export function createGame({ rng = Math.random, progress = null } = {}) {
  const wins = progress?.scores && PLAYER_INFO.every(({ id }) => Number.isSafeInteger(progress.scores[id]) && progress.scores[id] >= 0)
    ? Object.fromEntries(PLAYER_INFO.map(({ id }) => [id, progress.scores[id]]))
    : Object.fromEntries(PLAYER_INFO.map(({ id }) => [id, 0]));
  const completedRounds = Number.isSafeInteger(progress?.completedRounds)
    ? Math.max(0, Math.min(progress.completedRounds, 128))
    : 0;
  const state = { difficulty: 'PRO', rng, round: completedRounds, wins, phase: 'ready', roundTime: 0, suddenIndex: 0, suddenClock: 0, seed: 0, message: '', messageMs: 0, matchWinnerId: null };
  startRound(state);
  state.phase = 'ready';
  state.countdownMs = 1600;
  return state;
}

function emit(state, event) {
  state.events ??= [];
  state.eventSequence = (state.eventSequence ?? 0) + 1;
  state.events.push({ ...event, id: state.eventSequence, round: state.round });
}

export function drainGameEvents(state) {
  if (!state?.events?.length) return [];
  return state.events.splice(0);
}

export function startRound(state) {
  state.round++;
  state.difficulty = state.round >= PGM_START_ROUND ? 'PGM' : 'PRO';
  state.phase = 'countdown';
  state.countdownMs = 1600;
  state.roundTime = 0;
  state.suddenIndex = 0;
  state.suddenClock = 0;
  state.arena = Array.from({ length: ARENA_HEIGHT }, (_, y) => Array.from({ length: ARENA_WIDTH }, (_, x) =>
    x === 0 || y === 0 || x === ARENA_WIDTH - 1 || y === ARENA_HEIGHT - 1 || (x % 2 === 0 && y % 2 === 0) ? 'wall' : 'floor'));
  state.blocks = randomBlocks(state.rng, state.round);
  state.bombs = [];
  state.fires = [];
  state.bonuses = [];
  state.players = PLAYER_INFO.map((info, i) => ({ ...info, x: SPAWNS[i][0] + 0.5, y: SPAWNS[i][1] + 0.5, alive: true, wins: state.wins[info.id], capacity: 1, range: 2, speed: 3.15, shields: 0, bombIds: new Set(), escapeBombs: new Set(), controls: {}, think: 0, route: [], target: null, anim: 0 }));
  emit(state, { type: 'round_started' });
}

function wallAt(state, x, y) { return x < 0 || y < 0 || x >= ARENA_WIDTH || y >= ARENA_HEIGHT || state.arena[y][x] === 'wall' || state.blocks.has(key(x, y)); }
function bombAt(state, x, y) { return state.bombs.find((b) => b.x === x && b.y === y); }
function canOccupy(state, player, x, y) {
  const r = 0.27;
  for (let cy = Math.floor(y - r); cy <= Math.floor(y + r); cy++) for (let cx = Math.floor(x - r); cx <= Math.floor(x + r); cx++) {
    if (wallAt(state, cx, cy)) {
      const nearestX = clamp(x, cx, cx + 1), nearestY = clamp(y, cy, cy + 1);
      if ((x - nearestX) ** 2 + (y - nearestY) ** 2 < r ** 2) return false;
    }
    const bomb = bombAt(state, cx, cy);
    if (bomb && !player.escapeBombs.has(bomb.id)) {
      const nearestX = clamp(x, cx + 0.12, cx + 0.88), nearestY = clamp(y, cy + 0.12, cy + 0.88);
      if ((x - nearestX) ** 2 + (y - nearestY) ** 2 < r ** 2) return false;
    }
  }
  return true;
}

export function setPlayerControls(state, controls = {}) {
  const player = state?.players?.[0];
  if (player) player.controls = { up: Boolean(controls.up), down: Boolean(controls.down), left: Boolean(controls.left), right: Boolean(controls.right) };
}

export function placeBomb(state, player) {
  if (!player?.alive || player.bombIds.size >= player.capacity) return false;
  const x = clamp(Math.floor(player.x), 1, ARENA_WIDTH - 2), y = clamp(Math.floor(player.y), 1, ARENA_HEIGHT - 2);
  if (wallAt(state, x, y) || bombAt(state, x, y)) return false;
  const bomb = { id: `${player.id}-${state.round}-${state.seed++}`, x, y, owner: player.id, range: player.range, fuse: 2000, exploded: false };
  state.bombs.push(bomb); player.bombIds.add(bomb.id); player.escapeBombs.add(bomb.id);
  for (const occupant of state.players) {
    if (occupant.alive && Math.floor(occupant.x) === x && Math.floor(occupant.y) === y) occupant.escapeBombs.add(bomb.id);
  }
  return true;
}

function blastCells(state, bomb) {
  const cells = [{ x: bomb.x, y: bomb.y }];
  for (const [dx, dy] of DIRECTIONS) for (let n = 1; n <= bomb.range; n++) {
    const x = bomb.x + dx * n, y = bomb.y + dy * n;
    if (x < 0 || y < 0 || x >= ARENA_WIDTH || y >= ARENA_HEIGHT || state.arena[y][x] === 'wall') break;
    cells.push({ x, y });
    if (state.blocks.has(key(x, y))) break;
  }
  return cells;
}

function explode(state, bomb, now) {
  if (bomb.exploded) return [];
  bomb.exploded = true;
  const cells = blastCells(state, bomb);
  for (const cell of cells) {
    const id = key(cell.x, cell.y);
    if (state.blocks.delete(id) && rand(state.rng) < 0.34) state.bonuses.push({ x: cell.x, y: cell.y, type: BONUS_TYPES[Math.floor(rand(state.rng) * BONUS_TYPES.length)] });
    const chain = bombAt(state, cell.x, cell.y);
    if (chain && chain !== bomb) chain.fuse = Math.min(chain.fuse, 0);
  }
  state.fires.push({ cells, remaining: 560, owner: bomb.owner, at: now });
  const owner = state.players.find((p) => p.id === bomb.owner);
  owner?.bombIds.delete(bomb.id);
  for (const player of state.players) player.escapeBombs.delete(bomb.id);
  return cells;
}

function damagePlayers(state) {
  for (const player of state.players) {
    if (!player.alive) continue;
    const hits = state.fires.filter((fire) => fire.cells.some((cell) => cell.x === Math.floor(player.x) && cell.y === Math.floor(player.y)));
    if (hits.length) {
      if (player.shields > 0) { player.shields--; player.invulnerable = 700; }
      else if (!player.invulnerable) {
        player.alive = false;
        const owners = [...new Set(hits.map((fire) => fire.owner).filter(Boolean))];
        const eliminatedBy = owners.length === 1 ? owners[0] : null;
        emit(state, {
          type: 'player_eliminated', playerId: player.id, eliminatedBy,
          cause: eliminatedBy === player.id ? 'self' : eliminatedBy ? 'bomb' : 'unknown',
        });
      }
    }
  }
}

function collectBonuses(state) {
  for (const player of state.players) {
    if (!player.alive) continue;
    const i = state.bonuses.findIndex((b) => b.x === Math.floor(player.x) && b.y === Math.floor(player.y));
    if (i < 0) continue;
    const [bonus] = state.bonuses.splice(i, 1);
    if (bonus.type === 'flame') player.range = Math.min(6, player.range + 1);
    if (bonus.type === 'bomb') player.capacity = Math.min(5, player.capacity + 1);
    if (bonus.type === 'speed') player.speed = Math.min(4.8, player.speed + 0.28);
    if (bonus.type === 'shield') player.shields = Math.min(3, player.shields + 1);
  }
}

function dangerCells(state) {
  const danger = new Set();
  for (const bomb of state.bombs) for (const { x, y } of blastCells(state, bomb)) danger.add(key(x, y));
  for (const fire of state.fires) for (const { x, y } of fire.cells) danger.add(key(x, y));
  return danger;
}

function pathTo(state, start, goal, blocked = new Set()) {
  const queue = [{ ...start, path: [] }], seen = new Set([key(start.x, start.y)]);
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    if (item.x === goal.x && item.y === goal.y) return item.path;
    for (const [dx, dy] of DIRECTIONS) {
      const x = item.x + dx, y = item.y + dy, id = key(x, y);
      if (seen.has(id) || wallAt(state, x, y) || bombAt(state, x, y) || (blocked.has(id) && id !== key(goal.x, goal.y))) continue;
      seen.add(id); queue.push({ x, y, path: [...item.path, { x, y }] });
    }
  }
  return [];
}

function aiDecision(state, player, dt) {
  player.think -= dt;
  if (player.think > 0) return;
  const config = DIFFICULTIES[state.difficulty], danger = dangerCells(state), start = { x: Math.floor(player.x), y: Math.floor(player.y) };
  player.think = config.thinkMs;
  const safe = [];
  for (let y = 1; y < ARENA_HEIGHT - 1; y++) for (let x = 1; x < ARENA_WIDTH - 1; x++) {
    if (wallAt(state, x, y) || bombAt(state, x, y) || danger.has(key(x, y))) continue;
    const path = pathTo(state, start, { x, y });
    if (path.length) safe.push({ x, y, path });
  }
  const endangered = danger.has(key(start.x, start.y)) || state.bombs.some((bomb) => bomb.owner === player.id && Math.abs(bomb.x + 0.5 - player.x) < 0.8 && Math.abs(bomb.y + 0.5 - player.y) < 0.8);
  let choice = null;
  if (endangered && safe.length) choice = safe.sort((a, b) => a.path.length - b.path.length)[0];
  if (!choice) {
    let best = -Infinity;
    for (const candidate of safe) {
      const pickups = state.bonuses.some((b) => b.x === candidate.x && b.y === candidate.y);
      const enemies = state.players.filter((p) => p.alive && p.id !== player.id).sort((a,b) => Math.abs(a.x-candidate.x-.5)+Math.abs(a.y-candidate.y-.5) - Math.abs(b.x-candidate.x-.5)-Math.abs(b.y-candidate.y-.5));
      const enemy = enemies[0];
      const destructible = DIRECTIONS.some(([dx,dy]) => state.blocks.has(key(candidate.x+dx,candidate.y+dy)));
      const score = (pickups ? 7 : 0) + (destructible ? 2 : 0) - (enemy ? (Math.abs(enemy.x - candidate.x - .5) + Math.abs(enemy.y - candidate.y - .5)) * .14 : 0) + rand(state.rng) * (player.personality === 'wild' ? 2.2 : 0.55);
      if (score > best) { best = score; choice = candidate; }
    }
  }
  player.route = choice?.path ?? [];
  player.target = player.route[0] ?? null;
  if (!endangered && player.bombIds.size < player.capacity && rand(state.rng) > config.mistake) {
    const nearbyEnemy = state.players.some((other) => other.alive && other.id !== player.id && Math.abs(other.x - player.x) + Math.abs(other.y - player.y) < 3.4);
    const nearbyBlock = DIRECTIONS.some(([dx,dy]) => state.blocks.has(key(start.x+dx,start.y+dy)));
    const attackChance = player.personality === 'aggressive' ? 0.78 : player.personality === 'careful' ? 0.22 : 0.48;
    if ((nearbyEnemy && rand(state.rng) < config.hunt) || (nearbyBlock && rand(state.rng) < attackChance)) {
      const future = safe.some((s) => s.path.length > 0 && s.path.length <= 5);
      if (future) placeBomb(state, player);
    }
  }
}

function movePlayer(state, player, dt) {
  if (!player.alive || state.phase !== 'playing') return;
  let { up = false, down = false, left = false, right = false } = player.controls ?? {};
  if (!player.human) {
    aiDecision(state, player, dt);
    const target = player.route[0];
    left = right = up = down = false;
    if (target) {
      const tx = target.x + 0.5, ty = target.y + 0.5;
      if (Math.abs(tx - player.x) < 0.07 && Math.abs(ty - player.y) < 0.07) { player.x = tx; player.y = ty; player.route.shift(); }
      else { left = tx < player.x - .025; right = tx > player.x + .025; up = ty < player.y - .025; down = ty > player.y + .025; }
    }
  }
  let dx = Number(right) - Number(left), dy = Number(down) - Number(up);
  const magnitude = Math.hypot(dx, dy) || 1; dx /= magnitude; dy /= magnitude;
  const distance = player.speed * dt / 1000;
  if (dx && canOccupy(state, player, player.x + dx * distance, player.y)) player.x += dx * distance;
  if (dy && canOccupy(state, player, player.x, player.y + dy * distance)) player.y += dy * distance;
  player.x = clamp(player.x, 0.35, ARENA_WIDTH - 0.35); player.y = clamp(player.y, 0.35, ARENA_HEIGHT - 0.35);
  player.escapeBombs = new Set([...player.escapeBombs].filter((id) => {
    const bomb = state.bombs.find((item) => item.id === id);
    return bomb && Math.hypot(player.x - (bomb.x + 0.5), player.y - (bomb.y + 0.5)) <= 0.82;
  }));
}

function suddenOrder() {
  const cells = [];
  let left = 1, right = ARENA_WIDTH - 2, top = 1, bottom = ARENA_HEIGHT - 2;
  while (left <= right && top <= bottom) {
    for (let x = left; x <= right; x++) cells.push([x, top]); top++;
    for (let y = top; y <= bottom; y++) cells.push([right, y]); right--;
    if (top <= bottom) { for (let x = right; x >= left; x--) cells.push([x, bottom]); bottom--; }
    if (left <= right) { for (let y = bottom; y >= top; y--) cells.push([left, y]); left++; }
  }
  return cells;
}
const SUDDEN_ORDER = suddenOrder();

function resolveRound(state) {
  const alive = state.players.filter((p) => p.alive);
  if (alive.length > 1) return;
  const winner = alive[0] ?? null;
  state.phase = 'round-end'; state.message = winner ? `${winner.name.toUpperCase()} WINS!` : 'DRAW!'; state.messageMs = 2400;
  if (winner) { state.wins[winner.id]++; winner.wins = state.wins[winner.id]; }
  const highScore = Math.max(...Object.values(state.wins));
  const leaders = Object.keys(state.wins).filter((id) => state.wins[id] === highScore);
  const final = state.round >= REGULATION_ROUNDS && leaders.length === 1;
  if (final) {
    state.phase = 'match-end';
    state.matchWinnerId = leaders[0];
  } else if (state.round === 4) {
    state.difficulty = 'PGM';
    state.phase = 'difficulty-transition';
    state.message = '';
    state.messageMs = 2200;
    emit(state, { type: 'difficulty_changed', difficulty: 'PGM', round: state.round });
  }
  emit(state, { type: 'round_won', playerId: winner?.id ?? null, draw: !winner, wins: winner ? state.wins[winner.id] : null, final });
  emit(state, {
    type: 'round_completed', playerId: winner?.id ?? null, draw: !winner,
    scores: { ...state.wins }, roundsPlayed: state.round,
  });
  if (final) emit(state, {
    type: 'match_won', playerId: state.matchWinnerId, scores: { ...state.wins }, roundsPlayed: state.round,
  });
}

export function updateGame(state, dt) {
  state.events ??= [];
  dt = Math.min(Math.max(dt, 0), 50);
  if (state.phase === 'ready' || state.phase === 'paused') return;
  if (state.phase === 'countdown') { state.countdownMs -= dt; if (state.countdownMs <= 0) { state.phase = 'playing'; state.roundTime = 0; } return; }
  if (state.phase === 'round-end') { state.messageMs -= dt; if (state.messageMs <= 0) { startRound(state); } return; }
  if (state.phase === 'difficulty-transition') { state.messageMs -= dt; if (state.messageMs <= 0) { startRound(state); } return; }
  if (state.phase === 'match-end') return;
  state.roundTime += dt;
  if (state.roundTime >= 90000) {
    state.suddenClock += dt;
    if (state.suddenClock >= 900) {
      state.suddenClock -= 900;
      const [x, y] = SUDDEN_ORDER[state.suddenIndex++] ?? [];
      if (x !== undefined && state.arena[y][x] !== 'wall') {
        state.arena[y][x] = 'wall'; state.blocks.delete(key(x, y)); state.bonuses = state.bonuses.filter((b) => b.x !== x || b.y !== y);
        for (const bomb of [...state.bombs]) if (bomb.x === x && bomb.y === y) { explode(state, bomb, state.roundTime); state.bombs.splice(state.bombs.indexOf(bomb), 1); }
        for (const player of state.players) if (player.alive && Math.floor(player.x) === x && Math.floor(player.y) === y) {
          player.alive = false;
          emit(state, { type: 'player_eliminated', playerId: player.id, eliminatedBy: null, cause: 'sudden-death' });
        }
      }
    }
  }
  for (const player of state.players) if (player.invulnerable > 0) player.invulnerable -= dt;
  for (const player of state.players) if (player.human && player.controls?.bomb) { placeBomb(state, player); player.controls.bomb = false; }
  for (const player of state.players) movePlayer(state, player, dt);
  for (const bomb of state.bombs) bomb.fuse -= dt;
  const queue = state.bombs.filter((b) => b.fuse <= 0 && !b.exploded);
  const chainedBombs = new Set();
  let chainedBombCount = 0;
  while (queue.length) {
    const bomb = queue.shift(); if (bomb.exploded) continue;
    const cells = explode(state, bomb, state.roundTime);
    for (const cell of cells) {
      const chained = bombAt(state, cell.x, cell.y);
      if (!chained || chained === bomb || chained.exploded) continue;
      chained.fuse = 0;
      if (!chainedBombs.has(chained.id)) { chainedBombs.add(chained.id); chainedBombCount++; }
      if (!queue.includes(chained)) queue.push(chained);
    }
  }
  if (chainedBombCount) emit(state, { type: 'chain_reaction', bombCount: chainedBombCount + 1 });
  state.bombs = state.bombs.filter((bomb) => !bomb.exploded);
  for (const fire of state.fires) fire.remaining -= dt;
  state.fires = state.fires.filter((fire) => fire.remaining > 0);
  damagePlayers(state); collectBonuses(state); resolveRound(state);
}

export function togglePause(state) {
  if (state.phase === 'playing' || state.phase === 'countdown') {
    state.resumePhase = state.phase;
    state.phase = 'paused';
  } else if (state.phase === 'paused') state.phase = state.resumePhase ?? 'playing';
  return state.phase;
}

export function snapshot(state) {
  return { difficulty: state.difficulty, round: state.round, phase: state.phase, roundTime: state.roundTime, players: state.players.map(({ id, name, alive, wins }) => ({ id, name, alive, wins })) };
}
