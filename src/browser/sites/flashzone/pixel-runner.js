import { textElement as node } from '../../dom.js';
import {
  RunnerRound,
  RUNNER_WIDTH,
  RUNNER_HEIGHT,
  GROUND,
  PLAYER_X,
  PLAYER_W,
  bestDistance,
  saveBestDistance,
} from './runner-round.js';
import { createGameMusic } from '../../../audio/game-music.js';
const musicUrl = new URL('../../../../assets/bransboynd-retro-runner-548536.mp3', import.meta.url).href;
export function renderPixelRunner({ progression, onDispose, onResume }, game) {
  const root = node('section', undefined, 'pixel-runner'),
    intro = node('div', undefined, 'runner-intro'),
    record = node('p'),
    play = node('button', 'JOUER', 'runner-play');
  intro.append(
    node('h2', game.title),
    node(
      'p',
      'Cours automatiquement ! Espace ou flèche Haut pour sauter les caisses, blocs et trous.',
    ),
    record,
    play,
  );
  const distance = node('strong', undefined, 'runner-distance'),
    canvas = node('canvas', undefined, 'runner-canvas');
  canvas.width = RUNNER_WIDTH;
  canvas.height = RUNNER_HEIGHT;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Pixel Runner — Espace ou flèche Haut pour sauter');
  const result = node('div', undefined, 'runner-result'),
    final = node('strong'),
    best = node('p'),
    replay = node('button', 'REJOUER', 'runner-replay');
  result.append(node('h3', 'GAME OVER !'), final, best, replay);
  root.append(intro, distance, canvas, result);
  distance.hidden = true;
  canvas.hidden = true;
  result.hidden = true;
  record.textContent = `Meilleure distance : ${Math.floor(bestDistance(progression, game.id))} m`;
  const music = createGameMusic(musicUrl),
    ctx = canvas.getContext('2d'),
    round = new RunnerRound();
  let frame = null,
    paused = false,
    disposed = false;
  function draw() {
    distance.textContent = `Distance : ${Math.floor(round.distance)} m`;
    ctx.fillStyle = '#7cc9ef';
    ctx.fillRect(0, 0, RUNNER_WIDTH, RUNNER_HEIGHT);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) {
      const x = ((((i * 145 - round.distance * 0.18) % 650) + 650) % 650) - 70;
      ctx.fillRect(x, 25 + (i % 2) * 15, 44, 10);
      ctx.fillRect(x + 9, 16 + (i % 2) * 15, 24, 10);
    }
    ctx.fillStyle = '#78b874';
    for (let i = 0; i < 6; i++) {
      const x = ((((i * 100 - round.distance * 0.35) % 650) + 650) % 650) - 80;
      ctx.fillRect(x, 118, 80, 42);
      ctx.fillRect(x + 15, 100, 50, 18);
    }
    ctx.fillStyle = '#614c36';
    ctx.fillRect(0, GROUND, RUNNER_WIDTH, 40);
    ctx.fillStyle = '#8bd14b';
    ctx.fillRect(0, GROUND, RUNNER_WIDTH, 6);
    ctx.fillStyle = '#927c55';
    for (let x = -(round.distance % 28); x < RUNNER_WIDTH; x += 28)
      ctx.fillRect(Math.floor(x), 181, 8, 4);
    for (const o of round.obstacles) {
      const x = Math.floor(o.x);
      if (o.kind === 'hole') {
        ctx.fillStyle = '#23334b';
        ctx.fillRect(x, GROUND, o.width, 40);
      } else {
        ctx.fillStyle = o.kind === 'crate' ? '#af733a' : '#687c9d';
        ctx.fillRect(x, GROUND - o.height, o.width, o.height);
        ctx.fillStyle = o.kind === 'crate' ? '#e3b870' : '#a8b7cc';
        ctx.fillRect(x + 3, GROUND - o.height + 3, o.width - 6, 3);
        if (o.kind === 'crate') {
          ctx.fillRect(x + 3, GROUND - o.height + 8, 3, o.height - 11);
          ctx.fillRect(x + o.width - 6, GROUND - o.height + 8, 3, o.height - 11);
        }
      }
    }
    const y = Math.floor(round.y);
    ctx.fillStyle = '#62426c';
    ctx.fillRect(PLAYER_X + 2, y, 8, 4);
    ctx.fillStyle = '#ffe0ac';
    ctx.fillRect(PLAYER_X + 2, y + 4, 8, 5);
    ctx.fillStyle = '#2677d4';
    ctx.fillRect(PLAYER_X, y + 9, PLAYER_W, 7);
    ctx.fillStyle = '#fff';
    ctx.fillRect(PLAYER_X + 8, y + 5, 2, 2);
    const stride = round.grounded ? Math.floor(round.elapsed / 100) % 2 : 0;
    ctx.fillStyle = '#283248';
    ctx.fillRect(PLAYER_X + stride * 3, y + 16, 4, 4);
    ctx.fillRect(PLAYER_X + 8 - stride * 3, y + 16, 4, 4);
  }
  function finish() {
    music.stop();
    cancelAnimationFrame(frame);
    frame = null;
    result.hidden = false;
    final.textContent = `Distance : ${Math.floor(round.distance)} m`;
    best.textContent = `Meilleure distance : ${Math.floor(saveBestDistance(progression, game.id, round.distance))} m`;
    result.scrollIntoView?.({ block: 'nearest' });
  }
  function finishForDevelopment() {
    if (disposed || paused || !round.active || !result.hidden) return false;
    round.active = false;
    finish();
    return !result.hidden;
  }
  function loop(now) {
    if (disposed || paused) return;
    if (!root.isConnected) {
      pause();
      return;
    }
    round.tick(now);
    draw();
    if (!round.active) {
      finish();
      return;
    }
    frame = requestAnimationFrame(loop);
  }
  function start() {
    if (disposed || round.active) return;
    paused = false;
    intro.hidden = true;
    result.hidden = true;
    distance.hidden = false;
    canvas.hidden = false;
    round.start(performance.now());
    music.start();
    draw();
    canvas.scrollIntoView?.({ block: 'nearest' });
    canvas.focus();
    frame = requestAnimationFrame(loop);
  }
  function pause() {
    music.pause();
    paused = true;
    cancelAnimationFrame(frame);
    frame = null;
  }
  function resume() {
    if (disposed || !paused || document.hidden) return;
    paused = false;
    round.resume(performance.now());
    if (round.active) {
      music.resume();
      frame = requestAnimationFrame(loop);
    }
  }
  const key = (event) => {
    if (!round.active || paused || disposed || !['Space', 'ArrowUp'].includes(event.code)) return;
    event.preventDefault();
    if (!event.repeat) round.jump();
  };
  const visibility = () => {
    if (document.hidden) pause();
    else resume();
  };
  function dispose(reason) {
    if (reason === 'pause') {
      pause();
      return;
    }
    if (disposed) return;
    disposed = true;
    pause();
    music.dispose();
    round.stop();
    canvas.removeEventListener('keydown', key);
    document.removeEventListener('visibilitychange', visibility);
  }
  canvas.addEventListener('keydown', key);
  document.addEventListener('visibilitychange', visibility);
  play.addEventListener('click', start);
  replay.addEventListener('click', start);
  onDispose(dispose);
  onResume?.(resume);
  if (import.meta.env?.DEV) root.finishForDevelopment = finishForDevelopment;
  return root;
}
