import { icon } from './icons.js';
import { isSmileyPackInstalled } from './smiley-pack-emoticons.js';

const INSTALL_DURATION_MS = 2000;
const INSTALL_TICK_MS = 40;

export class SmileyPackInstaller {
  constructor(
    manager,
    applications,
    progression,
    { setIntervalFn = setInterval, clearIntervalFn = clearInterval, nowFn = () => performance.now(), onInstalled = () => {} } = {},
  ) {
    this.manager = manager;
    this.applications = applications;
    this.progression = progression;
    this.setInterval = setIntervalFn;
    this.clearInterval = clearIntervalFn;
    this.now = nowFn;
    this.onInstalled = onInstalled;
  }

  open(fileId) {
    const key = 'smiley-pack-installer';
    const existing = this.applications.instances.get(key);
    if (existing?.element.isConnected) {
      this.applications.restore(existing);
      return existing;
    }
    const installed = isSmileyPackInstalled(this.progression);
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
      step: installed ? 'already-installed' : 'welcome',
      timer: null,
      startedAt: null,
      progressCompleteObserved: false,
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
      root.innerHTML = `${banner('Assistant d’installation')}<section class="smiley-pack-installer-page"><h2>Bienvenue dans l’assistant d’installation de Smiley Pack 2009 !</h2><p>Ajoutez de nouvelles émoticônes à Windows Love Messenger.</p></section><footer class="smiley-pack-installer-actions"><button type="button" class="xp-button" data-action="install">Installer</button><button type="button" class="xp-button" data-action="cancel">Annuler</button></footer>`;
      root.querySelector('[data-action="install"]').addEventListener('click', () =>
        this.startInstallation(instance),
      );
      root.querySelector('[data-action="cancel"]').addEventListener('click', () =>
        this.manager.close(instance.id),
      );
      return;
    }
    if (instance.step === 'installing') {
      root.innerHTML = `${banner('Installation en cours')}<section class="smiley-pack-installer-page"><p>Installation des émoticônes...</p><progress max="100" value="0" aria-label="Progression de l’installation"></progress></section><footer class="smiley-pack-installer-actions"><button type="button" class="xp-button" disabled>Installation...</button></footer>`;
      return;
    }
    if (instance.step === 'complete') {
      root.innerHTML = `${banner('Installation terminée !')}<section class="smiley-pack-installer-page"><h2>Installation terminée !</h2><p>Les nouvelles émoticônes sont maintenant disponibles dans Windows Love Messenger.</p></section><footer class="smiley-pack-installer-actions"><button type="button" class="xp-button" data-action="finish">Terminer</button></footer>`;
      root.querySelector('[data-action="finish"]').addEventListener('click', () =>
        this.manager.close(instance.id),
      );
      return;
    }
    const alreadyInstalled = instance.step === 'already-installed';
    root.innerHTML = `${banner(alreadyInstalled ? 'Information' : 'Installation impossible')}<section class="smiley-pack-installer-page"><p>${alreadyInstalled ? 'Smiley Pack 2009 est déjà installé.' : 'Impossible d’enregistrer Smiley Pack 2009 dans la sauvegarde.'}</p></section><footer class="smiley-pack-installer-actions"><button type="button" class="xp-button" data-action="ok">OK</button></footer>`;
    root.querySelector('[data-action="ok"]').addEventListener('click', () =>
      this.manager.close(instance.id),
    );
  }

  startInstallation(instance) {
    if (instance.step !== 'welcome' || instance.timer !== null) return;
    instance.step = 'installing';
    instance.startedAt = this.now();
    instance.progressCompleteObserved = false;
    instance.element.classList.add('is-installing');
    this.render(instance);
    try {
      instance.timer = this.setInterval(() => {
        if (!instance.element.isConnected || instance.step !== 'installing') {
          this.clearTimer(instance);
          return;
        }
        try {
          const elapsed = Math.min(INSTALL_DURATION_MS, Math.max(0, this.now() - instance.startedAt));
          const progress = instance.element.querySelector('.smiley-pack-installer-content progress');
          if (progress) progress.value = (elapsed / INSTALL_DURATION_MS) * 100;
          if (elapsed < INSTALL_DURATION_MS) return;
          if (!instance.progressCompleteObserved) {
            instance.progressCompleteObserved = true;
            return;
          }
          this.clearTimer(instance);
          instance.element.classList.remove('is-installing');
          const previous = this.progression.data.flags.smileyPack2009Installed;
          this.progression.data.flags.smileyPack2009Installed = true;
          if (!this.progression.save()) {
            if (previous === undefined) delete this.progression.data.flags.smileyPack2009Installed;
            else this.progression.data.flags.smileyPack2009Installed = previous;
            instance.step = 'save-error';
          } else {
            instance.step = 'complete';
            this.onInstalled();
          }
          this.render(instance);
        } catch {
          this.clearTimer(instance);
          if (!instance.element.isConnected) return;
          instance.element.classList.remove('is-installing');
          instance.step = 'save-error';
          this.render(instance);
        }
      }, INSTALL_TICK_MS);
    } catch {
      this.clearTimer(instance);
      instance.element.classList.remove('is-installing');
      instance.step = 'save-error';
      this.render(instance);
    }
  }

  clearTimer(instance) {
    if (instance.timer === null) return;
    this.clearInterval(instance.timer);
    instance.timer = null;
  }
}
