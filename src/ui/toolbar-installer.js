import { icon } from './icons.js';

const DOWNLOAD_DURATION_MS = 2600;
const STALL_DURATION_MS = 1000;
const STOP_PERCENT = 78;
const INSTALL_TICK_MS = 50;

export class ToolbarInstaller {
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

  open(fileId = 'downloads/toolbar_setup.exe') {
    const key = 'toolbar-installer';
    const existing = this.applications.instances.get(key);
    if (existing?.element.isConnected) {
      this.applications.restore(existing);
      return existing;
    }

    const id = this.manager.spawn('desktopapp', {
      preview: true,
      x: 0.29,
      y: 0.2,
      windowClass: 'toolbar-installer-window',
      resizable: false,
      maximizable: false,
      content: {
        title: 'Installation de SUPER TOOLBAR 2009',
        iconName: 'download',
        body: '<main class="toolbar-installer-content"></main>',
      },
      onDismiss: () => {
        if (instance.timer !== null) this.clearInterval(instance.timer);
        instance.timer = null;
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
      'SUPER TOOLBAR 2009',
      'download',
    );
    Object.assign(instance, {
      fileId,
      step: 'welcome',
      options: [true, true, true, true],
      timer: null,
      elapsed: 0,
      stalledAt: null,
    });
    this.render(instance);
    this.applications.restore(instance);
    return instance;
  }

  render(instance) {
    const root = instance.element.querySelector('.toolbar-installer-content');
    if (!root) return;
    if (instance.step === 'welcome') {
      root.innerHTML = `<div class="toolbar-installer-banner">${icon('download')}<div><strong>Assistant d’installation</strong><span>SUPER TOOLBAR 2009</span></div></div><section class="toolbar-installer-page"><h2>Bienvenue dans l’assistant d’installation de SUPER TOOLBAR 2009 !</h2><p>SUPER TOOLBAR 2009 va révolutionner votre expérience sur Internet !</p></section><footer class="toolbar-installer-actions"><button type="button" class="xp-button" data-action="next">Suivant &gt;</button><button type="button" class="xp-button" data-action="cancel">Annuler</button></footer>`;
      root.querySelector('[data-action="next"]').addEventListener('click', () => {
        instance.step = 'options';
        this.render(instance);
      });
      root.querySelector('[data-action="cancel"]').addEventListener('click', () =>
        this.manager.close(instance.id),
      );
      return;
    }
    if (instance.step === 'options') {
      const options = [
        'Installer SUPER TOOLBAR.',
        'Définir SUPER SEARCH comme moteur de recherche par défaut.',
        'Définir SUPER HOME comme page d’accueil.',
        'Afficher des offres exclusives pendant la navigation.',
      ];
      root.innerHTML = `<div class="toolbar-installer-banner">${icon('download')}<div><strong>Options d’installation</strong><span>Choisissez les composants à installer</span></div></div><section class="toolbar-installer-page"><h2>Choisissez vos options</h2><div class="toolbar-installer-options">${options.map((label, index) => `<label><input type="checkbox" data-option="${index}"${instance.options[index] ? ' checked' : ''}> <span>${label}</span></label>`).join('')}</div></section><footer class="toolbar-installer-actions"><button type="button" class="xp-button" data-action="back">&lt; Précédent</button><button type="button" class="xp-button" data-action="install">Installer</button><button type="button" class="xp-button" data-action="cancel">Annuler</button></footer>`;
      root.querySelectorAll('[data-option]').forEach((checkbox) =>
        checkbox.addEventListener('change', () => {
          instance.options[Number(checkbox.dataset.option)] = checkbox.checked;
        }),
      );
      root.querySelector('[data-action="back"]').addEventListener('click', () => {
        root.querySelectorAll('[data-option]').forEach((checkbox) => {
          instance.options[Number(checkbox.dataset.option)] = checkbox.checked;
        });
        instance.step = 'welcome';
        this.render(instance);
      });
      root.querySelector('[data-action="install"]').addEventListener('click', () =>
        this.startInstallation(instance),
      );
      root.querySelector('[data-action="cancel"]').addEventListener('click', () =>
        this.manager.close(instance.id),
      );
      return;
    }
    if (instance.step === 'installing') {
      root.innerHTML = `<div class="toolbar-installer-banner">${icon('download')}<div><strong>T\u00e9l\u00e9chargement en cours</strong><span>SUPER TOOLBAR 2009</span></div></div><section class="toolbar-installer-page"><h2>Téléchargement de SUPER TOOLBAR 2009...</h2><progress max="100" value="0" aria-label="Progression du t\u00e9l\u00e9chargement"></progress><p class="toolbar-installer-status" role="status">Téléchargement de SUPER TOOLBAR 2009...</p></section><footer class="toolbar-installer-actions"><button type="button" class="xp-button" disabled>T\u00e9l\u00e9chargement...</button><button type="button" class="xp-button" disabled>Annuler</button></footer>`;
      return;
    }
    root.innerHTML = `<div class="toolbar-installer-banner toolbar-installer-error">${icon('error')}<div><strong>Erreur de t\u00e9l\u00e9chargement</strong><span>SUPER TOOLBAR 2009</span></div></div><section class="toolbar-installer-page toolbar-installer-failure"><p>Impossible \u00e0 t\u00e9l\u00e9charger</p></section><footer class="toolbar-installer-actions"><button type="button" class="xp-button" data-action="ok">OK</button></footer>`;
    root.querySelector('[data-action="ok"]').addEventListener('click', () =>
      this.manager.close(instance.id),
    );
  }

  startInstallation(instance) {
    if (instance.step !== 'options' || instance.timer) return;
    instance.step = 'installing';
    instance.elapsed = 0;
    instance.stalledAt = null;
    instance.startedAt = this.now();
    instance.element.classList.add('is-installing');
    this.render(instance);
    try {
      instance.timer = this.setInterval(() => {
        if (!instance.element.isConnected || instance.step !== 'installing') {
          this.clearTimer(instance);
          return;
        }
        try {
          const now = this.now();
          instance.elapsed = Math.min(DOWNLOAD_DURATION_MS, Math.max(0, now - instance.startedAt));
          const progress = instance.element.querySelector('.toolbar-installer-content progress');
          const status = instance.element.querySelector('.toolbar-installer-status');
          if (progress) progress.value = (instance.elapsed / DOWNLOAD_DURATION_MS) * STOP_PERCENT;
          if (status) status.textContent = 'Téléchargement de SUPER TOOLBAR 2009...';
          if (instance.elapsed < DOWNLOAD_DURATION_MS) return;
          if (instance.stalledAt === null) {
            instance.stalledAt = now;
            return;
          }
          if (now - instance.stalledAt < STALL_DURATION_MS) return;
          this.clearTimer(instance);
          instance.step = 'failure';
          instance.element.classList.remove('is-installing');
          this.render(instance);
        } catch {
          this.clearTimer(instance);
          if (!instance.element.isConnected) return;
          instance.step = 'failure';
          instance.element.classList.remove('is-installing');
          this.render(instance);
        }
      }, INSTALL_TICK_MS);
    } catch {
      this.clearTimer(instance);
      instance.step = 'failure';
      instance.element.classList.remove('is-installing');
      this.render(instance);
    }
  }

  clearTimer(instance) {
    if (instance.timer !== null) {
      this.clearInterval(instance.timer);
      instance.timer = null;
    }
  }
}
