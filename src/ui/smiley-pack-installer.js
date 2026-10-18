import { icon } from './icons.js';

const DOWNLOAD_DURATION_MS = 2500;
const STALL_DURATION_MS = 1000;
const STOP_PERCENT = 43;
const INSTALL_TICK_MS = 40;

export class SmileyPackInstaller {
  constructor(
    manager,
    applications,
    { setIntervalFn = setInterval, clearIntervalFn = clearInterval, nowFn = () => performance.now() } = {},
  ) {
    this.manager = manager;
    this.applications = applications;
    this.setInterval = setIntervalFn;
    this.clearInterval = clearIntervalFn;
    this.now = nowFn;
  }

  open(fileId) {
    const key = 'smiley-pack-installer';
    const existing = this.applications.instances.get(key);
    if (existing?.element.isConnected) {
      this.applications.restore(existing);
      return existing;
    }
    const id = this.manager.spawn('desktopapp', {
      preview: true,
      x: 0.32,
      y: 0.22,
      windowClass: 'smiley-pack-installer-window',
      resizable: false,
      maximizable: false,
      content: {
        title: 'Installation de Smiley Pack 2009',
        iconName: 'msn',
        body: '<main class="smiley-pack-installer-content"></main>',
      },
      onDismiss: () => {
        this.clearTimer(instance);
        instance.element.classList.remove('is-installing');
        instance.step = 'closed';
        this.applications.instances.delete(key);
        instance.task.remove();
        this.applications.onWindowState?.();
      },
    });
    const instance = this.applications.attachWindow(
      key,
      id,
      'Smiley Pack 2009',
      'msn',
    );
    Object.assign(instance, {
      fileId,
      step: 'welcome',
      timer: null,
      startedAt: null,
      stalledAt: null,
    });
    this.render(instance);
    this.applications.restore(instance);
    return instance;
  }

  render(instance) {
    const root = instance.element.querySelector('.smiley-pack-installer-content');
    if (!root) return;
    const banner = (heading) =>
      `<div class="smiley-pack-installer-banner">${icon('msn')}<strong>${heading}</strong></div>`;
    if (instance.step === 'welcome') {
      root.innerHTML = `${banner('Assistant d’installation')}<section class="smiley-pack-installer-page"><h2>Bienvenue dans l’assistant d’installation de Smiley Pack 2009 !</h2></section><footer class="smiley-pack-installer-actions"><button type="button" class="xp-button" data-action="install">Installer</button><button type="button" class="xp-button" data-action="cancel">Annuler</button></footer>`;
      root.querySelector('[data-action="install"]').addEventListener('click', () =>
        this.startInstallation(instance),
      );
      root.querySelector('[data-action="cancel"]').addEventListener('click', () =>
        this.manager.close(instance.id),
      );
      return;
    }
    if (instance.step === 'installing') {
      root.innerHTML = `${banner('Téléchargement')}<section class="smiley-pack-installer-page"><p>Téléchargement de Smiley Pack 2009...</p><progress max="100" value="0" aria-label="Progression du téléchargement"></progress></section><footer class="smiley-pack-installer-actions"><button type="button" class="xp-button" disabled>Téléchargement...</button></footer>`;
      return;
    }
    if (instance.step === 'failure') {
      root.innerHTML = `<div class="smiley-pack-installer-banner">${icon('error')}<strong>Erreur de téléchargement</strong></div><section class="smiley-pack-installer-page"><p>Impossible à télécharger</p></section><footer class="smiley-pack-installer-actions"><button type="button" class="xp-button" data-action="ok">OK</button></footer>`;
      root.querySelector('[data-action="ok"]').addEventListener('click', () =>
        this.manager.close(instance.id),
      );
    }
  }

  startInstallation(instance) {
    if (instance.step !== 'welcome' || instance.timer !== null) return;
    try {
      instance.step = 'installing';
      instance.startedAt = this.now();
      instance.stalledAt = null;
      instance.element.classList.add('is-installing');
      this.render(instance);
      instance.timer = this.setInterval(() => {
        if (!instance.element.isConnected || instance.step !== 'installing') {
          this.clearTimer(instance);
          instance.element.classList.remove('is-installing');
          return;
        }
        try {
          const now = this.now();
          const elapsed = Math.min(DOWNLOAD_DURATION_MS, Math.max(0, now - instance.startedAt));
          const progress = instance.element.querySelector('.smiley-pack-installer-content progress');
          if (!progress) throw new Error('La barre de progression Smiley Pack est absente du DOM.');
          progress.value = (elapsed / DOWNLOAD_DURATION_MS) * STOP_PERCENT;
          if (elapsed < DOWNLOAD_DURATION_MS) return;
          if (instance.stalledAt === null) {
            instance.stalledAt = now;
            return;
          }
          if (now - instance.stalledAt < STALL_DURATION_MS) return;
          this.clearTimer(instance);
          instance.element.classList.remove('is-installing');
          instance.step = 'failure';
          this.render(instance);
        } catch (error) {
          this.failTechnically(instance, error);
        }
      }, INSTALL_TICK_MS);
    } catch (error) {
      this.failTechnically(instance, error);
    }
  }

  failTechnically(instance, error) {
    console.error('[Smiley Pack 2009] Erreur technique pendant la progression.', error);
    this.clearTimer(instance);
    instance.element.classList.remove('is-installing');
    instance.step = 'technical-error';
  }

  clearTimer(instance) {
    if (instance.timer === null) return;
    this.clearInterval(instance.timer);
    instance.timer = null;
  }
}
