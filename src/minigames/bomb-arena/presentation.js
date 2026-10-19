import { PLAYER_PALETTES } from './player-colors.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const roundedRect = (ctx, x, y, w, h, radius) => {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath(); ctx.roundRect(x, y, w, h, r);
};

function drawFloorTile(ctx, x, y, size, ix, iy) {
  const alternate = (ix + iy) % 2 === 0;
  ctx.fillStyle = alternate ? '#6e9b79' : '#668e73'; ctx.fillRect(x, y, size, size);
  ctx.fillStyle = 'rgba(233,244,194,.16)'; ctx.fillRect(x + 2, y + 2, size - 4, 2);
  ctx.fillStyle = 'rgba(27,58,53,.2)'; ctx.fillRect(x + 2, y + size - 4, size - 4, 2);
  ctx.strokeStyle = 'rgba(39,76,64,.42)'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, size - 1, size - 1);
  const seed = (ix * 17 + iy * 31) % 7;
  if (seed === 0 || seed === 3) {
    ctx.fillStyle = 'rgba(239,230,160,.26)'; ctx.beginPath(); ctx.ellipse(x + size * .26, y + size * .68, size * .055, size * .025, -.5, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + size * .72, y + size * .27, size * .035, size * .02, .4, 0, Math.PI * 2); ctx.fill();
  }
}

function drawWall(ctx, x, y, size) {
  ctx.fillStyle = 'rgba(18,39,47,.35)'; ctx.fillRect(x + 4, y + size - 5, size - 3, 5);
  const gradient = ctx.createLinearGradient(x, y, x, y + size);
  gradient.addColorStop(0, '#c5c0a7'); gradient.addColorStop(.18, '#989886'); gradient.addColorStop(1, '#626c68');
  roundedRect(ctx, x + 3, y + 2, size - 6, size - 7, size * .1); ctx.fillStyle = gradient; ctx.fill();
  ctx.strokeStyle = '#485955'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = 'rgba(238,231,199,.65)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x + 7, y + 7); ctx.lineTo(x + size - 7, y + 7); ctx.stroke();
  ctx.strokeStyle = 'rgba(49,64,62,.55)'; ctx.beginPath(); ctx.moveTo(x + size * .5, y + 8); ctx.lineTo(x + size * .5, y + size * .46); ctx.moveTo(x + 7, y + size * .48); ctx.lineTo(x + size - 7, y + size * .48); ctx.stroke();
}

function drawCrate(ctx, x, y, size, variant = 0, alpha = 1, scale = 1) {
  ctx.save(); ctx.globalAlpha *= alpha;
  const inset = size * (1 - scale) / 2;
  x += inset; y += inset; size *= scale;
  ctx.fillStyle = 'rgba(32,38,29,.35)'; roundedRect(ctx, x + 5, y + size - 5, size - 7, 6, 4); ctx.fill();
  const base = variant % 2 ? '#9a6040' : '#b47a4c';
  const gradient = ctx.createLinearGradient(x, y, x + size, y + size);
  gradient.addColorStop(0, variant % 2 ? '#c18a59' : '#d5a06a'); gradient.addColorStop(1, base);
  roundedRect(ctx, x + 4, y + 3, size - 8, size - 8, 4); ctx.fillStyle = gradient; ctx.fill();
  ctx.strokeStyle = '#603e31'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = '#e0b67b'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  if (variant % 3 === 1) {
    ctx.beginPath(); ctx.moveTo(x + 10, y + 10); ctx.lineTo(x + size - 10, y + 10); ctx.moveTo(x + 10, y + size - 11); ctx.lineTo(x + size - 10, y + size - 11); ctx.stroke();
    ctx.fillStyle = '#704934'; ctx.fillRect(x + size * .43, y + size * .25, size * .14, size * .5);
  } else {
    ctx.beginPath(); ctx.moveTo(x + 8, y + 8); ctx.lineTo(x + size - 8, y + size - 8); ctx.moveTo(x + size - 8, y + 8); ctx.lineTo(x + 8, y + size - 8); ctx.stroke();
  }
  ctx.restore();
}

function drawCharacter(ctx, player, x, y, size, time, motion = {}) {
  const colors = PLAYER_PALETTES[player.id] ?? PLAYER_PALETTES.justme;
  const moving = motion.moving;
  const step = moving ? Math.sin(time / 72 + (player.id.length * .7)) : Math.sin(time / 380 + player.id.length) * .035;
  const bob = moving ? Math.abs(step) * size * .055 : Math.sin(time / 500 + player.id.length) * size * .018;
  const scale = size / 60;
  ctx.save(); ctx.translate(x, y + bob); ctx.scale(scale, scale);
  // Feet and shadow keep the character grounded without changing its collision size.
  ctx.fillStyle = 'rgba(28,43,37,.32)'; ctx.beginPath(); ctx.ellipse(0, 23, 19, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3f3437';
  ctx.beginPath(); ctx.ellipse(-9 + (moving ? step * 3 : 0), 18, 7, 5, -.18, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(9 - (moving ? step * 3 : 0), 18, 7, 5, .18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = colors[1]; roundedRect(ctx, -15, -5, 30, 25, 10); ctx.fill();
  const body = ctx.createLinearGradient(-12, -2, 13, 18); body.addColorStop(0, colors[2]); body.addColorStop(.3, colors[0]); body.addColorStop(1, colors[1]);
  ctx.fillStyle = body; roundedRect(ctx, -12, -4, 24, 23, 9); ctx.fill();
  // Headgear makes each participant distinct while sharing one coherent cartoon style.
  ctx.fillStyle = colors[0]; ctx.strokeStyle = colors[1]; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, -12, 18, 17, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.ellipse(-6, -20, 6, 3, -.4, 0, Math.PI * 2); ctx.fill();
  if (player.id === 'pixelgirl') {
    ctx.fillStyle = '#d94c92'; ctx.beginPath(); ctx.moveTo(-13, -23); ctx.lineTo(-22, -33); ctx.lineTo(-8, -29); ctx.fill();
    ctx.beginPath(); ctx.moveTo(13, -23); ctx.lineTo(22, -33); ctx.lineTo(8, -29); ctx.fill();
    ctx.fillStyle = '#ffe17e'; ctx.beginPath(); ctx.arc(0, -11, 4, 0, Math.PI * 2); ctx.fill();
  } else if (player.id === 'turbo') {
    ctx.fillStyle = '#fff0c6'; ctx.beginPath(); ctx.moveTo(-18, -21); ctx.lineTo(0, -34); ctx.lineTo(18, -21); ctx.closePath(); ctx.fill();
    ctx.fillStyle = colors[1]; ctx.fillRect(-2, -31, 4, 18);
  } else if (player.id === 'luna') {
    ctx.fillStyle = '#f1eaa8'; ctx.beginPath(); ctx.arc(0, -29, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(0, -29, 7, Math.PI * 1.05, Math.PI * 1.95); ctx.strokeStyle = '#eee5b4'; ctx.lineWidth = 2; ctx.stroke();
  } else {
    ctx.fillStyle = '#e6efda'; roundedRect(ctx, -12, -29, 24, 7, 3); ctx.fill();
    ctx.fillStyle = '#4c8a49'; ctx.fillRect(-2, -28, 4, 5);
  }
  ctx.fillStyle = '#293442';
  const glance = motion.direction === 'left' ? -2 : motion.direction === 'right' ? 2 : 0;
  ctx.beginPath(); ctx.ellipse(-6 + glance, -12, 2.1, 3.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(6 + glance, -12, 2.1, 3.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#813d4c'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, -6, 4, .2, Math.PI - .2); ctx.stroke();
  if (player.shields) { ctx.strokeStyle = 'rgba(188,239,255,.88)'; ctx.lineWidth = 2.3; ctx.beginPath(); ctx.ellipse(0, -5, 24, 33, 0, 0, Math.PI * 2); ctx.stroke(); }
  if (motion.celebrate || motion.poseBomb) { ctx.strokeStyle = colors[1]; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-15, 1); ctx.lineTo(-24, motion.poseBomb ? -2 : -9 - Math.abs(step) * 5); ctx.moveTo(15, 1); ctx.lineTo(24, motion.poseBomb ? -2 : -9 - Math.abs(step) * 5); ctx.stroke(); }
  ctx.restore();
}

function drawBomb(ctx, bomb, x, y, size, time) {
  const urgency = clamp(1 - bomb.fuse / 2000, 0, 1);
  const pulse = 1 + Math.sin(time / (145 - urgency * 90)) * (.025 + urgency * .075);
  ctx.save(); ctx.translate(x, y); ctx.scale(pulse, pulse);
  ctx.fillStyle = 'rgba(18,28,35,.38)'; ctx.beginPath(); ctx.ellipse(1, size * .28, size * .33, size * .13, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createRadialGradient(-size * .13, -size * .16, size * .03, 0, 0, size * .43);
  g.addColorStop(0, '#6f777d'); g.addColorStop(.24, '#313a43'); g.addColorStop(1, '#101820');
  ctx.fillStyle = g; ctx.strokeStyle = '#0a1014'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, size * .34, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#332b27'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(size * .12, -size * .28); ctx.quadraticCurveTo(size * .19, -size * .48, size * .31, -size * .42); ctx.stroke();
  ctx.fillStyle = urgency > .66 && Math.floor(time / 90) % 2 ? '#ff473e' : '#ffc44d'; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 7;
  ctx.beginPath(); ctx.arc(size * .32, -size * .42, size * .07, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  ctx.restore();
}

function drawBonus(ctx, bonus, x, y, size, time) {
  const colors = { flame: ['#f79635', '#c63225'], bomb: ['#475767', '#1b2936'], speed: ['#8cd64c', '#397535'], shield: ['#8dd8ef', '#3974a5'] };
  const [fill, edge] = colors[bonus.type] ?? colors.flame;
  const bob = Math.sin(time / 350 + bonus.x * 1.7 + bonus.y) * size * .055;
  ctx.save(); ctx.translate(x, y + bob); ctx.fillStyle = 'rgba(16,31,36,.32)'; ctx.beginPath(); ctx.ellipse(0, size * .32, size * .25, size * .09, 0, 0, Math.PI * 2); ctx.fill();
  const radius = size * .28; ctx.fillStyle = '#fff4c9'; ctx.strokeStyle = edge; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = fill; ctx.strokeStyle = edge; ctx.lineWidth = 1.5;
  if (bonus.type === 'flame') { ctx.beginPath(); ctx.moveTo(0, -radius * .68); ctx.bezierCurveTo(-radius * .2, -radius * .18, -radius * .67, -radius * .1, -radius * .2, radius * .48); ctx.bezierCurveTo(-radius * .08, radius * .68, radius * .45, radius * .54, radius * .42, radius * .18); ctx.bezierCurveTo(radius * .68, -radius * .2, radius * .25, -radius * .42, 0, -radius * .68); ctx.fill(); }
  else if (bonus.type === 'bomb') { ctx.beginPath(); ctx.arc(0, radius * .08, radius * .48, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(radius * .05, -radius * .35); ctx.lineTo(radius * .28, -radius * .62); ctx.stroke(); ctx.fillStyle = '#d95136'; ctx.beginPath(); ctx.arc(radius * .32, -radius * .61, radius * .1, 0, Math.PI * 2); ctx.fill(); }
  else if (bonus.type === 'speed') { ctx.beginPath(); ctx.moveTo(-radius * .52, -radius * .03); ctx.lineTo(-radius * .04, -radius * .03); ctx.lineTo(-radius * .16, -radius * .55); ctx.lineTo(radius * .55, radius * .05); ctx.lineTo(radius * .08, radius * .03); ctx.lineTo(radius * .19, radius * .52); ctx.closePath(); ctx.fill(); }
  else { ctx.beginPath(); ctx.moveTo(0, -radius * .62); ctx.lineTo(radius * .47, -radius * .38); ctx.lineTo(radius * .4, radius * .22); ctx.lineTo(0, radius * .62); ctx.lineTo(-radius * .4, radius * .22); ctx.lineTo(-radius * .47, -radius * .38); ctx.closePath(); ctx.fill(); }
  ctx.restore();
}

export function renderCharacterRoster(ctx, canvas, time = 0) {
  if (!ctx || !canvas) return;
  const players = [
    { id: 'justme', name: 'JustMe', color: PLAYER_PALETTES.justme[0], shields: 0 },
    { id: 'pixelgirl', name: 'PixelGirl', color: PLAYER_PALETTES.pixelgirl[0], shields: 0 },
    { id: 'turbo', name: 'Turbo', color: PLAYER_PALETTES.turbo[0], shields: 0 },
    { id: 'luna', name: 'Luna', color: PLAYER_PALETTES.luna[0], shields: 0 },
  ];
  const width = canvas.width, height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  const step = width / 4;
  players.forEach((player, index) => {
    const x = step * (index + .5), y = height * .52;
    drawCharacter(ctx, player, x, y, Math.min(65, height * .72), time, { moving: false, direction: 'front' });
    ctx.fillStyle = '#f5f5dc'; ctx.font = 'bold 11px Tahoma'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(player.name.toUpperCase(), x, height - 8);
  });
}

export function createArenaEffects({ onSound = () => {}, rng = Math.random } = {}) {
  let previous = null;
  const particles = [];
  const defeated = new Map(), poses = new Map(), motion = new Map();
  const addParticles = (x, y, count, color, kind = 'spark') => {
    for (let i = 0; i < count && particles.length < 220; i++) {
      const angle = rng() * Math.PI * 2, speed = 25 + rng() * 100;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 22, life: 350 + rng() * 350, max: 700, color, kind });
    }
  };
  return {
    particles,
    observe(game, dt = 16, now = 0) {
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]; p.life -= dt; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.vy += 85 * dt / 1000;
        if (p.life <= 0) particles.splice(i, 1);
      }
      const current = {
        bombs: new Set(game.bombs.map((bomb) => bomb.id)),
        fires: new Set(game.fires.map((fire) => `${fire.at}:${fire.owner}:${fire.cells[0]?.x},${fire.cells[0]?.y}`)),
        blocks: new Set(game.blocks),
        bonuses: new Set(game.bonuses.map((bonus) => `${bonus.x},${bonus.y},${bonus.type}`)),
        alive: new Map(game.players.map((player) => [player.id, player.alive])),
        positions: new Map(game.players.map((player) => [player.id, { x: player.x, y: player.y }])),
        phase: game.phase,
        roundTime: game.roundTime,
        round: game.round,
      };
      const newRound = previous && current.round !== previous.round;
      if (newRound) { particles.length = 0; defeated.clear(); poses.clear(); }
      if (previous && !newRound) {
        const placed = [...current.bombs].filter((id) => !previous.bombs.has(id));
        if (placed.length) {
          onSound('bomb');
          for (const bomb of game.bombs.filter((item) => placed.includes(item.id))) poses.set(bomb.owner, now + 240);
        }
        const exploded = [...previous.bombs].some((id) => !current.bombs.has(id));
        if (exploded) onSound('explosion');
        const destroyed = [...previous.blocks].filter((cell) => !current.blocks.has(cell));
        if (destroyed.length) {
          onSound('block');
          for (const cell of destroyed) { const [x, y] = cell.split(',').map(Number); addParticles(x + .5, y + .5, 8, '#c9945c', 'wood'); }
        }
        const collected = [...previous.bonuses].filter((id) => !current.bonuses.has(id));
        if (collected.length) { onSound('bonus'); for (const id of collected) { const [x, y] = id.split(',').map(Number); addParticles(x + .5, y + .5, 7, '#ffeb7a'); } }
        const eliminated = [...current.alive].some(([id, alive]) => alive === false && previous.alive.get(id) === true);
        if (eliminated) {
          onSound('elimination');
          for (const player of game.players.filter((p) => !p.alive && previous.alive.get(p.id))) {
            defeated.set(player.id, { player: { ...player }, x: previous.positions.get(player.id)?.x ?? player.x, y: previous.positions.get(player.id)?.y ?? player.y, until: now + 420 });
          addParticles(player.x, player.y, 12, PLAYER_PALETTES[player.id]?.[0] ?? '#fff', 'poof');
          }
        }
        if (previous.roundTime < 90000 && game.roundTime >= 90000) onSound('sudden');
        if (previous.phase !== game.phase) {
          if (game.phase === 'playing') onSound('round');
          else if (game.phase === 'round-end') onSound(game.players[0]?.alive ? 'victory' : 'defeat');
          else if (game.phase === 'match-end') onSound('champion');
        }
      }
      for (const player of game.players) {
        const before = previous?.positions.get(player.id), dx = before ? player.x - before.x : 0, dy = before ? player.y - before.y : 0;
        const moving = Math.hypot(dx, dy) > .001;
        motion.set(player.id, { moving, direction: Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down' });
      }
      for (const [id, item] of defeated) if (item.until <= now) defeated.delete(id);
      previous = current;
    },
    motion(playerId) { return motion.get(playerId) ?? { moving: false, direction: 'down' }; },
    defeated,
    poses,
    reset() { previous = null; particles.length = 0; defeated.clear(); poses.clear(); motion.clear(); },
  };
}

export function renderBombArena(ctx, canvas, game, effects, time = 0) {
  if (!ctx || !game) return;
  const w = canvas.width, h = canvas.height, cell = Math.min(w / 13, h / 11), ox = (w - cell * 13) / 2, oy = (h - cell * 11) / 2;
  ctx.clearRect(0, 0, w, h);
  const bg = ctx.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#1c3542'); bg.addColorStop(1, '#10252f'); ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,.34)'; ctx.fillRect(ox - 5, oy - 3, cell * 13 + 10, cell * 11 + 10);
  for (let y = 0; y < 11; y++) for (let x = 0; x < 13; x++) {
    const px = ox + x * cell, py = oy + y * cell; drawFloorTile(ctx, px, py, cell, x, y);
    if (game.arena[y][x] === 'wall') drawWall(ctx, px, py, cell);
  }
  for (const tile of game.blocks) { const [x, y] = tile.split(',').map(Number); drawCrate(ctx, ox + x * cell, oy + y * cell, cell, (x * 7 + y * 3) % 4); }
  for (const bonus of game.bonuses) drawBonus(ctx, bonus, ox + (bonus.x + .5) * cell, oy + (bonus.y + .5) * cell, cell, time);
  for (const bomb of game.bombs) drawBomb(ctx, bomb, ox + (bomb.x + .5) * cell, oy + (bomb.y + .5) * cell, cell, time);
  for (const fire of game.fires) for (const tile of fire.cells) {
    const progress = clamp(fire.remaining / 560, 0, 1), expand = .78 + Math.sin((1 - progress) * Math.PI) * .14;
    const px = ox + tile.x * cell, py = oy + tile.y * cell;
    const gradient = ctx.createRadialGradient(px + cell / 2, py + cell / 2, 1, px + cell / 2, py + cell / 2, cell * .58);
    gradient.addColorStop(0, 'rgba(255,255,226,.98)'); gradient.addColorStop(.23, 'rgba(255,229,97,.97)'); gradient.addColorStop(.62, 'rgba(255,124,39,.92)'); gradient.addColorStop(1, 'rgba(233,47,31,0)');
    ctx.save(); ctx.globalAlpha = Math.min(1, progress * 4 + .15); ctx.translate(px + cell / 2, py + cell / 2); ctx.scale(expand, expand); ctx.fillStyle = gradient;
    ctx.beginPath(); ctx.ellipse(0, 0, cell * .54, cell * .48, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 3; i++) { const angle = (time / 130 + i * 2.1 + tile.x * .4) % (Math.PI * 2); ctx.fillStyle = i === 0 ? '#fff7c8' : '#ff9a37'; ctx.beginPath(); ctx.ellipse(Math.cos(angle) * cell * .12, Math.sin(angle) * cell * .13, cell * .055, cell * .1, angle, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  for (const player of game.players) {
    if (!player.alive) continue;
    const x = ox + player.x * cell, y = oy + player.y * cell;
    const celebrate = game.phase === 'round-end' && game.players.filter((item) => item.alive).length === 1;
    const movement = effects?.motion(player.id) ?? { moving: false, direction: 'down' };
    drawCharacter(ctx, player, x, y, cell * .83, time, { ...movement, poseBomb: (effects?.poses.get(player.id) ?? 0) > time, celebrate });
    if (player.id === 'justme') { ctx.fillStyle = '#143343'; roundedRect(ctx, x - 12, y + cell * .36, 24, 12, 4); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(8, cell * .14)}px Tahoma`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('YOU', x, y + cell * .36 + 6); }
  }
  for (const { player, x: playerX, y: playerY, until } of effects?.defeated?.values?.() ?? []) {
    const alpha = clamp((until - time) / 420, 0, 1);
    ctx.save(); ctx.globalAlpha = alpha;
    drawCharacter(ctx, player, ox + playerX * cell, oy + playerY * cell, cell * .83, time, { celebrate: false, moving: false });
    ctx.restore();
  }
  for (const p of effects?.particles ?? []) {
    const alpha = clamp(p.life / p.max, 0, 1), x = ox + p.x * cell, y = oy + p.y * cell;
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
    if (p.kind === 'wood') drawCrate(ctx, x - cell * .11, y - cell * .1, cell * .22, 1, alpha, .8);
    else { ctx.shadowColor = p.color; ctx.shadowBlur = p.kind === 'poof' ? 7 : 4; ctx.beginPath(); ctx.arc(x, y, cell * (p.kind === 'poof' ? .055 : .035) * alpha, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(230,241,191,.8)'; ctx.lineWidth = 2; ctx.strokeRect(ox - 1, oy - 1, cell * 13 + 2, cell * 11 + 2);
}
