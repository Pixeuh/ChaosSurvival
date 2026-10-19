import { textElement as node } from '../../dom.js';
import { createGameMusic } from '../../../audio/game-music.js';

const plumberMusicUrl = new URL(
  '../../../../assets/moodmode-retro-game-arcade-236133.mp3',
  import.meta.url,
).href;
import {
  PLUMBER_GROUND,
  PLUMBER_GOAL_X,
  PLUMBER_HEIGHT,
  PLUMBER_LEVEL,
  PLUMBER_MAX_SPEED,
  PLUMBER_MINIMUM_TIME_MS,
  PLUMBER_WIDTH,
  TURBO_RECORD_MS,
  SuperPlombierRound,
  formatPlumberTime,
} from './super-plombier-round.js';

function markFirst(progression, flag) {
  if (progression.data.flags[flag]) return false;
  progression.data.flags[flag] = true;
  progression.save();
  return true;
}

export function renderSuperPlombierFlash({ progression, onDispose, onResume, onStart, onVictory }, game) {
  const root = node('section', undefined, 'super-plombier'),
    intro = node('div', undefined, 'plumber-intro'),
    play = node('button', 'JOUER', 'plumber-play');
  intro.append(
    node('h2', game.title),
    node('p', game.longDescription),
    node('p', 'Flèches ← → pour courir · Espace pour sauter.'),
    play,
  );
  const hud = node('div', undefined, 'plumber-hud'),
    timer = node('strong', '00:00,00'),
    coins = node('span', 'Pièces : 0'),
    restart = node('button', 'Recommencer', 'plumber-restart');
  hud.append(timer, coins, restart);
  const canvas = node('canvas', undefined, 'plumber-canvas');
  canvas.width = PLUMBER_WIDTH;
  canvas.height = PLUMBER_HEIGHT;
  canvas.tabIndex = 0;
  canvas.setAttribute(
    'aria-label',
    'Super Plombier Flash. Flèches gauche et droite pour courir, espace pour sauter.',
  );
  const status = node('p', undefined, 'plumber-status'),
    result = node('div', undefined, 'plumber-result'),
    final = node('strong'),
    replay = node('button', 'Rejouer', 'plumber-replay');
  result.append(node('h3', 'NIVEAU TERMINÉ !'), final, replay);
  root.append(intro, hud, canvas, status, result);
  hud.hidden = true;
  canvas.hidden = true;
  status.hidden = true;
  result.hidden = true;

  const context = canvas.getContext('2d');
  const round = new SuperPlombierRound();
  const music = createGameMusic(plumberMusicUrl);
  const pressed = new Set();
  let frame = null,
    disposed = false,
    paused = false,
    deathCount = 0,
    finished = false,
    developerVictory = false;
  root.finished = false;
  Object.defineProperty(root, 'running', {
    get: () => round.active && !paused && !disposed && !finished,
  });

  function rect(x, y, width, height, color) {
    context.fillStyle = color;
    context.fillRect(Math.floor(x), Math.floor(y), Math.ceil(width), Math.ceil(height));
  }
  function drawCloud(x, y) {
    rect(x + 10, y, 30, 10, '#fff');
    rect(x, y + 8, 54, 12, '#fff');
    rect(x + 17, y - 5, 22, 14, '#fff');
  }
  function drawPlayer() {
    const p = round.player,
      x = Math.floor(p.x - round.camera),
      y = Math.floor(p.y);
    rect(x + 3, y, 22, 8, '#c72c2c');
    rect(x + 7, y - 4, 17, 5, '#ec4840');
    rect(x + 18, y + 9, 3, 5, '#201a23');
    rect(x + 12, y + 16, 13, 5, '#513027');
    rect(x + 2, y + 8, 23, 13, '#f0bc7d');
    rect(x + 4, y + 18, 20, 5, '#302328');
    rect(x + 2, y + 22, 24, 13, '#c72c2c');
    rect(x + 5, y + 24, 7, 5, '#2766c5');
    rect(x + 18, y + 24, 5, 5, '#2766c5');
    rect(x, y + 33, 12, 5, '#55352c');
    rect(x + 16, y + 33, 12, 5, '#55352c');
  }
  function drawEnemy(enemy) {
    const x = Math.floor(enemy.x - round.camera),
      y = Math.floor(enemy.y);
    rect(x + 4, y + 13, 20, 16, '#e6bd8b');
    rect(x + 2, y + 6, 24, 11, '#b63b3b');
    rect(x + 6, y, 16, 8, '#d9554a');
    rect(x + 7, y + 6, 5, 5, '#fff4d7');
    rect(x + 18, y + 6, 5, 5, '#fff4d7');
    rect(x + 10, y + 17, 3, 4, '#211b25');
    rect(x + 17, y + 17, 3, 4, '#211b25');
    rect(x + 2, y + 27, 10, 3, '#472e2b');
    rect(x + 16, y + 27, 10, 3, '#472e2b');
  }
  function draw() {
    rect(0, 0, PLUMBER_WIDTH, PLUMBER_HEIGHT, '#65c7f2');
    for (let i = 0; i < 5; i++)
      drawCloud((((i * 173 - round.camera * 0.2) % 900) + 900) % 900 - 80, 45 + (i % 2) * 30);
    for (let i = 0; i < 5; i++) {
      const hillX = (((i * 188 - round.camera * 0.38) % 980) + 980) % 980 - 100;
      rect(hillX, 244, 100, 56, '#64b45b');
      rect(hillX + 18, 224, 66, 24, '#64b45b');
    }

    for (const solid of round.solids) {
      const x = solid.x - round.camera;
      if (x > PLUMBER_WIDTH || x + solid.w < 0) continue;
      if (solid.kind === 'ground') {
        rect(x, solid.y, solid.w, solid.h, '#9a5b32');
        rect(x, solid.y, solid.w, 8, '#5ac448');
        for (let tx = Math.max(0, Math.floor(x / 32) * 32 - x); tx < solid.w; tx += 32) {
          rect(x + tx, solid.y + 8, 2, solid.h - 8, '#693d2c');
          rect(x + tx + 16, solid.y + 8, 2, solid.h - 8, '#693d2c');
          rect(x + tx, solid.y + 30, 32, 2, '#693d2c');
        }
      } else if (solid.kind === 'pipe') {
        rect(x + 5, solid.y + 12, solid.w - 10, solid.h - 12, '#159843');
        rect(x, solid.y, solid.w, 15, '#31c354');
        rect(x + 7, solid.y + 16, 5, solid.h - 18, '#63df73');
        rect(x + 4, solid.y + 12, solid.w - 8, 4, '#087333');
      } else {
        rect(x, solid.y, solid.w, solid.h, solid.kind === 'bonus' ? '#ffbb35' : '#bb6842');
        rect(x + 2, solid.y + 2, solid.w - 4, solid.h - 4, solid.kind === 'bonus' ? '#f7d65b' : '#d58b57');
        for (let tx = 0; tx < solid.w; tx += 32) rect(x + tx, solid.y, 2, solid.h, '#79452f');
      }
    }

    for (const coin of round.coins) {
      if (coin.collected) continue;
      const x = Math.floor(coin.x - round.camera), y = Math.floor(coin.y);
      rect(x - 5, y - 9, 10, 18, '#e39a1e');
      rect(x - 3, y - 7, 6, 14, '#ffe25b');
      rect(x - 1, y - 5, 2, 10, '#fff1a2');
    }
    for (const enemy of round.enemies) if (enemy.alive) drawEnemy(enemy);

    const flagX = PLUMBER_GOAL_X - round.camera;
    rect(flagX, PLUMBER_GROUND - 126, 5, 126, '#e6e6d7');
    rect(flagX + 5, PLUMBER_GROUND - 126, 45, 25, '#ed4c43');
    rect(flagX + 5, PLUMBER_GROUND - 101, 30, 4, '#f9db51');
    rect(flagX - 8, PLUMBER_GROUND, 22, 6, '#f1e9c8');
    drawPlayer();
  }

  function start() {
    if (disposed) return;
    finished = false;
    developerVictory = false;
    root.finished = false;
    markFirst(progression, 'superPlombierFirstAttempt');
    onStart?.();
    paused = false;
    pressed.clear();
    round.begin(performance.now());
    music.stop();
    music.start();
    deathCount = round.deaths;
    intro.hidden = true;
    result.hidden = true;
    status.hidden = true;
    hud.hidden = false;
    canvas.hidden = false;
    draw();
    canvas.focus();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(loop);
  }
  function finish() {
    if (!round.won || finished) return false;
    finished = true;
    root.finished = true;
    music.stop();
    cancelAnimationFrame(frame);
    frame = null;
    result.hidden = false;
    final.textContent = developerVictory
      ? 'Victoire développeur — temps non enregistré'
      : `Ton temps : ${formatPlumberTime(round.elapsed)}`;
    markFirst(progression, 'superPlombierFirstCompletion');
    onVictory?.();
    result.scrollIntoView?.({ block: 'nearest' });
    return true;
  }
  function finishImmediately() {
    if (disposed || paused || finished || !round.active || round.won) return false;
    developerVictory = true;
    round.won = true;
    round.active = false;
    return finish();
  }
  function loop(now) {
    if (disposed || paused) return;
    if (!root.isConnected) {
      dispose();
      return;
    }
    round.tick(now, { left: pressed.has('ArrowLeft'), right: pressed.has('ArrowRight') });
    if (round.deaths !== deathCount) {
      deathCount = round.deaths;
      music.stop();
      music.start();
      status.textContent = 'Aïe ! Le niveau repart du début.';
      status.hidden = false;
    }
    timer.textContent = formatPlumberTime(round.elapsed);
    coins.textContent = `Pièces : ${round.coins.filter((coin) => coin.collected).length}`;
    draw();
    if (round.won) {
      finish();
      return;
    }
    frame = requestAnimationFrame(loop);
  }
  function pause() {
    if (paused || disposed) return;
    paused = true;
    music.pause();
    pressed.clear();
    round.pause(performance.now());
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }
  function resume() {
    if (!paused || disposed || document.hidden) return;
    round.resume(performance.now());
    paused = false;
    music.resume();
    if (round.active) frame = requestAnimationFrame(loop);
  }
  const keydown = (event) => {
    if (!round.active || paused || disposed) return;
    if (!['ArrowLeft', 'ArrowRight', 'Space'].includes(event.code)) return;
    event.preventDefault();
    if (event.repeat) return;
    pressed.add(event.code);
    if (event.code === 'Space') round.jump();
  };
  const keyup = (event) => {
    pressed.delete(event.code);
  };
  const blur = () => pressed.clear();
  const visibility = () => (document.hidden ? pause() : resume());
  function dispose(reason) {
    if (reason === 'pause') {
      pause();
      return;
    }
    if (disposed) return;
    pause();
    disposed = true;
    music.dispose();
    round.stop();
    canvas.removeEventListener('keydown', keydown);
    canvas.removeEventListener('keyup', keyup);
    canvas.removeEventListener('blur', blur);
    document.removeEventListener('visibilitychange', visibility);
  }

  canvas.addEventListener('keydown', keydown);
  canvas.addEventListener('keyup', keyup);
  canvas.addEventListener('blur', blur);
  document.addEventListener('visibilitychange', visibility);
  play.addEventListener('click', start);
  restart.addEventListener('click', start);
  replay.addEventListener('click', start);
  onDispose(dispose);
  onResume?.(resume);
  root.finish = finishImmediately;
  return root;
}

export const superPlombierRecordCheck = Object.freeze({
  minimumTimeMs: PLUMBER_MINIMUM_TIME_MS,
  maxSpeed: PLUMBER_MAX_SPEED,
  distance: PLUMBER_LEVEL.minimumHorizontalDistance,
  recordMs: TURBO_RECORD_MS,
});
