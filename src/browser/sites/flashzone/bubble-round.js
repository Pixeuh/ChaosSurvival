export const BOARD_WIDTH = 480;
export const BOARD_HEIGHT = 600;
export const BUBBLE_RADIUS = 16;
export const COLUMN_COUNT = 13;
export const ROW_LIMIT = 24;
export const COLORS = 6;
const DX = BUBBLE_RADIUS * 2;
const DY = Math.sqrt(3) * BUBBLE_RADIUS;
const BASE_SHOT_SPEED = 430;
const SHOOTER = { x: BOARD_WIDTH / 2, y: BOARD_HEIGHT - 34 };
const LOSE_Y = BOARD_HEIGHT - 72;

export const BUBBLE_DIFFICULTIES = Object.freeze({
  facile: Object.freeze({
    id: 'facile', label: 'FACILE', colorCount: 3, initialRows: 4,
    missesBeforeRow: 8, speedMultiplier: 1,
    pattern: '0000111122200',
  }),
  moyen: Object.freeze({
    id: 'moyen', label: 'MOYEN', colorCount: 5, initialRows: 6,
    missesBeforeRow: 5, speedMultiplier: 1.2,
    pattern: '0001122233440',
  }),
  extreme: Object.freeze({
    id: 'extreme', label: 'EXTR\u00caME', colorCount: 6, initialRows: 8,
    missesBeforeRow: 3, speedMultiplier: 1.4,
    pattern: '0011223344550',
  }),
});

function initialRow(config, row) {
  return [...config.pattern].map((value, col) => {
    const base = Number(value);
    if (config.id === 'facile') return base;
    const offset = row % config.colorCount;
    const reversed = config.id === 'extreme' && row % 2 === 1;
    const source = reversed ? config.pattern.length - 1 - col : col;
    return (Number(config.pattern[source]) + offset) % config.colorCount;
  });
}

export function cellKey(row, col) {
  return `${row}:${col}`;
}

export function cellCenter(row, col) {
  return {
    x: BUBBLE_RADIUS + col * DX + (row % 2 ? BUBBLE_RADIUS : 0),
    y: 42 + row * DY,
  };
}

export function hexNeighbors(row, col) {
  const diagonalCols = row % 2 ? [col, col + 1] : [col - 1, col];
  return [
    [row, col - 1], [row, col + 1],
    [row - 1, diagonalCols[0]], [row - 1, diagonalCols[1]],
    [row + 1, diagonalCols[0]], [row + 1, diagonalCols[1]],
  ].filter(([r, c]) => r >= 0 && r < ROW_LIMIT && c >= 0 && c < COLUMN_COUNT);
}

export function connectedGroup(board, startKey) {
  if (!board.has(startKey)) return [];
  const [row, col] = startKey.split(':').map(Number);
  const found = new Set([startKey]);
  const queue = [[row, col]];
  for (let i = 0; i < queue.length; i++) {
    for (const [r, c] of hexNeighbors(...queue[i])) {
      const key = cellKey(r, c);
      if (board.has(key) && !found.has(key) && board.get(key) === board.get(startKey)) {
        found.add(key);
        queue.push([r, c]);
      }
    }
  }
  return [...found];
}

export function detachedCells(board) {
  const anchored = new Set();
  const queue = [];
  for (let col = 0; col < COLUMN_COUNT; col++) {
    const key = cellKey(0, col);
    if (board.has(key)) {
      anchored.add(key);
      queue.push([0, col]);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    for (const [row, col] of hexNeighbors(...queue[i])) {
      const key = cellKey(row, col);
      if (board.has(key) && !anchored.has(key)) {
        anchored.add(key);
        queue.push([row, col]);
      }
    }
  }
  return [...board.keys()].filter((key) => !anchored.has(key));
}

export class BubbleRound {
  constructor(random = Math.random, difficulty = 'moyen') {
    this.random = random;
    this.difficulty = BUBBLE_DIFFICULTIES[difficulty] ? difficulty : 'moyen';
    this.active = false;
  }

  start(difficulty = this.difficulty) {
    this.difficulty = BUBBLE_DIFFICULTIES[difficulty] ? difficulty : 'moyen';
    this.config = BUBBLE_DIFFICULTIES[this.difficulty];
    this.shotSpeed = BASE_SHOT_SPEED * this.config.speedMultiplier;
    this.active = true;
    this.status = 'playing';
    this.score = 0;
    this.board = new Map();
    this.projectile = null;
    this.shotsSinceClear = 0;
    this.aim = { x: 0, y: -1 };
    for (let row = 0; row < this.config.initialRows; row++) {
      initialRow(this.config, row).forEach((color, col) => this.board.set(cellKey(row, col), color));
    }
    this.currentColor = this.pickColor();
    this.nextColor = this.pickColor();
    this._checkBottom();
  }

  pickColor() {
    const colors = [...new Set(this.board.values())];
    if (!colors.length) return Math.floor(this.random() * this.config.colorCount);
    return colors[Math.floor(this.random() * colors.length)];
  }

  _refreshColors() {
    const colors = new Set(this.board.values());
    if (!colors.size) return;
    if (!colors.has(this.currentColor)) this.currentColor = this.pickColor();
    if (!colors.has(this.nextColor)) this.nextColor = this.pickColor();
  }

  setAim(x, y) {
    if (!this.active || this.projectile || !Number.isFinite(x) || !Number.isFinite(y)) return this.aim;
    const dx = x - SHOOTER.x;
    const dy = Math.min(-24, y - SHOOTER.y);
    const angle = Math.atan2(dy, dx);
    const maxAngle = Math.PI - 0.18;
    const clamped = Math.max(-maxAngle, Math.min(-0.18, angle));
    this.aim = { x: Math.cos(clamped), y: Math.sin(clamped) };
    return this.aim;
  }

  shoot() {
    if (!this.active || this.projectile || this.status !== 'playing') return false;
    this.projectile = {
      x: SHOOTER.x, y: SHOOTER.y,
      vx: this.aim.x * this.shotSpeed, vy: this.aim.y * this.shotSpeed,
      color: this.currentColor,
    };
    this.currentColor = this.nextColor;
    this.nextColor = this.pickColor();
    return true;
  }

  update(deltaSeconds) {
    if (!this.active || !this.projectile || this.status !== 'playing') return null;
    const dt = Math.max(0, Math.min(0.05, deltaSeconds));
    const speed = Math.hypot(this.projectile.vx, this.projectile.vy);
    const steps = Math.max(1, Math.ceil((speed * dt) / (BUBBLE_RADIUS * 0.45)));
    const step = dt / steps;
    for (let i = 0; i < steps && this.projectile; i++) {
      const p = this.projectile;
      p.x += p.vx * step;
      p.y += p.vy * step;
      if (p.x <= BUBBLE_RADIUS || p.x >= BOARD_WIDTH - BUBBLE_RADIUS) {
        p.x = Math.max(BUBBLE_RADIUS, Math.min(BOARD_WIDTH - BUBBLE_RADIUS, p.x));
        p.vx *= -1;
      }
      if (p.y <= 10) {
        this._attach(p, null);
        break;
      }
      const hit = this._collision(p);
      if (hit) {
        this._attach(p, hit);
        break;
      }
    }
    return this.status;
  }

  _collision(projectile) {
    const diameter = BUBBLE_RADIUS * 2;
    for (const key of this.board.keys()) {
      const [row, col] = key.split(':').map(Number);
      const center = cellCenter(row, col);
      if (Math.hypot(projectile.x - center.x, projectile.y - center.y) <= diameter - 1) return key;
    }
    return null;
  }

  _attach(projectile, hitKey) {
    const candidates = hitKey
      ? (() => {
          const [row, col] = hitKey.split(':').map(Number);
          return hexNeighbors(row, col).filter(([r, c]) => !this.board.has(cellKey(r, c)));
        })()
      : Array.from({ length: COLUMN_COUNT }, (_, col) => [0, col]).filter(([r, c]) => !this.board.has(cellKey(r, c)));
    candidates.sort((a, b) => {
      const ac = cellCenter(...a), bc = cellCenter(...b);
      return Math.hypot(projectile.x - ac.x, projectile.y - ac.y) - Math.hypot(projectile.x - bc.x, projectile.y - bc.y);
    });
    const placement = candidates[0];
    this.projectile = null;
    if (!placement) {
      this.status = 'lost';
      this.active = false;
      return;
    }
    const key = cellKey(...placement);
    this.board.set(key, projectile.color);
    const group = connectedGroup(this.board, key);
    let popped = false;
    if (group.length >= 3) {
      for (const groupKey of group) this.board.delete(groupKey);
      this.score += group.length * 10;
      const dropped = detachedCells(this.board);
      for (const detached of dropped) this.board.delete(detached);
      this.score += dropped.length * 15;
      this.shotsSinceClear = 0;
      popped = true;
    } else {
      this.shotsSinceClear++;
    }
    if (!this.board.size) {
      this.status = 'won';
      this.active = false;
      return;
    }
    if (!popped && this.shotsSinceClear >= this.config.missesBeforeRow) {
      this.shotsSinceClear = 0;
      this._addRow();
    }
    this._refreshColors();
    this._checkBottom();
    return this.status;
  }

  _addRow() {
    const shifted = new Map();
    for (const [key, color] of this.board) {
      const [row, col] = key.split(':').map(Number);
      shifted.set(cellKey(row + 1, col), color);
    }
    this.board = shifted;
    const available = [...new Set(this.board.values())];
    for (let col = 0; col < COLUMN_COUNT; col++) {
      const color = available[Math.floor(this.random() * available.length)];
      this.board.set(cellKey(0, col), color);
    }
    this._checkBottom();
  }

  _checkBottom() {
    for (const key of this.board.keys()) {
      const [row, col] = key.split(':').map(Number);
      if (cellCenter(row, col).y + BUBBLE_RADIUS >= LOSE_Y) {
        this.status = 'lost';
        this.active = false;
        return;
      }
    }
  }

  stop() {
    this.active = false;
    this.projectile = null;
    this.board?.clear();
  }
}

export function bestScore(progression, id) {
  const value = progression?.data.flashzone?.bestScores?.[id];
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function saveBestScore(progression, id, score) {
  const best = bestScore(progression, id);
  if (score > best && progression) {
    const saved = progression.data.flashzone;
    const scores = saved?.bestScores;
    progression.data.flashzone = {
      bestScores: {
        ...(scores && typeof scores === 'object' && !Array.isArray(scores) ? scores : {}),
        [id]: score,
      },
    };
    progression.save();
  }
  return Math.max(best, score);
}
