import { createGame, drainGameEvents, setPlayerControls, togglePause, updateGame } from './engine.js';
import { createBombArenaChat } from './chat-system.js';
import { createArenaEffects, renderBombArena, renderCharacterRoster, renderCollisionDiagnostics } from './presentation.js';
import { createBombArenaAudio } from './audio.js';

const RAF = (callback) => globalThis.requestAnimationFrame(callback);
const CANCEL_RAF = (id) => globalThis.cancelAnimationFrame(id);
const KEY_MAP = Object.freeze({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' });
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
let fallbackMatchSequence = 0;
const createMatchId = () => globalThis.crypto?.randomUUID?.() ?? `bomb-arena-${Date.now()}-${++fallbackMatchSequence}`;
const DEV_BUILD = Boolean(import.meta.env?.DEV);

export function isArenaTextEntryTarget(target) {
  return Boolean(target?.closest?.('input,select,textarea,[contenteditable="true"]'));
}

function formatTime(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function mountBombArena(instance, manager) {
  const host = instance?.element?.querySelector?.('.window-body');
  if (!host) return null;
  const diagnosticButton = DEV_BUILD ? '<button type="button" class="ba-diagnostics" aria-pressed="false">DIAGNOSTIC COLLISIONS</button>' : '';
  host.innerHTML = `<section class="bomb-arena-app" aria-label="BombArena">
    <header class="ba-topbar"><div><b>BombArena</b><span class="ba-subtitle">ARCADE BATTLE · 2009</span></div></header>
    <main class="ba-layout"><div class="ba-stage">
      <div class="ba-menu" data-screen="menu"><div class="ba-logo">BOMBARENA</div><canvas class="ba-roster" width="520" height="105" aria-label="JustMe, PixelGirl, Turbo et Luna"></canvas><p>Affrontez-vous en 8 manches</p>
        <button type="button" class="ba-start">COMMENCER</button><p class="ba-controls-hint">Flèches : bouger　 Espace : bombe　 Échap : pause</p></div>
      <canvas class="ba-canvas" width="780" height="660" tabindex="0" aria-label="Arène BombArena"></canvas>
      <div class="ba-overlay" hidden></div>
    </div><aside class="ba-sidebar"><section class="ba-scoreboard"><h2>CLASSEMENT · 8 MANCHES</h2><p class="ba-round">Manche —</p><p class="ba-time">00:00</p><div class="ba-player-list"></div><p class="ba-controls"><kbd>&uarr;</kbd><kbd>&darr;</kbd><kbd>&larr;</kbd><kbd>&rarr;</kbd> Bouger · <kbd>Espace</kbd> Bombe</p><button type="button" class="ba-pause" hidden>Pause</button></section>
      <section class="ba-chat" aria-label="Chat de la partie"><h2>CHAT DE PARTIE</h2><div class="ba-chat-log" role="log" aria-live="polite" aria-relevant="additions"></div><button type="button" class="ba-chat-toggle" aria-expanded="false" disabled>Entrée · message rapide</button><div class="ba-chat-options" hidden role="group" aria-label="Messages prédéfinis"></div></section></aside></main>
    <footer class="ba-status"><span>BombArena.exe · prêt</span><div class="ba-audio-controls"><label>Effets <input class="ba-sfx-volume" type="range" min="0" max="100" value="65" aria-label="Volume des effets sonores"></label><label class="ba-mute-label"><input class="ba-mute" type="checkbox"> Muet</label><label class="ba-music-label">Musique <input type="range" min="0" max="100" value="0" disabled aria-label="Musique indisponible : aucun morceau dédié"></label></div></footer>
  </section>`;
  if (DEV_BUILD) {
    const diagnosticButton = host.ownerDocument.createElement('button');
    diagnosticButton.type = 'button';
    diagnosticButton.className = 'ba-diagnostics';
    diagnosticButton.textContent = 'DIAGNOSTIC COLLISIONS';
    diagnosticButton.setAttribute('aria-pressed', 'false');
    host.querySelector('.ba-topbar')?.append(diagnosticButton);
  }
  const canvas = host.querySelector('.ba-canvas'), ctx = canvas.getContext('2d');
  const rosterCanvas = host.querySelector('.ba-roster'), rosterCtx = rosterCanvas.getContext('2d');
  const menu = host.querySelector('.ba-menu'), overlay = host.querySelector('.ba-overlay');
  let game = null, chat = createBombArenaChat(), frameId = 0, lastTime = null, accumulator = 0, disposed = false;
  let showCollisionDiagnostics = false;
  let chatMenuOpen = false, selectedChatOption = 0, renderedMessageId = 0;
  const audio = createBombArenaAudio();
  const effects = createArenaEffects({ onSound: (name) => audio.play(name) });
  let audioWasActive = false, goUntil = 0, matchId = null, completionReported = false;
  const pressed = new Set();
  const step = 1000 / 60;

  const renderHud = () => {
    const list = host.querySelector('.ba-player-list');
    if (!game) return;
    list.innerHTML = game.players.map((p) => `<div class="ba-player-row${p.alive ? '' : ' is-out'}"><i style="--player:${p.color}"></i><span>${escapeHtml(p.name)}<small>${p.alive ? 'VIVANT' : 'ÉLIMINÉ'}</small></span><b>${game.wins[p.id]}</b></div>`).join('');
    host.querySelector('.ba-round').textContent = game.round <= 8
      ? `Manche ${game.round} / 8`
      : `Départage ${game.round - 8}`;
    host.querySelector('.ba-time').textContent = formatTime(game.roundTime);
    host.querySelector('.ba-pause').hidden = !['playing', 'paused'].includes(game.phase);
    host.querySelector('.ba-pause').textContent = game.phase === 'paused' ? 'Reprendre' : 'Pause';
  };

  const renderChatMessages = () => {
    const log = host.querySelector('.ba-chat-log');
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 36;
    for (const message of chat.messages) {
      if (message.id <= renderedMessageId) continue;
      const row = document.createElement('p');
      row.className = `ba-chat-message ba-chat-${message.authorId}`;
      row.style.setProperty('--player', message.color);
      const author = document.createElement('b'); author.textContent = `${message.author}:`; author.style.color = message.color;
      const body = document.createElement('span'); body.textContent = ` ${message.text}`;
      if (message.authorId === 'turbo') body.style.color = message.color;
      row.append(author, body); log.append(row); renderedMessageId = message.id;
    }
    while (log.children.length > 120) log.firstElementChild.remove();
    if (nearBottom) log.scrollTop = log.scrollHeight;
  };

  const renderChatOptions = () => {
    const options = host.querySelector('.ba-chat-options');
    options.innerHTML = chat.quickMessages.map((option, index) => `<button type="button" class="ba-chat-option${index === selectedChatOption ? ' is-selected' : ''}" data-chat-option="${escapeHtml(option.id)}" aria-pressed="${index === selectedChatOption}">${escapeHtml(option.text)}</button>`).join('');
  };

  const finalOverlayMarkup = () => {
    const winner = game.players.find((player) => player.id === game.matchWinnerId);
    const rankings = Object.entries(game.wins)
      .sort((a, b) => b[1] - a[1])
      .map(([id, score], rank) => {
        const player = game.players.find((item) => item.id === id);
        return `<span class="ba-result-row" style="--player:${player.color}">${rank + 1}. ${escapeHtml(player.name)} - ${score} manche(s)</span>`;
      })
      .join('<br>');
    return `<strong>${escapeHtml(winner?.name.toUpperCase() ?? 'PARTIE TERMINÉE')} CHAMPION !</strong><span>${rankings}<br>${game.round} manche(s) jouée(s)</span>`;
  };

  const setChatMenuOpen = (open) => {
    chatMenuOpen = open;
    if (open) { pressed.clear(); setPlayerControls(game, {}); }
    else if (game && manager.isActive(instance.element)) canvas.focus({ preventScroll: true });
    host.querySelector('.ba-chat-options').hidden = !open;
    host.querySelector('.ba-chat-toggle').setAttribute('aria-expanded', String(open));
    if (open) renderChatOptions();
  };

  const consumeEvents = () => {
    for (const event of drainGameEvents(game)) {
      chat.onGameEvent(event);
      if (event.type === 'chain_reaction') audio.play('chain');
      if (event.type === 'round_completed') instance.onBombArenaEvent?.({
        type: 'round-completed', round: event.round, winnerId: event.playerId,
        scores: event.scores, roundsPlayed: event.roundsPlayed,
      });
    }
  };

  const renderArena = () => {
    const now = globalThis.performance?.now?.() ?? Date.now();
    renderCharacterRoster(rosterCtx, rosterCanvas, now);
    if (!ctx || !game) return;
    renderBombArena(ctx, canvas, game, effects, now);
    if (DEV_BUILD && showCollisionDiagnostics) renderCollisionDiagnostics(ctx, canvas, game);
    const status = game.phase;
    const suddenWarning = status === 'playing' && game.roundTime >= 85000 && game.roundTime < 90000;
    const goAnnouncement = status === 'playing' && now < goUntil;
    overlay.hidden = !(['countdown', 'paused', 'round-end', 'match-end'].includes(status) || suddenWarning || goAnnouncement);
    if (status === 'countdown') overlay.innerHTML = `<strong>${Math.min(3, Math.max(1, Math.ceil(game.countdownMs / 700)))}</strong><span>GET READY!</span>`;
    else if (goAnnouncement) overlay.innerHTML = '<strong>GO!</strong><span>FIGHT!</span>';
    else if (status === 'paused') overlay.innerHTML = '<strong>PAUSED</strong><span>Échap pour reprendre</span>';
    else if (status === 'round-end') overlay.innerHTML = `<strong>${escapeHtml(game.message)}</strong><span>Manche suivante…</span>`;
    else if (status === 'match-end') overlay.innerHTML = finalOverlayMarkup();
    else if (suddenWarning) overlay.innerHTML = '<strong>MORT SUBITE</strong><span>Les murs approchent — trouvez une issue!</span>';
  };

  function startGame() {
    chat.dispose(); chat = createBombArenaChat(); renderedMessageId = 0; effects.reset(); audio.unlock().then(() => audio.play('select')); goUntil = 0;
    matchId = createMatchId(); completionReported = false;
    host.querySelector('.ba-chat-log').replaceChildren(); host.querySelector('.ba-chat-toggle').disabled = false; setChatMenuOpen(false);
    const saved = instance.bombArenaProgress;
    game = createGame(saved?.status === 'IN_PROGRESS'
      ? { progress: { completedRounds: saved.completedRounds, scores: saved.roundScores } }
      : undefined);
    game.phase = 'countdown';
    game.countdownMs = 2100; menu.hidden = true; consumeEvents(); canvas.focus(); renderHud(); renderArena();
  }
  function onKeyDown(event) {
    if (!game || !manager.isActive(instance.element)) return;
    const onControl = isArenaTextEntryTarget(event.target);
    if (chatMenuOpen && (event.code === 'ArrowDown' || event.code === 'ArrowUp')) {
      event.preventDefault();
      const count = chat.quickMessages.length;
      selectedChatOption = (selectedChatOption + (event.code === 'ArrowDown' ? 1 : count - 1)) % count;
      renderChatOptions(); return;
    }
    if (chatMenuOpen && event.code === 'Escape') { event.preventDefault(); setChatMenuOpen(false); return; }
    if (chatMenuOpen && event.code === 'Enter') {
      event.preventDefault(); event.stopPropagation();
      chat.sendPlayerMessage(chat.quickMessages[selectedChatOption]?.id); setChatMenuOpen(false); renderChatMessages();
      return;
    }
    if (event.code === 'Enter' && event.target?.closest?.('button')) return;
    if (event.code === 'Enter' && !onControl) {
      event.preventDefault();
      selectedChatOption = 0; setChatMenuOpen(true);
      return;
    }
    if (chatMenuOpen) return;
    if (onControl) return;
    if (event.code === 'Escape') { event.preventDefault(); togglePause(game); audio.play(game.phase === 'paused' ? 'back' : 'select'); audio.setPaused(game.phase === 'paused'); pressed.clear(); setPlayerControls(game, {}); if (game.phase !== 'paused') canvas.focus({ preventScroll: true }); renderHud(); renderArena(); return; }
    if (game.phase !== 'playing') return;
    if (KEY_MAP[event.code]) { event.preventDefault(); pressed.add(KEY_MAP[event.code]); setPlayerControls(game, Object.fromEntries([...pressed].map((key) => [key, true]))); }
    if (event.code === 'Space' && !event.repeat) { event.preventDefault(); game.players[0].controls.bomb = true; }
  }
  function onKeyUp(event) {
    if (KEY_MAP[event.code]) {
      pressed.delete(KEY_MAP[event.code]);
      if (game) setPlayerControls(game, manager.isActive(instance.element)
        ? Object.fromEntries([...pressed].map((key) => [key, true]))
        : {});
    }
  }
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect(), ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
    if (rect.width && rect.height) { canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio); renderArena(); }
  }
  function animate(time) {
    if (disposed) return;
    frameId = RAF(animate);
    const active = manager.isActive(instance.element) && !document.hidden && game?.phase !== 'paused';
    if (active !== audioWasActive) { audio.setPaused(!active); audioWasActive = active; }
    if (!active) { lastTime = null; pressed.clear(); setPlayerControls(game, {}); return; }
    const frameDelta = lastTime === null ? 0 : Math.min(100, time - lastTime);
    if (lastTime === null) lastTime = time;
    accumulator += frameDelta; lastTime = time;
    let steps = 0;
    while (accumulator >= step && steps++ < 6) {
      if (game && game.phase !== 'paused') {
        if (game.phase !== 'ready' && game.phase !== 'match-end') {
          const before = game.phase; updateGame(game, step); consumeEvents();
          if (before === 'countdown' && game.phase === 'playing') goUntil = time + 450;
          if (before === 'countdown' && game.phase === 'playing' && game.round === 1)
            instance.onBombArenaEvent?.({ type: 'match-started', difficulty: game.difficulty });
          if (before !== 'match-end' && game.phase === 'match-end' && !completionReported) {
            completionReported = true;
            const winner = game.players.find((player) => player.id === game.matchWinnerId);
            if (winner) instance.onBombArenaEvent?.({
              type: 'match-completed', matchId, difficulty: game.difficulty, winnerId: winner.id,
              scores: { ...game.wins }, roundsPlayed: game.round,
            });
          }
        }
        chat.advance(step);
      }
      accumulator -= step;
    }
    if (steps >= 6) accumulator = 0;
    if (game) effects.observe(game, Math.min(50, frameDelta), time);
    renderArena(); renderHud(); renderChatMessages();
  }
  const observer = new ResizeObserver(resizeCanvas); observer.observe(canvas);
  host.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  host.querySelector('.ba-start').addEventListener('click', startGame);
  host.querySelector('.ba-diagnostics')?.addEventListener('click', (event) => {
    showCollisionDiagnostics = !showCollisionDiagnostics;
    event.currentTarget.setAttribute('aria-pressed', String(showCollisionDiagnostics));
    renderArena();
  });
  if (instance.bombArenaProgress?.completedRounds > 0 && instance.bombArenaProgress.status === 'IN_PROGRESS')
    host.querySelector('.ba-start').textContent = `REPRENDRE · MANCHE ${instance.bombArenaProgress.nextRound}`;
  host.querySelectorAll('button').forEach((button) => button.addEventListener('pointerenter', () => audio.play('hover')));
  host.querySelector('.ba-sfx-volume').addEventListener('input', (event) => audio.setSfxVolume(Number(event.target.value) / 100));
  host.querySelector('.ba-mute').addEventListener('change', (event) => audio.setMuted(event.target.checked));
  canvas.addEventListener('pointerdown', () => canvas.focus());
  host.querySelector('.ba-pause').addEventListener('click', () => { if (game) { togglePause(game); audio.play(game.phase === 'paused' ? 'back' : 'select'); audio.setPaused(game.phase === 'paused'); if (game.phase !== 'paused') canvas.focus({ preventScroll: true }); } pressed.clear(); setPlayerControls(game, {}); renderArena(); renderHud(); });
  host.querySelector('.ba-chat-toggle').addEventListener('click', () => { if (game) setChatMenuOpen(!chatMenuOpen); });
  host.querySelector('.ba-chat-options').addEventListener('click', (event) => {
    const button = event.target.closest('.ba-chat-option');
    if (!button) return;
    const index = chat.quickMessages.findIndex((option) => option.id === button.dataset.chatOption);
    if (index < 0) return;
    selectedChatOption = index; chat.sendPlayerMessage(button.dataset.chatOption); setChatMenuOpen(false); renderChatMessages();
  });
  globalThis.addEventListener('keydown', onKeyDown); globalThis.addEventListener('keyup', onKeyUp);
  instance.onMinimize = () => { pressed.clear(); setPlayerControls(game, {}); audio.setPaused(true); audioWasActive = false; };
  instance.onRestore = () => { audioWasActive = false; if (game && manager.isActive(instance.element)) canvas.focus({ preventScroll: true }); };
  instance.disposeGame = () => { disposed = true; pressed.clear(); setPlayerControls(game, {}); CANCEL_RAF(frameId); observer.disconnect(); chat.dispose(); audio.dispose(); globalThis.removeEventListener('keydown', onKeyDown); globalThis.removeEventListener('keyup', onKeyUp); host.replaceChildren(); };
  if (instance.savedMatchResult) {
    game = createGame();
    game.phase = 'match-end';
    game.difficulty = 'PGM';
    game.round = Number.isSafeInteger(instance.savedMatchResult.roundsPlayed)
      ? instance.savedMatchResult.roundsPlayed
      : 8;
    const savedScores = instance.savedMatchResult.scores;
    game.wins = savedScores && ['justme', 'pixelgirl', 'turbo', 'luna'].every((id) => Number.isSafeInteger(savedScores[id]))
      ? { ...savedScores }
      : { justme: 0, pixelgirl: 0, turbo: 0, luna: 0 };
    game.players.forEach((player) => { player.wins = game.wins[player.id]; });
    game.matchWinnerId = instance.savedMatchResult.winnerId;
    menu.hidden = true;
    completionReported = true;
    renderHud();
  }
  resizeCanvas(); frameId = RAF(animate); renderArena();
  return { dispose: instance.disposeGame, get game() { return game; } };
}

