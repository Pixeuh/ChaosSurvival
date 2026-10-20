import { textElement as node } from '../../dom.js';
import {
  SquaresRound,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  PLAYER_SIZE,
  ENEMY_SIZE,
  bestTime,
  saveBestTime,
} from './squares-round.js';
import { createGameMusic } from '../../../audio/game-music.js';
const musicUrl = new URL(
  '../../../../assets/9jackjack8-neon-amnesia-club-house-2010-375600.mp3',
  import.meta.url,
).href;
export function renderAvoidSquares({ progression, onDispose }, game) {
  const root = node('section', undefined, 'avoid-squares'),
    intro = node('div', undefined, 'squares-intro');
  const play = node('button', 'JOUER', 'squares-play'),
    introBest = node('p');
  intro.append(
    node('h2', game.title),
    node(
      'p',
      'Déplace la souris dans le cadre pour guider le carré bleu. Évite les carrés rouges !',
    ),
    introBest,
    play,
  );
  const timer = node('strong', undefined, 'squares-time'),
    arena = node('div', undefined, 'squares-arena');
  arena.setAttribute('aria-label', 'Arène : évite les carrés rouges avec la souris');
  const player = node('span', undefined, 'squares-player');
  const result = node('div', undefined, 'squares-result'),
    final = node('strong'),
    record = node('p'),
    replay = node('button', 'REJOUER', 'squares-replay');
  result.append(node('h3', 'GAME OVER !'), final, record, replay);
  root.append(intro, timer, arena, result);
  const music = createGameMusic(musicUrl),
    round = new SquaresRound(),
    enemies = new Map();
  let frame = null,
    disposed = false;
  const formatted = (time) => `${(time / 1000).toFixed(2)} s`;
  function welcome() {
    timer.hidden = true;
    arena.hidden = true;
    result.hidden = true;
    intro.hidden = false;
    introBest.textContent = `Meilleur temps : ${formatted(bestTime(progression, game.id))}`;
  }
  function place(element, position, size) {
    element.style.left = `${(position.x / ARENA_WIDTH) * 100}%`;
    element.style.top = `${(position.y / ARENA_HEIGHT) * 100}%`;
    element.style.width = `${(size / ARENA_WIDTH) * 100}%`;
    element.style.height = `${(size / ARENA_HEIGHT) * 100}%`;
  }
  function render() {
    timer.textContent = `Temps de survie : ${formatted(round.elapsed)}`;
    place(player, round.player, PLAYER_SIZE);
    for (const enemy of round.enemies) {
      if (!enemies.has(enemy.id)) {
        const element = node('span', undefined, 'squares-enemy');
        enemies.set(enemy.id, element);
        arena.append(element);
      }
      place(enemies.get(enemy.id), enemy, ENEMY_SIZE);
    }
  }
  function finish() {
    if (disposed || result.hidden === false) return;
    music.stop();
    cancelAnimationFrame(frame);
    frame = null;
    render();
    arena.classList.add('squares-hit');
    result.hidden = false;
    final.textContent = `Temps de survie : ${formatted(round.elapsed)}`;
    record.textContent = `Meilleur temps : ${formatted(saveBestTime(progression, game.id, round.elapsed))}`;
    result.scrollIntoView?.({ block: 'nearest' });
  }
  function finishForDevelopment() {
    if (disposed || !round.active || !result.hidden) return false;
    round.active = false;
    finish();
    return !result.hidden;
  }
  function abandon() {
    music.stop();
    cancelAnimationFrame(frame);
    frame = null;
    round.stop();
    enemies.clear();
    arena.replaceChildren();
    welcome();
  }
  function loop(now) {
    if (disposed) return;
    if (!root.isConnected) {
      dispose();
      return;
    }
    round.tick(now);
    render();
    if (!round.active) {
      finish();
      return;
    }
    frame = requestAnimationFrame(loop);
  }
  function start() {
    if (disposed || round.active) return;
    cancelAnimationFrame(frame);
    arena.replaceChildren(player);
    enemies.clear();
    arena.classList.remove('squares-hit');
    intro.hidden = true;
    result.hidden = true;
    timer.hidden = false;
    arena.hidden = false;
    round.start(performance.now());
    music.start();
    render();
    arena.scrollIntoView?.({ block: 'nearest' });
    frame = requestAnimationFrame(loop);
  }
  const onMove = (event) => {
    if (!round.active) return;
    round.tick(performance.now());
    const bounds = arena.getBoundingClientRect();
    const width = bounds.width - 2 * arena.clientLeft,
      height = bounds.height - 2 * arena.clientTop;
    if (width <= 0 || height <= 0) return;
    round.move(
      ((event.clientX - bounds.left - arena.clientLeft) / width) * ARENA_WIDTH,
      ((event.clientY - bounds.top - arena.clientTop) / height) * ARENA_HEIGHT,
    );
    render();
    if (!round.active) finish();
  };
  const visibility = () => {
    if (document.hidden && round.active) abandon();
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    music.dispose();
    cancelAnimationFrame(frame);
    frame = null;
    round.stop();
    enemies.clear();
    arena.replaceChildren();
    arena.removeEventListener('pointermove', onMove);
    document.removeEventListener('visibilitychange', visibility);
  }
  arena.addEventListener('pointermove', onMove);
  document.addEventListener('visibilitychange', visibility);
  play.addEventListener('click', start);
  replay.addEventListener('click', start);
  onDispose(dispose);
  if (import.meta.env?.DEV) root.finishForDevelopment = finishForDevelopment;
  welcome();
  return root;
}
