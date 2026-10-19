import { textElement as node, internalLink as link } from '../../dom.js';
import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  BUBBLE_RADIUS,
  BubbleCampaign,
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
  const stats = node('div', undefined, 'bubble-stats');
  const levelLabel = node('strong', 'NIVEAU 1 / 3');
  const score = node('strong', 'Score : 0');
  const status = node('span', 'Bulles restantes : 0');
  const missedShots = node('span', 'Tirs sans éclatement : 0/8');
  const exitDuringPlay = link('QUITTER', 'http://www.flashzone.fr/');
  exitDuringPlay.className = 'bubble-quit';
  stats.append(levelLabel, score, status, missedShots, exitDuringPlay);
  const arena = node('div', undefined, 'bubble-arena');
  const canvas = node('canvas', undefined, 'bubble-canvas');
  canvas.width = BOARD_WIDTH;
  canvas.height = BOARD_HEIGHT;
  canvas.setAttribute('aria-label', 'Jeu de tir de bulles. Déplace la souris pour viser et clique pour tirer.');
  canvas.setAttribute('role', 'img');
  arena.append(canvas);
  const announcement = node('div', undefined, 'bubble-level-announcement');
  const announcementTitle = node('strong');
  const announcementMessage = node('span');
  announcement.append(announcementTitle, announcementMessage);
  announcement.hidden = true;
  arena.append(announcement);
  const result = node('div', undefined, 'bubble-result');
  result.hidden = true;
  const resultTitle = node('h3');
  const resultMessage = node('p');
  const final = node('strong');
  const best = node('p');
  const replay = node('button', 'REJOUER', 'bubble-replay');
  const quit = link('QUITTER', 'http://www.flashzone.fr/');
  quit.className = 'bubble-quit';
  result.append(resultTitle, resultMessage, final, best, replay, quit);
  const transition = node('div', undefined, 'bubble-level-transition');
  transition.hidden = true;
  const transitionTitle = node('h3');
  const transitionMessage = node('p');
  const continueButton = node('button', 'CONTINUER', 'bubble-continue');
  transition.append(transitionTitle, transitionMessage, continueButton);
  root.append(stats, arena, transition, result);

  const context = canvas.getContext?.('2d') ?? null;
  const music = createGameMusic(musicUrl);
  const popSound = createSoundEffectPool(popSoundUrl);
  const round = new BubbleRound();
  const campaign = new BubbleCampaign();
  let frame = null;
  let previousTime = null;
  let announcementStartedAt = null;
  let disposed = false;
  let finished = false;
  let phase = 'playing';

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

  function updateHud() {
    levelLabel.textContent = `NIVEAU ${campaign.level} / 3`;
    score.textContent = `Score : ${campaign.totalScore + round.score}`;
    status.textContent = `Bulles restantes : ${round.board.size}`;
    missedShots.textContent = `Tirs sans éclatement : ${round.shotsSinceClear}/${round.config.missesBeforeRow}`;
  }

  function showFinalResult(won) {
    phase = 'ended';
    stats.hidden = true;
    arena.hidden = true;
    transition.hidden = true;
    result.hidden = false;
    resultTitle.textContent = won ? 'BRAVO !' : 'GAME OVER';
    resultMessage.textContent = won ? 'VOUS AVEZ TERMINÉ BUBBLEPOP !' : `NIVEAU ${campaign.level}`;
    final.textContent = `Score : ${campaign.totalScore}`;
    best.textContent = `Meilleur score : ${saveBestScore(progression, game.id, campaign.totalScore)}`;
    replay.textContent = won ? 'REJOUER' : 'RECOMMENCER';
  }

  function finish() {
    if (finished) return;
    finished = true;
    music.stop();
    popSound.stopAll();
    if (round.status === 'won') {
      campaign.completeLevel(round.score);
      if (campaign.state === 'transition') {
        phase = 'transition';
        stats.hidden = true;
        arena.hidden = true;
        result.hidden = true;
        transition.hidden = false;
        transitionTitle.textContent = `NIVEAU ${campaign.level} TERMINÉ !`;
        transitionMessage.textContent = campaign.level === 1
          ? 'Préparez-vous pour le niveau 2 !'
          : 'Le dernier niveau vous attend...';
        return;
      }
      showFinalResult(true);
      return;
    }
    campaign.lose(round.score);
    showFinalResult(false);
  }

  function renderFrame(now) {
    if (disposed) return;
    if (!root.isConnected) {
      dispose();
      return;
    }
    if (phase === 'announce') {
      if (announcementStartedAt === null) announcementStartedAt = now;
      draw();
      updateHud();
      if (now - announcementStartedAt < 1100) {
        frame = requestAnimationFrame(renderFrame);
        return;
      }
      phase = 'playing';
      announcement.hidden = true;
      previousTime = now;
    }
    const dt = previousTime === null ? 0 : (now - previousTime) / 1000;
    previousTime = now;
    const oldScore = round.score;
    round.update(dt);
    if (round.score > oldScore) popSound.play();
    updateHud();
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
    if (!point || !round.active || phase !== 'playing') return;
    round.setAim(point.x, point.y);
    draw();
  }

  function fire(event) {
    if (phase !== 'playing') return;
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

  function startCurrentLevel() {
    if (disposed) return;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    previousTime = null;
    announcementStartedAt = null;
    finished = false;
    phase = 'announce';
    round.start(campaign.difficulty);
    result.hidden = true;
    transition.hidden = true;
    stats.hidden = false;
    arena.hidden = false;
    announcementTitle.textContent = `NIVEAU ${campaign.level}`;
    announcementMessage.textContent = campaign.level === 1
      ? 'Échauffement !'
      : campaign.level === 2 ? 'Niveau moyen' : 'Dernier défi !';
    announcement.hidden = false;
    music.start();
    updateHud();
    draw();
    frame = requestAnimationFrame(renderFrame);
  }

  function startCampaign() {
    if (disposed) return;
    campaign.reset();
    startCurrentLevel();
  }

  function continueCampaign() {
    if (!campaign.continue()) return;
    startCurrentLevel();
  }

  canvas.addEventListener('pointermove', aim);
  canvas.addEventListener('pointerdown', fire);
  canvas.tabIndex = 0;
  canvas.addEventListener('keydown', keyboardFire);
  continueButton.addEventListener('click', continueCampaign);
  replay.addEventListener('click', () => {
    if (phase === 'ended') startCampaign();
  });
  onDispose(dispose);
  startCampaign();
  return root;
}
