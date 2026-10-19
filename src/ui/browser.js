import { applicationName } from './identity.js';
import { BrowserSession } from '../browser/session.js';
import { HOME_URL, localPages } from '../browser/registry.js';
import { renderError, pageErrors } from '../browser/pages/error.js';
import { renderBrowserTabs } from './browser-tabs.js';

export function openLocalUrl(url) {
  document.dispatchEvent(new CustomEvent('windows-xd:open-url', { detail: { url } }));
}
export class InternetAdventurer {
  constructor(
    manager,
    applications,
    progression,
    registry = localPages,
    openHotel = () => {},
    onSessionEnd = () => {},
    onAddressChange = () => {},
  ) {
    Object.assign(this, {
      manager,
      applications,
      progression,
      registry,
      openHotel,
      onSessionEnd,
      onAddressChange,
    });
    this.session = new BrowserSession(progression);
    this.generation = 0;
    this.retainedPages = new Map();
  }
  open(url) {
    const existing = this.instance?.element.isConnected;
    if (existing) {
      this.applications.restore(this.instance);
      if (url !== undefined) {
        this.session.add(url);
        this.load('switch');
      }
      return this.instance;
    }
    if (!this.session.tabs.length) this.session.add();
    if (url !== undefined) this.session.navigate(url);
    const title = applicationName('browser');
    const id = this.manager.spawn('desktopapp', {
      preview: true,
      windowClass: 'internet-adventurer',
      resizable: true,
      maximizable: true,
      minWidth: 320,
      minHeight: 240,
      content: {
        title,
        iconName: 'browser',
        body: `
      <div class="browser-toolbar"><button data-browser-action="back" title="Précédent" aria-label="Précédent">◀</button><button data-browser-action="forward" title="Suivant" aria-label="Suivant">▶</button><button data-browser-action="reload" title="Actualiser" aria-label="Actualiser">↻</button><button data-browser-action="home" title="Accueil" aria-label="Accueil">⌂</button>
      <form class="browser-address"><label>Adresse <input aria-label="Adresse Internet" maxlength="2048" autocomplete="off" spellcheck="false" /></label><button>Aller</button></form></div>
      <div class="browser-tabs" role="tablist" aria-label="Onglets"></div>
      <div class="browser-page" role="region" aria-label="Page Web"></div>
      <div class="window-status browser-statusbar"><span class="browser-status"></span><progress class="browser-progress" hidden></progress></div>`,
      },
      onDismiss: () => {
        this.disposePage();
        this.clearRetainedPages();
        this.onSessionEnd();
        clearTimeout(this.timer);
        this.generation++;
        this.observer?.disconnect();
        this.session.save();
        this.instance?.task.remove();
        this.applications.instances.delete('browser');
        this.instance = null;
        this.applications.onWindowState();
      },
    });
    this.instance = this.applications.attachWindow('browser', id, title, 'browser');
    const element = this.instance.element;
    element.classList.add('internet-adventurer');
    element.querySelector('.browser-address').addEventListener('submit', (event) => {
      event.preventDefault();
      this.navigate(element.querySelector('.browser-address input').value);
    });
    element.addEventListener('click', (event) => {
      // A site's anchors never navigate the host document, including future sites.
      if (event.target.closest('.browser-page a')) event.preventDefault();
      const link = event.target.closest('[data-browser-link]');
      if (link) {
        event.preventDefault();
        this.navigate(link.dataset.browserLink);
        return;
      }
      const button = event.target.closest('[data-browser-action]');
      if (!button) return;
      const action = button.dataset.browserAction;
      if (action === 'back') this.session.move(-1);
      if (action === 'forward') this.session.move(1);
      if (action === 'home') this.session.navigate(HOME_URL);
      if (action === 'new') this.session.add();
      if (action === 'select') this.session.select(button.dataset.tabId);
      if (action === 'close') {
        const closingActive = button.dataset.tabId === this.session.active;
        this.retainedPages.get(button.dataset.tabId)?.cleanup?.();
        this.retainedPages.delete(button.dataset.tabId);
        this.session.close(button.dataset.tabId);
        if (!this.session.tabs.length) {
          this.manager.close(this.instance.id);
          return;
        }
        if (!closingActive) {
          this.tabs();
          return;
        }
      }
      this.load(['select', 'new'].includes(action) ? 'switch' : 'navigate');
    });
    this.observer = new ResizeObserver(() => {
      if (element.hidden || !element.isConnected) return;
      const bounds = this.manager.movementBounds(element);
      element.style.left = `${Math.max(bounds.minX, Math.min(bounds.maxX, parseFloat(element.style.left) || 0))}px`;
      element.style.top = `${Math.max(bounds.minY, Math.min(bounds.maxY, parseFloat(element.style.top) || 0))}px`;
      this.manager.dragged.add(element);
    });
    this.observer.observe(element);
    this.applications.restore(this.instance);
    this.session.save();
    this.load();
    return this.instance;
  }
  navigate(url) {
    this.session.navigate(url);
    this.load();
  }
  tabs() {
    renderBrowserTabs(this.instance.element.querySelector('.browser-tabs'), this.session);
  }
  load(reason = 'navigate') {
    this.onAddressChange(this.session.address);
    this.disposePage(reason);
    clearTimeout(this.timer);
    const generation = ++this.generation;
    const element = this.instance.element;
    const resolved = this.registry.resolve(this.session.address, this.progression.data);
    this.session.title(
      resolved.page?.title ?? (pageErrors[resolved.error] ?? pageErrors.connection)[0],
    );
    this.tabs();
    element.querySelector('.browser-address input').value = this.session.address;
    element.querySelector('[data-browser-action=back]').disabled = this.session.tab.cursor === 0;
    element.querySelector('[data-browser-action=forward]').disabled =
      this.session.tab.cursor === this.session.tab.history.length - 1;
    const status = element.querySelector('.browser-status'),
      progress = element.querySelector('.browser-progress'),
      page = element.querySelector('.browser-page');
    status.textContent = 'Chargement...';
    progress.hidden = false;
    page.setAttribute('aria-busy', 'true');
    this.timer = setTimeout(() => {
      if (generation !== this.generation || !element.isConnected) return;
      const current = this.registry.resolve(this.session.address, this.progression.data);
      const cached = this.retainedPages.get(this.session.active);
      this.retainedPages.delete(this.session.active);
      if (cached && cached.address !== this.session.address) cached.cleanup?.();
      this.session.title(
        current.page?.title ?? (pageErrors[current.error] ?? pageErrors.connection)[0],
      );
      this.tabs();
      page.replaceChildren(
        cached && cached.address === this.session.address
          ? cached.node
          : current.page
            ? current.page.render({
                url: current.url,
                registry: this.registry,
                data: this.progression.data,
                progression: this.progression,
                onDispose: (cleanup) => {
                  this.pageCleanup = cleanup;
                },
                onResume: (resume) => {
                  this.pageResume = resume;
                },
                navigate: (url) => this.navigate(url),
                openHotel: this.openHotel,
                onSuperPlombierStart: () => this.onSuperPlombierStart?.(),
                onSuperPlombierVictory: () => this.onSuperPlombierVictory?.(),
              })
            : renderError(current.error),
      );
      if (cached && cached.address === this.session.address) {
        this.pageCleanup = cached.cleanup;
        this.pageResume = cached.resume;
        this.pageResume?.();
      }
      this.currentPage = {
        tabId: this.session.active,
        address: this.session.address,
        node: page.firstElementChild,
        preserve: current.page?.preserveOnTabSwitch,
      };
      if (current.page?.rememberVisit) this.session.recordVisit(current.page.url);
      page.scrollTop = 0;
      page.setAttribute('aria-busy', 'false');
      status.textContent = 'Terminé';
      progress.hidden = true;
    }, 200);
  }
  reset() {
    this.disposePage();
    this.clearRetainedPages();
    this.onSessionEnd();
    clearTimeout(this.timer);
    this.generation++;
    this.instance = null;
    this.session.restore();
  }
  disposePage(reason = 'navigate') {
    const cleanup = this.pageCleanup;
    if (reason === 'switch' && this.currentPage?.preserve && cleanup) {
      cleanup('pause');
      this.retainedPages.set(this.currentPage.tabId, {
        ...this.currentPage,
        cleanup,
        resume: this.pageResume,
      });
    } else cleanup?.();
    this.pageCleanup = null;
    this.pageResume = null;
    this.currentPage = null;
  }
  clearRetainedPages() {
    for (const page of this.retainedPages.values()) page.cleanup?.();
    this.retainedPages.clear();
  }
}
