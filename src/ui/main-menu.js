import config from '../config/menu.json' with { type: 'json' };
import { applications, applicationName, trackIdentity } from './identity.js';
import { icon } from './icons.js';
import { resolvePlayerText } from '../story/player-identity.js';
export function menuPresentation(data, definition = config) {
  const variant = definition.variants.find(
    (item) => item.whenCompleted && data.completed.includes(item.whenCompleted),
  );
  return { ...definition, ...variant, labels: { ...definition.labels, ...variant?.labels } };
}
export class MainMenu {
  constructor(root, progression, settings, sounds, actions) {
    Object.assign(this, { progression, settings, sounds, actions });
    this.element = document.createElement('section');
    this.element.id = 'main-menu';
    this.element.className = 'main-menu';
    this.element.setAttribute('aria-label', 'Menu principal');
    this.element.innerHTML = /* HTML */ `
      <div class="menu-orbit orbit-one" aria-hidden="true">★</div>
      <div class="menu-orbit orbit-two" aria-hidden="true">☺</div>
      <div class="menu-orbit orbit-three" aria-hidden="true">✦</div>
      <div class="menu-shell">
        <header class="menu-titlebar">
          <span>${icon('menu-computer')} ${applicationName('system')} · chaos_survival.exe</span
          ><span aria-hidden="true">− ▢ <b>×</b></span>
        </header>
        <div class="menu-toolbar">
          <span>Fichier &nbsp; Amis &nbsp; Bonne humeur</span><span>100 % hors ligne</span>
        </div>
        <div class="menu-content">
          <div class="menu-sticker">EST. 2005<br /><b>♥ ONLINE !</b></div>
          <p class="menu-edition"><i></i> BIENVENUE SUR TON BUREAU</p>
          <h1 class="menu-logo" aria-label="CHAOS SURVIVAL">
            CHAOS<span>SURVIVAL<span class="menu-logo-star" aria-hidden="true">★</span></span>
          </h1>
          <p class="menu-tagline"></p>
          <div class="menu-home">
            <div class="menu-badges">
              <span>♫ RHYTHM</span><span>☺ MSN</span><span>★ MINI-GAMES</span>
            </div>
            <div class="menu-actions">
              <button id="menu-play" class="menu-big"></button
              ><button id="menu-new-game" class="menu-big menu-secondary" hidden></button
              ><button id="menu-options" class="menu-small"></button>
            </div>
            <p class="menu-checkpoint"></p>
            <p class="menu-tip">Ferme les fenêtres. Garde le rythme. Retrouve tes amis.</p>
          </div>
          <section class="menu-options-panel" hidden aria-labelledby="options-title">
            <h2 id="options-title">⚙ OPTIONS</h2>
            <label
              >♫ Volume musical <output id="music-output"></output
              ><input id="option-music" type="range" min="0" max="100" aria-label="Volume musical"
            /></label>
            <label
              >☺ Bruitages <output id="effects-output"></output
              ><input
                id="option-effects"
                type="range"
                min="0"
                max="100"
                aria-label="Volume des effets sonores"
            /></label>
            <label class="menu-fullscreen"
              ><input id="option-fullscreen" type="checkbox" /> Plein écran
              <small>F11 / Alt + Entrée</small></label
            >
            <button id="options-back" class="menu-small">← RETOUR</button>
            <button id="menu-delete-data" class="menu-delete">Effacer toutes mes données…</button>
          </section>
          <p class="menu-status" role="status"></p>
        </div>
        <footer class="menu-footer">
          <span class="menu-player-status"></span><span>★ ★ ★ ★ ★</span>
        </footer>
      </div>
      <p class="menu-music-credit"></p>
      <p class="menu-bottom">NO LOADING SCREENS WERE HARMED IN THE MAKING OF THIS GAME ☺</p>
      <div class="menu-confirm-layer" hidden>
        <section
          class="menu-confirm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="menu-confirm-title"
        >
          <header id="menu-confirm-title"></header>
          <p></p>
          <div>
            <button id="menu-confirm-yes" class="menu-small">CONFIRMER</button
            ><button id="menu-confirm-no" class="menu-small">ANNULER</button>
          </div>
        </section>
      </div>
    `;
    root.append(this.element);
    const desktopBackdrop = document.createElement('div');
    desktopBackdrop.className = 'menu-desktop-background icon-grid';
    desktopBackdrop.inert = true;
    desktopBackdrop.setAttribute('aria-hidden', 'true');
    const desktop = root.querySelector('#desktop');
    const copyComponent = (source) => {
      const component = source.cloneNode(true);
      component.removeAttribute('id');
      component.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
      component.querySelectorAll('button').forEach((button) => {
        button.disabled = true;
        button.tabIndex = -1;
        button.removeAttribute('aria-pressed');
        button.classList.remove('is-dragging');
        button.style.transform = '';
      });
      return component;
    };
    // Copy the actual grid after layout, including saved cells and received files.
    // The menu does not calculate or persist a second desktop arrangement.
    this.syncDesktopIcons = () => {
      for (const selector of ['.desktop-icons', '.desktop-files']) {
        const source = desktop.querySelector(selector);
        desktopBackdrop.querySelector(selector)?.remove();
        if (source) desktopBackdrop.append(copyComponent(source));
      }
    };
    this.desktopObserver = new MutationObserver(this.syncDesktopIcons);
    for (const selector of ['.desktop-icons', '.desktop-files']) {
      const source = desktop.querySelector(selector);
      if (source)
        this.desktopObserver.observe(source, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['style', 'hidden'],
        });
    }
    this.syncDesktopIcons();
    for (const selector of ['.taskbar']) {
      const component = copyComponent(desktop.querySelector(selector));
      if (selector === '.taskbar') component.classList.add('menu-desktop-taskbar');
      desktopBackdrop.append(component);
    }
    this.element.prepend(desktopBackdrop);
    this.clock = desktopBackdrop.querySelector('time');
    const catalog = document.createElement('div');
    catalog.className = 'menu-application-logos';
    catalog.setAttribute('aria-label', 'Logiciels du bureau');
    for (const key of Object.keys(applications)) {
      const item = document.createElement('span');
      item.innerHTML = icon(key);
      item.title = applicationName(key);
      item.setAttribute('aria-label', applicationName(key));
      catalog.append(item);
    }
    this.element.querySelector('.menu-options-panel').append(catalog);
    this.element.querySelector('.menu-music-credit').textContent =
      `Musique niveau 1 : ${trackIdentity.artist} — ${trackIdentity.title} (${trackIdentity.source})`;
    const graphicCredit = document.createElement('small');
    graphicCredit.textContent =
      "Certaines ressources graphiques de Chaos Survival ont été créées à l'aide des outils de génération d'images par intelligence artificielle intégrés à Codex (OpenAI).";
    this.element
      .querySelector('.menu-music-credit')
      .append(document.createElement('br'), graphicCredit);
    this.find = (selector) => this.element.querySelector(selector);
    this.find('#menu-play').addEventListener('click', () =>
      this.run(() => this.actions.play(this.progression.hasSave)),
    );
    this.find('#menu-options').addEventListener('click', () => this.options(true));
    this.find('#options-back').addEventListener('click', () => this.options(false));
    for (const [id, key, output] of [
      ['music', 'musicVolume', 'music-output'],
      ['effects', 'effectsVolume', 'effects-output'],
    ]) {
      this.find(`#option-${id}`).addEventListener('input', (event) => {
        this.settings.update({ [key]: Number(event.target.value) / 100 });
        this.find(`#${output}`).textContent = `${event.target.value} %`;
        this.actions.settingsChanged();
      });
    }
    this.find('#option-effects').addEventListener('change', () => this.sounds.play('message'));
    this.find('#option-fullscreen').addEventListener('change', (event) =>
      this.run(() => this.actions.fullscreen(event.target.checked)),
    );
    this.find('#menu-delete-data').addEventListener('click', () =>
      this.confirm(
        'Effacer mes données ?',
        'Cette action efface définitivement la sauvegarde active, toutes les parties historiques, les choix, les records et les réglages.',
        () => this.actions.deleteData(),
      ),
    );
    this.element.addEventListener('pointerover', (event) => {
      if (event.target.closest('button') && event.target !== this.hovered) {
        this.hovered = event.target;
        this.sounds.unlock().then(() => this.sounds.play('hover'));
      }
    });
    this.element.addEventListener('click', (event) => {
      if (event.target.closest('button')) {
        this.sounds.unlock();
        this.sounds.play('send');
      }
    });
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (!this.find('.menu-confirm-layer').hidden) this.cancelConfirm();
        else this.options(false);
      }
      if (event.key === 'Tab' && !this.find('.menu-confirm-layer').hidden) {
        const buttons = [...this.find('.menu-confirm').querySelectorAll('button')];
        if (
          (!event.shiftKey && document.activeElement === buttons.at(-1)) ||
          (event.shiftKey && document.activeElement === buttons[0])
        ) {
          event.preventDefault();
          buttons[event.shiftKey ? 1 : 0].focus();
        }
      }
    });
    this.bindConfirmationEvents();
  }
  bindConfirmationEvents() {
    this.find('#menu-new-game').addEventListener('click', () =>
      this.confirm(
        'Commencer une nouvelle partie ?',
        'Commencer une nouvelle partie ? Toute votre progression et vos modifications seront perdues.',
        () => this.actions.newGame(),
        ['Oui', 'Non'],
      ),
    );
    this.find('#menu-confirm-no').addEventListener('click', () => this.cancelConfirm());
    this.find('#menu-confirm-yes').addEventListener('click', () => {
      const action = this.confirmAction;
      this.cancelConfirm();
      if (action) this.run(() => action());
    });
  }
  async run(action) {
    if (this.busy) return;
    this.busy = true;
    this.element.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    try {
      await action();
    } catch (error) {
      this.find('.menu-status').textContent = `Impossible de terminer : ${error.message}`;
    } finally {
      this.busy = false;
      this.element.querySelectorAll('button').forEach((button) => {
        button.disabled = false;
      });
    }
  }
  render() {
    const view = menuPresentation(this.progression.data);
    this.find('.menu-player-status').textContent = resolvePlayerText(
      '✉ {player.grammaticalGender:CONNECTÉ|CONNECTÉE} À LA BONNE HUMEUR',
      this.progression.data.playerIdentity,
    );
    this.element.dataset.theme = view.theme;
    this.find('.menu-logo').setAttribute('aria-label', view.title);
    this.find('.menu-tagline').textContent = view.tagline;
    this.find('#menu-play').textContent = this.progression.hasSave
      ? view.labels.continue
      : view.labels.play;
    this.find('#menu-new-game').textContent = view.labels.newGame;
    this.find('#menu-new-game').hidden = !this.progression.hasSave;
    this.find('#menu-options').textContent = view.labels.options;
    const current = this.progression.current;
    this.find('.menu-checkpoint').textContent = !this.progression.hasSave
      ? 'TA PREMIÈRE AVENTURE COMMENCE ICI !'
      : current?.type === 'arcade'
        ? 'Niveau 1 · reprise au début du niveau'
        : current?.type === 'conversation'
          ? `Bureau ${applicationName('system')} · conversation MSN en cours`
          : current?.type === 'minigame'
            ? `Bureau ${applicationName('system')} · mini-jeu débloqué`
            : 'Aventure terminée · retrouver ton bureau';
    this.find('.menu-status').textContent = this.progression.corrupt
      ? 'La sauvegarde est illisible. Tu peux commencer une nouvelle partie.'
      : this.progression.persistenceError
        ? 'La sauvegarde est indisponible : cette session reste jouable.'
        : '';
    this.syncSettings();
  }
  syncSettings() {
    for (const [id, key, output] of [
      ['music', 'musicVolume', 'music-output'],
      ['effects', 'effectsVolume', 'effects-output'],
    ]) {
      const value = Math.round(this.settings.data[key] * 100);
      this.find(`#option-${id}`).value = value;
      this.find(`#${output}`).textContent = `${value} %`;
    }
    this.find('#option-fullscreen').checked = this.settings.data.fullscreen;
  }
  options(open) {
    this.find('.menu-home').hidden = open;
    this.find('.menu-options-panel').hidden = !open;
    this.syncSettings();
    this.find(open ? '#option-music' : '#menu-play').focus();
  }
  confirm(title, copy, action, labels = ['CONFIRMER', 'ANNULER']) {
    this.find('#menu-confirm-yes').textContent = labels[0];
    this.find('#menu-confirm-no').textContent = labels[1];
    this.confirmAction = action;
    this.confirmFocus = document.activeElement;
    this.find('#menu-confirm-title').textContent = title;
    this.find('.menu-confirm p').textContent = copy;
    this.find('.menu-confirm-layer').hidden = false;
    this.find('.menu-shell').inert = true;
    this.find('#menu-confirm-no').focus();
  }
  cancelConfirm() {
    const layer = this.find('.menu-confirm-layer');
    if (layer.hidden) return false;
    layer.hidden = true;
    this.find('.menu-shell').inert = false;
    const focus = this.confirmFocus;
    this.confirmFocus = null;
    this.confirmAction = null;
    if (!this.element.hidden && focus?.isConnected !== false) focus?.focus();
    return true;
  }
  show() {
    this.syncDesktopIcons();
    this.render();
    this.options(false);
    this.element.hidden = false;
    this.find('#menu-play').focus();
  }
  hide() {
    this.element.hidden = true;
  }
}
