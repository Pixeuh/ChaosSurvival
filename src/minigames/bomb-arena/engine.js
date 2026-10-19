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
export const PLAYER_COLLISION_RADIUS = 0.27;
const BOMB_COLLISION_HALF_SIZE = 0.38;
const WALL_COLLIDER = Object.freeze({ left: 2 / 60, top: 1 / 60, right: 1 - 2 / 60, bottom: 1 - 4 / 60 });
const CRATE_COLLIDER = Object.freeze({ left: 3 / 60, top: 2 / 60, right: 1 - 3 / 60, bottom: 1 - 4 / 60 });
const COLLISION_EPSILON = 1e-10;
const key = (x, y) => `${x},${y}`;
const rand = (rng) => Math.max(0, Math.min(0.999999, rng()));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function arenaCellAt(x, y) {
  return { x: Math.floor(x), y: Math.floor(y) };
}

function cellCenter(x, y) {
  return { x: x + 0.5, y: y + 0.5 };
}

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
  const state = { difficulty: 'PRO', rng, round: completedRounds, wins, phase: 'ready', roundTime: 0, suddenIndex: 0, suddenClock: 0, seed: 0, message: '', messageMs: 0, matchWinnerId: null, lastMovementBlock: null };
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
  state.players = PLAYER_INFO.map((info, i) => {
    const position = cellCenter(...SPAWNS[i]);
    return { ...info, ...position, alive: true, wins: state.wins[info.id], capacity: 1, range: 2, speed: 3.15, shields: 0, bombIds: new Set(), escapeBombs: new Set(), controls: {}, think: 0, route: [], target: null, anim: 0 };
  });
  emit(state, { type: 'round_started' });
}

function wallAt(state, x, y) {
  return x < 0 || y < 0 || x >= ARENA_WIDTH || y >= ARENA_HEIGHT || state.arena?.[y]?.[x] === 'wall' || state.blocks.has(key(x, y));
}
function bombAt(state, x, y) { return state.bombs.find((b) => !b.exploded && b.x === x && b.y === y); }

function obstacleCollider(state, x, y) {
  if (x < 0 || y < 0 || x >= ARENA_WIDTH || y >= ARENA_HEIGHT) return null;
  const isWall = state.arena?.[y]?.[x] === 'wall';
  const isCrate = state.blocks.has(key(x, y));
  if (!isWall && !isCrate) return null;
  const shape = isWall ? WALL_COLLIDER : CRATE_COLLIDER;
  return {
    type: isWall ? 'wall' : 'crate', x, y,
    left: x + shape.left, top: y + shape.top,
    right: x + shape.right, bottom: y + shape.bottom,
    cornerRadius: isWall ? 0.1 + 1 / 60 : 5 / 60,
  };
}

function circleOverlapsRect(x, y, radius, left, top, right, bottom) {
  const nearestX = clamp(x, left, right), nearestY = clamp(y, top, bottom);
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 < radius ** 2 - COLLISION_EPSILON;
}

function circleOverlapsRoundedRect(x, y, radius, rect) {
  const halfWidth = (rect.right - rect.left) / 2;
  const halfHeight = (rect.bottom - rect.top) / 2;
  const corner = Math.min(rect.cornerRadius ?? 0, halfWidth, halfHeight);
  const dx = Math.abs(x - (rect.left + rect.right) / 2) - (halfWidth - corner);
  const dy = Math.abs(y - (rect.top + rect.bottom) / 2) - (halfHeight - corner);
  const signedDistance = Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - corner;
  return signedDistance < radius - COLLISION_EPSILON;
}

function cellsOverlappingCircle(x, y, radius) {
  const cells = [];
  for (let cy = Math.floor(y - radius); cy <= Math.floor(y + radius); cy++) {
    for (let cx = Math.floor(x - radius); cx <= Math.floor(x + radius); cx++) {
      if (circleOverlapsRect(x, y, radius, cx, cy, cx + 1, cy + 1)) cells.push({ x: cx, y: cy });
    }
  }
  return cells;
}

function movementBlocker(state, player, x, y) {
  for (const { x: cx, y: cy } of cellsOverlappingCircle(x, y, PLAYER_COLLISION_RADIUS)) {
    const obstacle = obstacleCollider(state, cx, cy);
    if (obstacle && circleOverlapsRoundedRect(x, y, PLAYER_COLLISION_RADIUS, obstacle)) return obstacle;
    const bomb = bombAt(state, cx, cy);
    if (bomb && !player.escapeBombs.has(bomb.id) && circleOverlapsRect(
      x, y, PLAYER_COLLISION_RADIUS,
      cx + 0.5 - BOMB_COLLISION_HALF_SIZE,
      cy + 0.5 - BOMB_COLLISION_HALF_SIZE,
      cx + 0.5 + BOMB_COLLISION_HALF_SIZE,
      cy + 0.5 + BOMB_COLLISION_HALF_SIZE,
    )) return { type: 'bomb', id: bomb.id, x: cx, y: cy,
      left: cx + 0.5 - BOMB_COLLISION_HALF_SIZE, top: cy + 0.5 - BOMB_COLLISION_HALF_SIZE,
      right: cx + 0.5 + BOMB_COLLISION_HALF_SIZE, bottom: cy + 0.5 + BOMB_COLLISION_HALF_SIZE };
  }
  return null;
}

function canOccupy(state, player, x, y) {
  return !movementBlocker(state, player, x, y);
}

export function getCollisionDebugData(state) {
  if (!state) return { obstacles: [], players: [], bombs: [], explosions: [], lastMovementBlock: null };
  const obstacles = [];
  for (let y = 0; y < ARENA_HEIGHT; y++) for (let x = 0; x < ARENA_WIDTH; x++) {
    const shape = obstacleCollider(state, x, y);
    if (shape) obstacles.push(shape);
  }
  return {
    obstacles,
    players: (state.players ?? []).filter((player) => player.alive).map((player) => ({
      id: player.id, x: player.x, y: player.y, radius: PLAYER_COLLISION_RADIUS,
    })),
    bombs: (state.bombs ?? []).filter((bomb) => !bomb.exploded).map((bomb) => ({
      id: bomb.id, x: bomb.x, y: bomb.y, halfSize: BOMB_COLLISION_HALF_SIZE,
    })),
    explosions: (state.fires ?? []).flatMap((fire) => fire.cells.map((cell) => ({
      owner: fire.owner, x: cell.x, y: cell.y, width: 1, height: 1,
    }))),
    lastMovementBlock: state.lastMovementBlock ?? null,
  };
}

export function setPlayerControls(state, controls = {}) {
  const player = state?.players?.[0];
  if (player) player.controls = { up: Boolean(controls.up), down: Boolean(controls.down), left: Boolean(controls.left), right: Boolean(controls.right) };
}

export function placeBomb(state, player) {
  if (!player?.alive || player.bombIds.size >= player.capacity) return false;
  const { x: cellX, y: cellY } = arenaCellAt(player.x, player.y);
  const x = clamp(cellX, 1, ARENA_WIDTH - 2), y = clamp(cellY, 1, ARENA_HEIGHT - 2);
  if (wallAt(state, x, y) || bombAt(state, x, y)) return false;
  const bomb = { id: `${player.id}-${state.round}-${state.seed++}`, x, y, owner: player.id, range: player.range, fuse: 2000, exploded: false };
  state.bombs.push(bomb); player.bombIds.add(bomb.id); player.escapeBombs.add(bomb.id);
  for (const occupant of state.players) {
    const cell = arenaCellAt(occupant.x, occupant.y);
    if (occupant.alive && cell.x === x && cell.y === y) occupant.escapeBombs.add(bomb.id);
  }
  return true;
}

function blastCells(state, bomb, blockingBlocks = state.blocks) {
  const cells = [{ x: bomb.x, y: bomb.y }];
  for (const [dx, dy] of DIRECTIONS) for (let n = 1; n <= bomb.range; n++) {
    const x = bomb.x + dx * n, y = bomb.y + dy * n;
    if (x < 0 || y < 0 || x >= ARENA_WIDTH || y >= ARENA_HEIGHT || state.arena[y][x] === 'wall') break;
    cells.push({ x, y });
    if (blockingBlocks.has(key(x, y))) break;
  }
  return cells;
}

function explode(state, bomb, now, blockingBlocks = state.blocks) {
  if (bomb.exploded) return [];
  bomb.exploded = true;
  const cells = blastCells(state, bomb, blockingBlocks);
  for (const cell of cells) {
    const id = key(cell.x, cell.y);
    if (state.blocks.delete(id) && rand(state.rng) < 0.34) state.bonuses.push({ x: cell.x, y: cell.y, type: BONUS_TYPES[Math.floor(rand(state.rng) * BONUS_TYPES.length)] });
    const chain = bombAt(state, cell.x, cell.y);
    if (chain && chain !== bomb) chain.fuse = Math.min(chain.fuse, 0);
  }
  state.fires.push({ cells, remaining: 560, owner: bomb.owner, at: now, bornAfterMovement: Boolean(state.movementPhase) });
  const owner = state.players.find((p) => p.id === bomb.owner);
  owner?.bombIds.delete(bomb.id);
  for (const player of state.players) player.escapeBombs.delete(bomb.id);
  return cells;
}

function damagePlayers(state) {
  for (const player of state.players) {
    if (!player.alive) continue;
    if (player.invulnerable > 0) continue;
    const hits = state.fires.filter((fire) => {
      const activeFraction = fire.bornAfterMovement ? 1 : clamp(fire.remaining / (state.stepDuration || 1), 0, 1);
      return fire.cells.some((cell) => {
        const contact = fire.bornAfterMovement
          ? circleOverlapsRect(player.x, player.y, PLAYER_COLLISION_RADIUS, cell.x, cell.y, cell.x + 1, cell.y + 1) ? 1 : null
          : earliestPathContact(player.motionPath, cell, PLAYER_COLLISION_RADIUS);
        return contact !== null && contact <= activeFraction + COLLISION_EPSILON;
      });
    });
    if (!hits.length) continue;
    if (player.shields > 0) {
      player.shields--;
      player.invulnerable = 700;
      continue;
    }
    player.alive = false;
    const owners = [...new Set(hits.map((fire) => fire.owner).filter(Boolean))];
    const eliminatedBy = owners.length === 1 ? owners[0] : null;
    emit(state, {
      type: 'player_eliminated', playerId: player.id, eliminatedBy,
      cause: eliminatedBy === player.id ? 'self' : eliminatedBy ? 'bomb' : 'unknown',
    });
  }
}

function collectBonuses(state) {
  for (const player of state.players) {
    if (!player.alive) continue;
    const cell = arenaCellAt(player.x, player.y);
    const i = state.bonuses.findIndex((b) => b.x === cell.x && b.y === cell.y);
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

function earliestPathContact(path, cell, radius) {
  const { x, y } = cell;
  const left = x, right = x + 1, top = y, bottom = y + 1;
  let earliest = null;
  for (const { from, to, t0 = 0, t1 = 1 } of path ?? []) {
    if (circleOverlapsRect(from.x, from.y, radius, left, top, right, bottom)) {
      earliest = Math.min(earliest ?? 1, t0);
      continue;
    }
    let min, max, start, delta;
    if (Math.abs(to.y - from.y) <= COLLISION_EPSILON) {
      const fixed = from.y;
      if (fixed <= top - radius || fixed >= bottom + radius) continue;
      let reach = radius;
      if (fixed < top) reach = Math.sqrt(Math.max(0, radius ** 2 - (top - fixed) ** 2));
      else if (fixed > bottom) reach = Math.sqrt(Math.max(0, radius ** 2 - (fixed - bottom) ** 2));
      min = left - reach; max = right + reach; start = from.x; delta = to.x - from.x;
    } else if (Math.abs(to.x - from.x) <= COLLISION_EPSILON) {
      const fixed = from.x;
      if (fixed <= left - radius || fixed >= right + radius) continue;
      let reach = radius;
      if (fixed < left) reach = Math.sqrt(Math.max(0, radius ** 2 - (left - fixed) ** 2));
      else if (fixed > right) reach = Math.sqrt(Math.max(0, radius ** 2 - (fixed - right) ** 2));
      min = top - reach; max = bottom + reach; start = from.y; delta = to.y - from.y;
    } else {
      // Movement is resolved one axis at a time. Treat an unexpected diagonal
      // segment conservatively so future callers cannot reintroduce tunnelling.
      const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / (radius / 4)));
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const px = from.x + (to.x - from.x) * t, py = from.y + (to.y - from.y) * t;
        if (circleOverlapsRect(px, py, radius, left, top, right, bottom)) {
          earliest = Math.min(earliest ?? 1, t0 + t * (t1 - t0));
          break;
        }
      }
      continue;
    }
    if (Math.abs(delta) <= COLLISION_EPSILON) continue;
    const a = (min - start) / delta, b = (max - start) / delta;
    const entry = Math.max(0, Math.min(a, b));
    const exit = Math.min(1, Math.max(a, b));
    if (entry <= exit + COLLISION_EPSILON) {
      const contact = t0 + entry * (t1 - t0);
      earliest = Math.min(earliest ?? 1, contact);
    }
  }
  return earliest;
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
  const config = DIFFICULTIES[state.difficulty], danger = dangerCells(state), start = arenaCellAt(player.x, player.y);
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
  const path = [];
  player.motionPath = path;
  let timeCursor = 0;
  const remember = (fromX, fromY, t0, t1) => path.push({ from: { x: fromX, y: fromY }, to: { x: player.x, y: player.y }, t0, t1 });
  const moveAxis = (axis, amount, timeShare) => {
    if (!amount) { timeCursor += timeShare; return; }
    const maxStep = PLAYER_COLLISION_RADIUS / 2;
    const steps = Math.max(1, Math.ceil(Math.abs(amount) / maxStep));
    const step = amount / steps;
    for (let index = 0; index < steps; index++) {
      const fromX = player.x, fromY = player.y;
      const t0 = timeCursor + timeShare * index / steps;
      const t1 = timeCursor + timeShare * (index + 1) / steps;
      const x = axis === 'x' ? player.x + step : player.x;
      const y = axis === 'y' ? player.y + step : player.y;
      if (!canOccupy(state, player, x, y)) {
        const blocker = movementBlocker(state, player, x, y);
        state.lastMovementBlock = {
          playerId: player.id,
          attempted: { x, y },
          blocker: blocker ? { type: blocker.type, x: blocker.x, y: blocker.y, id: blocker.id ?? null } : null,
        };
        let low = 0, high = 1;
        for (let attempt = 0; attempt < 12; attempt++) {
          const fraction = (low + high) / 2;
          const testX = axis === 'x' ? fromX + step * fraction : fromX;
          const testY = axis === 'y' ? fromY + step * fraction : fromY;
          if (canOccupy(state, player, testX, testY)) low = fraction;
          else high = fraction;
        }
        if (low > COLLISION_EPSILON) {
          player.x = axis === 'x' ? fromX + step * low : fromX;
          player.y = axis === 'y' ? fromY + step * low : fromY;
          remember(fromX, fromY, t0, t0 + (t1 - t0) * low);
        }
        remember(player.x, player.y, t0 + (t1 - t0) * low, timeCursor + timeShare);
        timeCursor += timeShare;
        return;
      }
      player.x = x; player.y = y;
      remember(fromX, fromY, t0, t1);
    }
    timeCursor += timeShare;
  };
  let { up = false, down = false, left = false, right = false } = player.controls ?? {};
  if (!player.human) {
    aiDecision(state, player, dt);
    const target = player.route[0];
    left = right = up = down = false;
    if (target) {
      const { x: tx, y: ty } = cellCenter(target.x, target.y);
      if (Math.abs(tx - player.x) < 0.07 && Math.abs(ty - player.y) < 0.07) { player.x = tx; player.y = ty; player.route.shift(); }
      else { left = tx < player.x - .025; right = tx > player.x + .025; up = ty < player.y - .025; down = ty > player.y + .025; }
    }
  }
  let dx = Number(right) - Number(left), dy = Number(down) - Number(up);
  const magnitude = Math.hypot(dx, dy) || 1; dx /= magnitude; dy /= magnitude;
  const distance = player.speed * dt / 1000;
  const startX = player.x, startY = player.y;
  const axisMagnitude = Math.abs(dx) + Math.abs(dy) || 1;
  moveAxis('x', dx * distance, Math.abs(dx) / axisMagnitude);
  moveAxis('y', dy * distance, Math.abs(dy) / axisMagnitude);
  if (!path.length) remember(startX, startY, 0, 1);
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
  state.stepDuration = dt;
  state.movementPhase = false;
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
        for (const player of state.players) if (player.alive && circleOverlapsRect(
          player.x, player.y, PLAYER_COLLISION_RADIUS, x, y, x + 1, y + 1,
        )) {
          player.alive = false;
          emit(state, { type: 'player_eliminated', playerId: player.id, eliminatedBy: null, cause: 'sudden-death' });
        }
      }
    }
  }
  for (const player of state.players) if (player.invulnerable > 0) player.invulnerable -= dt;
  for (const player of state.players) if (player.human && player.controls?.bomb) { placeBomb(state, player); player.controls.bomb = false; }
  for (const player of state.players) movePlayer(state, player, dt);
  state.movementPhase = true;
  for (const bomb of state.bombs) bomb.fuse -= dt;
  const queue = state.bombs.filter((b) => b.fuse <= 0 && !b.exploded);
  const blastBlockers = new Set(state.blocks);
  const chainedBombs = new Set();
  let chainedBombCount = 0;
  while (queue.length) {
    const bomb = queue.shift(); if (bomb.exploded) continue;
    const cells = explode(state, bomb, state.roundTime, blastBlockers);
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
  damagePlayers(state);
  for (const fire of state.fires) {
    fire.remaining -= dt;
    fire.bornAfterMovement = false;
  }
  state.fires = state.fires.filter((fire) => fire.remaining > 0);
  state.movementPhase = false;
  collectBonuses(state); resolveRound(state);
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
