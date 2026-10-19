import { icon } from './icons.js';
import { applicationName, trackIdentity } from './identity.js';
import { arcadeLauncher } from './arcade-launcher.js';
import { getDisplayFileName } from './file-names.js';

export function mountDesktop(root, best) {
  root.innerHTML = /* HTML */ ` <main class="desktop" id="desktop">
    <div class="desktop-wash"></div>
    <header class="hud" hidden aria-label="Statistiques de la partie">
      <div class="hud-brand">
        ${icon('computer')}
        <div><strong>CHAOS SURVIVAL</strong><small>ARCADE MUSICAL / ÉDITION 2009</small></div>
      </div>
      <div class="score-panel">
        <span>SCORE</span><strong id="score">000000</strong
        ><small>RECORD <b id="best">${String(best).padStart(6, '0')}</b></small>
      </div>
      <div class="chaos-panel">
        <div><span>CHAOS DU BUREAU</span><strong id="chaos-text">0 %</strong></div>
        <div
          class="chaos-meter"
          role="progressbar"
          aria-label="Chaos"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="0"
        >
          <div id="chaos-fill"></div>
          <span class="meter-ticks"></span>
        </div>
        <small id="chaos-caption">Tout va bien. Pour l’instant.</small>
      </div>
      <button class="hud-control" id="pause-button" disabled aria-label="Mettre en pause">Ⅱ</button>
      <button class="hud-control" id="help-button" aria-label="Comment jouer">?</button>
    </header>
    <nav class="desktop-icons" aria-label="Raccourcis du bureau">
      <button data-shortcut="computer">${icon('computer')}<span>Poste de travail</span></button>
      <button data-shortcut="folder">${icon('folder')}<span>Mes documents</span></button>
      <button data-shortcut="msn">
        ${icon('msn')}<span>${applicationName('messenger')}</span>
      </button>
      <button data-shortcut="browser">
        ${icon('browser')}<span>${applicationName('browser')}</span>
      </button>
      <button data-shortcut="windows-media-play">
        ${icon('media')}<span>${applicationName('media')}</span>
      </button>
      <button data-shortcut="arcade">
        ${icon(arcadeLauncher.icon)}<span>${getDisplayFileName(arcadeLauncher)}</span>
      </button>
      <button data-shortcut="bin">${icon('bin')}<span>Corbeille</span></button>
    </nav>
    <div class="desktop-note">
      <span>internet was a mistake.</span><small>mais la musique est bonne.</small>
    </div>
    <section id="playfield" aria-label="Fenêtres à fermer"></section>
    <div class="intro-layer" id="intro-layer">
      <section class="xp-window launcher" aria-labelledby="launcher-title">
        <header class="titlebar">
          <span class="window-title">${icon('menu-computer')} chaos_survival.exe</span>
          <div class="launcher-controls">
            <span class="titlebar-decoration" aria-hidden="true">− &nbsp; ▢</span>
            <button class="close-button" id="close-launcher" aria-label="Fermer le menu principal">
              ×
            </button>
          </div>
        </header>
        <div class="launcher-menu">
          Fichier <span>Partie</span><span>Aide</span><small>v0.1 — prototype</small>
        </div>
        <div class="launcher-body">
          <div class="edition"><i class="online-dot"></i> VOUS ÊTES CONNECTÉ · BONNE CHANCE</div>
          <h1 id="launcher-title">
            CHAOS<br /><span>SURVIVAL<span class="title-star">✳</span></span>
          </h1>
          <p class="tagline">Niveau 1 · MEDIUM · garde le rythme, maîtrise le chaos.</p>
          <div class="how-to">
            <div>
              <b>01</b><span>Clique sur les <em>×</em> pour fermer les fenêtres.</span>
            </div>
            <div>
              <b>02</b><span>Chaque fermeture = <strong>100 points.</strong></span>
            </div>
            <div>
              <b>03</b><span>À <strong>100 % de chaos</strong>, ton PC rend l’âme.</span>
            </div>
          </div>
          <button class="start-button" id="start-button">
            <span>▶</span> START <small>LET’S SURVIVE</small>
          </button>
          <div class="start-meta">
            <span>♫ Son recommandé</span><span>90 secondes de survie</span
            ><span>Échap = pause</span>
          </div>
          <p class="load-status" id="load-status" role="status">
            Prêt à faire planter l’année 2009 ?
          </p>
        </div>
        <footer class="launcher-footer">
          <span>${icon('msn')} Ferme les fenêtres. Garde le rythme.</span><span>160 BPM</span>
        </footer>
      </section>
    </div>
    <section class="music-player" aria-label="Lecteur musical">
      <div class="album-art">
        <img
          src="${trackIdentity.cover}"
          alt="Console et arcade en pixel art · ${trackIdentity.genre}"
        />
      </div>
      <div class="track">
        <small>LECTURE EN COURS</small
        ><strong id="track-title"
          >${trackIdentity.displayName} <span>· ${trackIdentity.source}</span></strong
        >
        <div class="track-progress"><div id="track-fill"></div></div>
        <div class="track-meta">
          <span id="track-time">00:00 / 01:30</span><span id="bpm-label">160 BPM</span>
        </div>
      </div>
      <div class="equalizer" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
      <label class="volume-control"
        ><span>VOL.</span
        ><input
          id="volume"
          type="range"
          min="0"
          max="100"
          value="55"
          aria-label="Volume de la musique"
      /></label>
    </section>
    <div class="notification-area" id="notification-area">
    <div class="toast" id="toast" role="button" tabindex="0" hidden>
      <header>
        ${icon('msn')} ${applicationName('messenger')}
        <button id="dismiss-toast" aria-label="Fermer la notification">×</button>
      </header>
      <div>
        <span class="toast-avatar">${icon('msn')}</span>
        <p><strong id="toast-contact"></strong><span id="toast-message"></span></p>
      </div>
    </div>
    <div class="toast-stack" id="message-toast-stack" aria-live="polite" hidden></div>
    </div>
    <template id="message-toast-template">
      <div class="toast message-toast" role="button" tabindex="0">
        <header>
          ${icon('msn')} ${applicationName('messenger')}
          <button class="toast-dismiss" aria-label="Fermer la notification">×</button>
        </header>
        <div>
          <span class="toast-avatar">${icon('msn')}</span>
          <p><strong class="toast-contact"></strong><span class="toast-message"></span></p>
        </div>
      </div>
    </template>
    <div class="wizz-label" id="wizz-label" hidden>
      WIZZ !!!<small>quelqu’un veut ton attention.</small>
    </div>
    <div id="feedback-layer" aria-hidden="true"></div>
    <div class="modal-layer" id="modal-layer" hidden>
      <section
        class="xp-window dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <header class="titlebar"><span id="dialog-caption">chaos_survival.exe</span></header>
        <div class="dialog-body">
          <div id="dialog-icon">${icon('help')}</div>
          <h2 id="dialog-title"></h2>
          <div id="dialog-copy"></div>
          <button class="start-button" id="dialog-action"></button
          ><button class="text-button" id="dialog-secondary" hidden>Retour au bureau</button>
        </div>
      </section>
    </div>
    <div class="start-menu" id="start-menu" hidden>
      <header>${icon('computer')} <strong>Joueur.exe</strong></header>
      <button id="menu-buddy" data-start-app="buddy">${icon('buddy')} Buddy</button>
      <button id="menu-messenger">${icon('msn')} ${applicationName('messenger')}</button>
      <button id="menu-browser" data-start-app="browser">
        ${icon('browser')} ${applicationName('browser')}
      </button>
      <button data-system-app="computer">${icon('computer')} Poste de travail</button>
      <button data-system-app="folder">${icon('folder')} Mes documents</button>
      <button data-system-app="bin">${icon('bin')} Corbeille</button>
      <footer>Bienvenue en 2009. Reste un peu.</footer>
      <div class="start-menu-actions">
        <button id="start-menu-main" type="button">${icon('menu-computer')} Menu principal</button>
        <button id="start-menu-quit" type="button" aria-label="Quitter le jeu">
          <span class="start-menu-power-icon" aria-hidden="true">⏻</span> Quitter le jeu
        </button>
      </div>
    </div>
    <footer class="taskbar">
      <button class="windows-start" id="windows-start" aria-expanded="false">
        ${icon('flag')} démarrer
      </button>
      <div class="task-tab">${icon('computer')} Chaos Survival</div>
      <div class="tray">
        <span class="tray-online" title="Connecté">●</span
        ><button id="mute-button" aria-label="Couper le son">♫</button><span>FR</span
        ><time id="clock"></time>
      </div>
    </footer>
  </main>`;

  const select = (selector) => root.querySelector(selector);
  return {
    desktop: select('#desktop'),
    hud: select('.hud'),
    startButton: select('#start-button'),
    closeLauncher: select('#close-launcher'),
    pauseButton: select('#pause-button'),
    helpButton: select('#help-button'),
    introLayer: select('#intro-layer'),
    modalLayer: select('#modal-layer'),
    playfield: select('#playfield'),
    loadStatus: select('#load-status'),
    bpmLabel: select('#bpm-label'),
    launcherBpm: select('.launcher-footer > span:last-child'),
    volume: select('#volume'),
    durationLabel: select('.start-meta > span:nth-child(2)'),
    trackTitle: select('#track-title'),
    trackFill: select('#track-fill'),
    trackTime: select('#track-time'),
    score: select('#score'),
    best: select('#best'),
    chaosText: select('#chaos-text'),
    chaosFill: select('#chaos-fill'),
    chaosMeter: select('.chaos-meter'),
    chaosCaption: select('#chaos-caption'),
    dialogTitle: select('#dialog-title'),
    dialogCopy: select('#dialog-copy'),
    dialogIcon: select('#dialog-icon'),
    dialogAction: select('#dialog-action'),
    dialogSecondary: select('#dialog-secondary'),
    feedbackLayer: select('#feedback-layer'),
    toast: select('#toast'),
    messageToastStack: select('#message-toast-stack'),
    messageToastTemplate: select('#message-toast-template'),
    toastContact: select('#toast-contact'),
    toastMessage: select('#toast-message'),
    dismissToast: select('#dismiss-toast'),
    wizzLabel: select('#wizz-label'),
    muteButton: select('#mute-button'),
    startMenu: select('#start-menu'),
    windowsStart: select('#windows-start'),
    menuMain: select('#start-menu-main'),
    menuQuit: select('#start-menu-quit'),
    menuMessenger: select('#menu-messenger'),
    clock: select('#clock'),
    shortcuts: root.querySelectorAll('[data-shortcut]'),
  };
}

// Pauses and results still belong to the rhythmic session, including restored results.
export function updateRhythmHud(ui, phase) {
  const visible = ['loading', 'playing', 'paused', 'resuming', 'ended'].includes(phase);
  ui.hud.hidden = !visible;
  ui.desktop.classList.toggle('rhythm-active', visible);
}
