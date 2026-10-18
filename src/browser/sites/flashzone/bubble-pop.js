import { textElement as node, internalLink as link } from '../../dom.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BUBBLE_RADIUS,
  BUBBLE_DIFFICULTIES,
  BubbleRound,
  bestScore,
  cellCenter,
  saveBestScore,
} from './bubble-round.js';
import { createGameMusic } from '../../../audio/game-music.js';
import { createSoundEffectPool } from '../../../audio/sound-effect-pool.js';

const musicUrl = new URL('../../../../assets/jakob_welik-roblox-time-to-win-skyline-run-1-442119.mp3', import.meta.url).href;
const popSoundUrl = new URL('../../../../assets/cherskis-bubble-popping-3-587265.mp3', import.meta.url).href;
const palette = ['#20a5e6', '#ed5aa3', '#ffc83d', '#72cf4d', '#9a70e8', '#f0783c'];

export function renderBubblePop({ progression, onDispose }, game) {
  const root = node('section', undefined, 'bubble-pop');
  const intro = node('div', undefined, 'bubble-intro');
  const subtitle = node('p', 'Choisissez votre difficult\u00e9 !');
  intro.append(node('h2', 'BUBBLEPOP'), subtitle);
  const difficultyButtons = Object.entries(BUBBLE_DIFFICULTIES).map(([id, config]) => {
    const button = node('button', config.label, `bubble-difficulty bubble-difficulty-${id}`);
    button.dataset.difficulty = id;
    return [id, button];
  });
  intro.append(...difficultyButtons.map(([, button]) => button));
  intro.append(node('small', `Meilleur score : ${bestScore(progression, game.id)}`));
  const stats = node('div', undefined, 'bubble-stats');
  const score = node('strong', 'Score : 0');
  const status = node('span', 'Bulles restantes : 0');
  const difficultyLabel = node('strong', 'MOYEN');
  const exitDuringPlay = link('QUITTER', 'http://www.flashzone.fr/');
  exitDuringPlay.className = 'bubble-quit';
  stats.append(score, status, difficultyLabel, exitDuringPlay);
  stats.hidden = true;
  const arena = node('div', undefined, 'bubble-arena');
  const canvas = node('canvas', undefined, 'bubble-canvas');
  canvas.width = BOARD_WIDTH;
  canvas.height = BOARD_HEIGHT;
  canvas.setAttribute('aria-label', 'Jeu de tir de bulles. Déplace la souris pour viser et clique pour tirer.');
  canvas.setAttribute('role', 'img');
  arena.append(canvas);
  arena.hidden = true;
  const result = node('div', undefined, 'bubble-result');
  result.hidden = true;
  const final = node('strong');
  const best = node('p');
  const replay = node('button', 'REJOUER', 'bubble-replay');
  const changeDifficulty = node('button', 'CHANGER DE DIFFICULT\u00c9', 'bubble-change-difficulty');
  const quit = link('QUITTER', 'http://www.flashzone.fr/');
  quit.className = 'bubble-quit';
  result.append(node('h3'), final, best, replay, changeDifficulty, quit);
  root.append(intro, stats, arena, result);

  const context = canvas.getContext?.('2d') ?? null;
  const music = createGameMusic(musicUrl);
  const popSound = createSoundEffectPool(popSoundUrl);
  const round = new BubbleRound();
  let frame = null;
  let previousTime = null;
  let disposed = false;
  let finished = false;

  function drawBubble(x, y, color, radius = BUBBLE_RADIUS) {
    if (!context) return;
    const gradient = context.createRadialGradient(x - radius * 0.35, y - radius * 0.4, 1, x, y, radius);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.2, palette[color]);
    gradient.addColorStop(1, '#14356e');
    context.beginPath();
    context.arc(x, y, radius - 1, 0, Math.PI * 2);
    context.fillStyle = gradient;
    context.fill();
    context.strokeStyle = '#ffffffa8';
    context.lineWidth = 1.5;
    context.stroke();
  }

  function draw() {
    if (!context || !round.board) return;
    context.clearRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    const background = context.createLinearGradient(0, 0, 0, BOARD_HEIGHT);
    background.addColorStop(0, '#1b78b2');
    background.addColorStop(1, '#171d59');
    context.fillStyle = background;
    context.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
    context.strokeStyle = '#ffffff28';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, BOARD_HEIGHT - 72);
    context.lineTo(BOARD_WIDTH, BOARD_HEIGHT - 72);
    context.stroke();
    for (const [key, color] of round.board) {
      const [row, col] = key.split(':').map(Number);
      const { x, y } = cellCenter(row, col);
      drawBubble(x, y, color);
    }
    // Dotted guide follows the same wall reflections as the shot.
    if (!round.projectile) {
      let x = BOARD_WIDTH / 2, y = BOARD_HEIGHT - 34;
      let dx = round.aim.x, dy = round.aim.y;
      context.save();
      context.setLineDash([5, 6]);
      context.strokeStyle = '#ffffffa8';
      context.beginPath();
      context.moveTo(x, y);
      for (let i = 0; i < 90 && y > 12; i++) {
        x += dx * 7;
        y += dy * 7;
        if (x < BUBBLE_RADIUS || x > BOARD_WIDTH - BUBBLE_RADIUS) dx *= -1;
        if (i % 3 === 0) context.lineTo(x, y);
      }
      context.stroke();
      context.restore();
    }
    context.save();
    context.translate(BOARD_WIDTH / 2, BOARD_HEIGHT - 34);
    context.rotate(Math.atan2(round.aim.y, round.aim.x) + Math.PI / 2);
    context.fillStyle = '#d8e8ff';
    context.fillRect(-7, -42, 14, 46);
    context.strokeStyle = '#345381';
    context.strokeRect(-7, -42, 14, 46);
    context.restore();
    if (round.projectile) drawBubble(round.projectile.x, round.projectile.y, round.projectile.color, BUBBLE_RADIUS - 1);
    drawBubble(BOARD_WIDTH / 2, BOARD_HEIGHT - 34, round.currentColor, BUBBLE_RADIUS + 2);
    drawBubble(BOARD_WIDTH - 35, BOARD_HEIGHT - 31, round.nextColor, BUBBLE_RADIUS - 3);
  }

  function finish() {
    if (finished) return;
    finished = true;
    music.stop();
    popSound.stopAll();
    stats.hidden = true;
    arena.hidden = true;
    result.hidden = false;
    result.children[0].textContent = round.status === 'won' ? 'BRAVO !' : 'PARTIE TERMINÉE';
    final.textContent = `Score final : ${round.score}`;
    best.textContent = `Meilleur score : ${saveBestScore(progression, game.id, round.score)}`;
  }

  function renderFrame(now) {
    if (disposed) return;
    if (!root.isConnected) {
      dispose();
      return;
    }
    const dt = previousTime === null ? 0 : (now - previousTime) / 1000;
    previousTime = now;
    const oldScore = round.score;
    round.update(dt);
    if (round.score > oldScore) popSound.play();
    score.textContent = `Score : ${round.score}`;
    status.textContent = `Bulles restantes : ${round.board.size}`;
    draw();
    if (!round.active) {
      frame = null;
      finish();
      return;
    }
    frame = requestAnimationFrame(renderFrame);
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * BOARD_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * BOARD_HEIGHT,
    };
  }

  function aim(event) {
    const point = pointFromEvent(event);
    if (!point || !round.active) return;
    round.setAim(point.x, point.y);
    draw();
  }

  function fire(event) {
    const point = pointFromEvent(event);
    if (point) round.setAim(point.x, point.y);
    if (!round.shoot()) return;
    draw();
  }

  function keyboardFire(event) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    fire({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height * 0.3 });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    music.dispose();
    popSound.dispose();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    round.stop();
    canvas.removeEventListener('pointermove', aim);
    canvas.removeEventListener('pointerdown', fire);
    canvas.removeEventListener('keydown', keyboardFire);
  }

  function start(difficulty = round.difficulty) {
    if (disposed) return;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    previousTime = null;
    finished = false;
    round.start(difficulty);
    intro.hidden = true;
    result.hidden = true;
    stats.hidden = false;
    arena.hidden = false;
    music.start();
    score.textContent = 'Score : 0';
    status.textContent = `Bulles restantes : ${round.board.size}`;
    difficultyLabel.textContent = BUBBLE_DIFFICULTIES[round.difficulty].label;
    draw();
    frame = requestAnimationFrame(renderFrame);
  }

  function showDifficultySelection() {
    if (disposed) return;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    music.stop();
    popSound.stopAll();
    round.stop();
    finished = false;
    stats.hidden = true;
    arena.hidden = true;
    result.hidden = true;
    intro.hidden = false;
  }

  canvas.addEventListener('pointermove', aim);
  canvas.addEventListener('pointerdown', fire);
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', keyboardFire);
  for (const [difficulty, button] of difficultyButtons) {
    button.addEventListener('click', () => start(difficulty));
  }
  replay.addEventListener('click', () => start(round.difficulty));
  changeDifficulty.addEventListener('click', showDifficultySelection);
  onDispose(dispose);
  return root;
}
