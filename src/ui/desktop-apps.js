import definitions from '../config/desktop-apps.json' with { type: 'json' };
import filesystem from '../config/filesystem.json' with { type: 'json' };
import { bindFileActivation } from '../utils/activation.js';
import { fileIcon, icon } from './icons.js';
import { isArcadeExecutable } from './arcade-launcher.js';
import { VirtualTextFiles } from '../story/text-files.js';
import { VirtualFilesystem, virtualFileId } from '../story/virtual-filesystem.js';
import { completeBombArenaHandoff } from '../story/bomb-arena-handoff.js';
import { attachNotepad } from './notepad.js';
import { executableAssociation } from './executable-registry.js';
import { isMediaTrack } from './media-library.js';
import { fileTypeForName, getDisplayFileName, setHideKnownExtensions } from './file-names.js';
import { mountBombArena } from '../minigames/bomb-arena/view.js';

export const desktopApps = definitions;

// Locations are JSON keys, never host paths. No disk or network API is used.
export function explorerLocation(id) {
  const entry = Object.hasOwn(definitions, id)
    ? definitions[id]
    : Object.hasOwn(filesystem, id)
      ? filesystem[id]
      : null;
  if (!entry) throw new Error('Emplacement fictif inconnu.');
  return { ...entry, id };
}
export function explorerItem(location, item) {
  if (item.location) return explorerLocation(item.location);
  return {
    id: `${location.id}/${item.name}`,
    parent: location.id,
    address: `${location.address.replace(/\\$/, '')}\\${item.name}`,
    description: item.detail,
    items: [],
    image: item.image,
    text:
      item.text ??
      (item.image
        ? undefined
        : 'Windows XD ne peut pas ouvrir ce fichier. Aucune application associée.'),
  };
}

export function fileViewer(item) {
  if (item.location) return null;
  if (fileTypeForName(item.name) === 'text') return 'notepad';
  if (/\.jpg$/i.test(item.name)) return 'image';
  return 'generic';
}
export function localPicture(path) {
  return typeof path === 'string' && /^\.\/(?:wallpaper\.svg|covers\/[a-z0-9-]+\.svg)$/.test(path);
}

const explorerToolbarIcons = {
  back: '<path d="M22 9H43v23H22z" fill="url(#xp-folder)" stroke="#94700f"/><path d="M5 18 18 6v8h14v9H18v8z" fill="url(#xp-arrow)" stroke="#285d9c" stroke-linejoin="round"/><path d="m8 18 7-7" stroke="#dff5ff" stroke-width="2"/>',
  forward: '<path d="M5 9h21v23H5z" fill="url(#xp-folder)" stroke="#94700f"/><path d="m43 18-13-12v8H16v9h14v9z" fill="url(#xp-arrow)" stroke="#285d9c" stroke-linejoin="round"/><path d="m40 18-7-7" stroke="#dff5ff" stroke-width="2"/>',
  up: '<path d="M5 15h15l4 4h19v18H5z" fill="url(#xp-folder)" stroke="#94700f"/><path d="M23 35V21m0 0-7 7m7-7 7 7" fill="none" stroke="#2778b8" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><path d="M23 23v10" stroke="#e8f7ff" stroke-width="1.5"/>',
  search: '<circle cx="20" cy="19" r="12" fill="url(#xp-lens)" stroke="#36729a" stroke-width="2"/><circle cx="20" cy="19" r="8" fill="#e8f8ff" fill-opacity=".72"/><path d="m29 28 12 12" stroke="#4d5964" stroke-width="7" stroke-linecap="round"/><path d="m29 28 12 12" stroke="url(#xp-handle)" stroke-width="4.5" stroke-linecap="round"/><path d="M13 15a8 8 0 0 1 7-4" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>',
};
function explorerToolbarIcon(name) {
  return `<svg class="explorer-toolbar-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><defs><linearGradient id="xp-folder" x2="0" y2="1"><stop stop-color="#fff18a"/><stop offset="1" stop-color="#e99f16"/></linearGradient><linearGradient id="xp-arrow" x2="0" y2="1"><stop stop-color="#8ed9ff"/><stop offset="1" stop-color="#1671c5"/></linearGradient><linearGradient id="xp-lens" x2="0" y2="1"><stop stop-color="#a8ecff"/><stop offset="1" stop-color="#2786c6"/></linearGradient><linearGradient id="xp-handle" x2="0" y2="1"><stop stop-color="#747e88"/><stop offset="1" stop-color="#273642"/></linearGradient></defs>${explorerToolbarIcons[name]}</svg>`;
}

function isTextEntry(target) {
  return Boolean(
    target &&
      (target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName ?? '')),
  );
}

function normalizeExplorerAddress(value) {
  return String(value ?? '')
    .trim()
    .replace(/\//g, '\\')
    .replace(/\\+/g, '\\')
    .replace(/\\+$/, '')
    .toLocaleLowerCase('fr');
}

export class DesktopApplications {
  constructor(
    manager,
    taskbar,
    onWindowState = () => {},
    onLaunchArcade = null,
    textFiles = new VirtualTextFiles({ data: {}, save: () => true }),
    virtualFilesystem = null,
    onFilesystemChange = () => {},
    onOpenReceived = null,
    onLaunchExecutable = null,
    onBombArenaEvent = () => {},
    onBombArenaContinue = () => {},
    onBombArenaInterrupted = () => {},
  ) {
    Object.assign(this, {
      manager,
      taskbar,
      onWindowState,
      onLaunchArcade,
      onFilesystemChange,
      onOpenReceived,
      onLaunchExecutable,
      onBombArenaEvent,
      onBombArenaContinue,
      onBombArenaInterrupted,
    });
    this.textFiles = textFiles;
    this.virtualFilesystem = virtualFilesystem;
    this.instances = new Map();
  }
  open(kind) {
    if (!Object.hasOwn(definitions, kind)) return;
    const definition = explorerLocation(kind);
    const existing = this.instances.get(kind);
    if (existing?.element.isConnected) {
      this.restore(existing);
      return existing;
    }
    const id = this.manager.spawn('desktopapp', {
      preview: true,
      resizable: true,
      maximizable: true,
      minWidth: 520,
      minHeight: 330,
      x: 0.25,
      y: 0.12,
      content: {
        title: definition.title,
        iconName: definition.icon,
        body: `
        <div class="explorer-menu" role="menubar"><button type="button" data-explorer-menu="file" aria-haspopup="true" aria-expanded="false">Fichier</button><button type="button" data-explorer-menu="edit" aria-haspopup="true" aria-expanded="false">Édition</button><button type="button" data-explorer-menu="view" aria-haspopup="true" aria-expanded="false">Affichage</button><button type="button" data-explorer-menu="tools" aria-haspopup="true" aria-expanded="false">Outils</button><button type="button" data-explorer-menu="help" aria-haspopup="true" aria-expanded="false">Aide</button></div>
        <div class="explorer-toolbar" role="toolbar" aria-label="Boutons standard"><button type="button" class="explorer-toolbar-button explorer-back" disabled>${explorerToolbarIcon('back')}<span>Précédente</span></button><button type="button" class="explorer-toolbar-button explorer-forward" disabled>${explorerToolbarIcon('forward')}<span>Suivante</span></button><span class="explorer-toolbar-separator" aria-hidden="true"></span><button type="button" class="explorer-toolbar-button explorer-up" disabled>${explorerToolbarIcon('up')}<span>Remonter</span></button><span class="explorer-toolbar-separator" aria-hidden="true"></span><button type="button" class="explorer-toolbar-button explorer-search-toggle">${explorerToolbarIcon('search')}<span>Rechercher</span></button></div>
        <div class="explorer-address">Adresse <strong tabindex="0" role="button" aria-label="Modifier l’adresse"></strong><input class="explorer-address-input" aria-label="Adresse du dossier virtuel" hidden /><button type="button" class="xp-button explorer-address-go" hidden>Atteindre</button></div>
        <div class="explorer-search-panel" hidden><label>Rechercher des fichiers ou dossiers <input class="explorer-search-input" type="search" /></label><button type="button" class="xp-button explorer-search-submit">Rechercher</button><button type="button" class="xp-button explorer-search-clear">Effacer</button></div>
        <div class="explorer-content"><aside class="explorer-side-panel" aria-label="Tâches et emplacements"></aside><section class="explorer-items" aria-label="Contenu du dossier"></section></div>
        <div class="window-status explorer-status"></div>`,
      },
      onDismiss: () => {
        this.teardownExplorer(instance);
        this.instances.delete(kind);
        instance.task.remove();
        this.onWindowState();
      },
    });
    const instance = this.attachWindow(kind, id, definition.title, definition.icon);
    const { element } = instance;
    if (this.virtualFilesystem) this.setupExplorer(instance);
    element.querySelector('.explorer-up').addEventListener('click', () => this.up(instance));
    element.querySelector('.explorer-back').addEventListener('click', () => this.back(instance));
    element.querySelector('.explorer-forward').addEventListener('click', () => this.forward(instance));
    element.querySelector('.explorer-search-toggle').addEventListener('click', () => this.toggleSearch(instance));
    element.querySelector('.explorer-address strong').addEventListener('click', () => this.editAddress(instance));
    element.querySelector('.explorer-address strong').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this.editAddress(instance); }
    });
    element.querySelector('.explorer-address-go').addEventListener('click', () => this.goAddress(instance));
    element.querySelector('.explorer-address-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.goAddress(instance);
      if (event.key === 'Escape') this.cancelAddress(instance);
    });
    element.querySelector('.explorer-search-submit').addEventListener('click', () => this.search(instance));
    element.querySelector('.explorer-search-clear').addEventListener('click', () => {
      element.querySelector('.explorer-search-input').value = '';
      this.cancelSearch(instance);
    });
    element.querySelector('.explorer-search-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.search(instance);
      if (event.key === 'Escape') this.cancelSearch(instance);
    });
    element.querySelectorAll('[data-explorer-menu]').forEach((button) =>
      button.addEventListener('click', () => this.openExplorerMenu(instance, button.dataset.explorerMenu, button)));
    element
      .querySelectorAll('[data-location]')
      .forEach((button) =>
        button.addEventListener('click', () =>
          this.render(instance, explorerLocation(button.dataset.location)),
        ),
      );
    this.render(instance, definition);
    this.restore(instance);
    return instance;
  }
  attachWindow(kind, id, title, iconName) {
    const element = this.manager.windows.get(id).element;
    const task = document.createElement('button');
    task.className = 'task-tab desktop-app-task';
    task.dataset.app = kind;
    task.dataset.windowId = String(id);
    task.innerHTML = icon(iconName);
    const label = document.createElement('span');
    label.textContent = title;
    task.append(label);
    task.title = title;
    this.taskbar.insertBefore(task, this.taskbar.querySelector('.tray'));
    const managedWindow = this.manager.windows.get(id);
    if (managedWindow) managedWindow.taskButton = task;
    const instance = { id, kind, element, task, history: [], forwardHistory: [], sortBy: 'default', searchResults: null };
    this.instances.set(kind, instance);
    const minimize = document.createElement('button');
    minimize.className = 'msn-minimize';
    minimize.textContent = '−';
    minimize.setAttribute('aria-label', `Réduire ${title}`);
    minimize.addEventListener('click', () => {
      const minimized = this.manager.minimize?.(element);
      if (minimized === false) return;
      if (!this.manager.minimize) {
        element.hidden = true;
        task.setAttribute('aria-pressed', 'false');
      }
      instance.onMinimize?.();
      this.onWindowState();
    });
    element
      .querySelector('.titlebar')
      .insertBefore(
        minimize,
        element.querySelector('.maximize-button') ?? element.querySelector('.close-button'),
      );
    task.addEventListener('click', () => {
      const action = this.manager.toggleTaskbarWindow?.(element);
      if (action) {
        if (action === 'minimized') instance.onMinimize?.();
        else instance.onRestore?.();
        this.onWindowState();
        return;
      }
      this.restore(instance);
    });
    this.manager.syncTaskbarButtons?.();
    return instance;
  }
  attachExistingWindow(kind, id, title, iconName) {
    const existing = this.instances.get(kind);
    if (existing?.element.isConnected) {
      this.restore(existing);
      return existing;
    }
    if (existing) {
      existing.task.remove();
      this.instances.delete(kind);
    }
    const managed = this.manager.windows.get(id);
    if (!managed) return null;
    const instance = this.attachWindow(kind, id, title, iconName);
    const onDismiss = managed.onDismiss;
    managed.onDismiss = (...args) => {
      try {
        onDismiss?.(...args);
      } finally {
        if (this.instances.get(kind) === instance) this.instances.delete(kind);
        instance.task.remove();
        this.onWindowState();
      }
    };
    return instance;
  }
  openFile(location, item) {
    const fileId = item.fileId ?? virtualFileId(location.id, item.name);
    if (this.virtualFilesystem && !this.virtualFilesystem.exists(fileId)) return;
    if (isMediaTrack(item) && this.onLaunchExecutable)
      return this.onLaunchExecutable('windows-media-play', item, fileId);
    const executable = executableAssociation(item, fileId);
    if (executable === 'chaos-survival' && this.onLaunchArcade) return this.onLaunchArcade();
    if (executable === 'bomb-arena') return this.openBombArena(item, fileId);
    if (executable === 'mini-game' && item.receivedFile && this.onOpenReceived)
      return this.onOpenReceived(item);
    if (
      [
        'windows-love-messenger',
        'internet-adventurer',
        'windows-media-play',
        'toolbar-installer',
        'smiley-pack-installer',
      ].includes(executable) &&
      this.onLaunchExecutable
    ) return this.onLaunchExecutable(executable, item, fileId);
    if (isArcadeExecutable(item) && this.onLaunchArcade) return this.onLaunchArcade();
    if (executable === 'unknown') return this.openExecutableError(fileId);
    const viewer = fileViewer(item);
    if (!viewer) return;
    const key = `file:${location.id}/${item.name}`;
    const existing = this.instances.get(key);
    if (existing?.element.isConnected) {
      this.restore(existing);
      return existing;
    }
    const title =
      viewer === 'generic'
        ? item.name
        : `${item.name} — ${viewer === 'notepad' ? 'Bloc-notes' : 'Visionneuse d’images'}`;
    const iconName = viewer === 'image' ? 'picture' : 'document';
    const windowOptions =
      viewer === 'notepad'
        ? { resizable: true, maximizable: true, minWidth: 360, minHeight: 260 }
        : viewer === 'image'
          ? { resizable: true, maximizable: true, minWidth: 320, minHeight: 240 }
          : {};
    const id = this.manager.spawn('desktopapp', {
      preview: true,
      ...windowOptions,
      content: {
        title: 'Document',
        iconName,
        body:
          viewer === 'generic'
            ? '<div class="generic-file-content"><pre></pre><p class="generic-file-unavailable" hidden>Windows ne peut pas ouvrir ce fichier. Aucun contenu ni visualiseur spécifique n’est défini pour ce fichier fictif.</p></div><div class="window-status">Windows XD · Lecture seule</div>'
            : viewer === 'notepad'
              ? '<div class="msn-menu notepad-menu"></div><textarea class="notepad-content" aria-label="Contenu du fichier texte" spellcheck="false"></textarea><div class="window-status" role="status"></div><section class="notepad-confirm" role="dialog" aria-label="Bloc-notes : enregistrer les modifications" aria-modal="true" hidden><strong>Bloc-notes Windows XD</strong><p></p><div><button class="xp-button" data-answer="yes">Oui</button><button class="xp-button" data-answer="no">Non</button><button class="xp-button" data-answer="cancel">Annuler</button></div></section>'
              : '<div class="explorer-menu file-menu">Fichier <span>Affichage</span><span>Image</span><span>Aide</span></div><div class="picture-stage"><img class="picture-content" alt="" /><p class="picture-error" hidden>Aperçu non disponible pour cette image.</p></div><div class="window-status">Visionneuse d’images Windows XD</div>',
      },
      onDismiss: () => {
        instance.disposeEditor?.();
        this.instances.delete(key);
        instance.task.remove();
        this.onWindowState();
      },
    });
    const instance = this.attachWindow(key, id, title, iconName);
    instance.fileId = fileId;
    const { element } = instance;
    element.classList.add(`file-${viewer}`);
    element.querySelector('.window-title > span').textContent = title;
    element.querySelector('.close-button').setAttribute('aria-label', `Fermer ${item.name}`);
    if (viewer === 'generic') {
      element.querySelector('.generic-file-content pre').textContent = item.text ?? '';
      element.querySelector('.generic-file-unavailable').hidden =
        item.text !== undefined && item.text !== null;
    } else if (viewer === 'notepad')
      instance.disposeEditor = attachNotepad(
        instance,
        this.manager,
        this.textFiles,
        `${location.id}/${item.name}`,
        item,
      );
    else {
      const image = element.querySelector('.picture-content');
      const unavailable = () => {
        image.hidden = true;
        element.querySelector('.picture-error').hidden = false;
      };
      image.alt = item.name;
      image.addEventListener('error', unavailable);
      if (localPicture(item.image)) image.src = item.image;
      else unavailable();
    }
    this.restore(instance);
    return instance;
  }
  openExecutableError(fileId) {
    const key = `executable-error:${fileId}`;
    const existing = this.instances.get(key);
    if (existing?.element.isConnected) {
      this.restore(existing);
      return existing;
    }
    const title = 'Windows XD';
    const id = this.manager.spawn('desktopapp', {
      preview: true,
      content: {
        title,
        iconName: 'error',
        body: '<section class="executable-error-dialog" role="alert"><span class="executable-error-symbol" aria-hidden="true">×</span><p>Impossible d’exécuter cette application.</p><button type="button" class="xp-button">OK</button></section>',
      },
      onDismiss: () => {
        this.instances.delete(key);
        instance.task.remove();
        this.onWindowState();
      },
    });
    const instance = this.attachWindow(key, id, title, 'error');
    instance.element.classList.add('executable-error-window');
    instance.element.querySelector('.executable-error-dialog button').addEventListener('click', () =>
      this.manager.close(id),
    );
    this.restore(instance);
    return instance;
  }
  openMissingFileShortcut(file) {
    if (this.virtualFilesystem?.exists(file?.fileId)) return null;
    const fileId = typeof file?.fileId === 'string' ? file.fileId : '';
    const key = `missing-shortcut:${fileId}`;
    const existing = this.instances.get(key);
    if (existing?.element.isConnected) {
      this.restore(existing);
      return existing;
    }
    const title = 'Windows XD';
    const id = this.manager.spawn('desktopapp', {
      preview: true,
      content: {
        title,
        iconName: 'error',
        body: '<section class="executable-error-dialog" role="alert"><span class="executable-error-symbol" aria-hidden="true">×</span><p class="missing-shortcut-message"></p><button type="button" class="xp-button">OK</button></section>',
      },
      onDismiss: () => {
        this.instances.delete(key);
        instance.task.remove();
        this.onWindowState();
      },
    });
    const instance = this.attachWindow(key, id, title, 'error');
    instance.element.querySelector('.missing-shortcut-message').textContent =
      `Impossible de trouver le fichier cible « ${String(file?.name ?? '')} ».`;
    instance.element.querySelector('.executable-error-dialog button').addEventListener('click', () =>
      this.manager.close(id),
    );
    this.restore(instance);
    return instance;
  }
  restore(instance) {
    if (this.manager.activate) this.manager.activate(instance.element);
    else {
      instance.element.hidden = false;
      instance.element.style.zIndex = ++this.manager.z;
      instance.task.setAttribute('aria-pressed', 'true');
    }
    instance.onRestore?.();
    this.onWindowState();
  }
  home(instance) {
    this.navigate(instance, explorerLocation('computer'));
  }
  up(instance) {
    if (instance.current.parent) this.navigate(instance, explorerLocation(instance.current.parent));
  }
  back(instance) {
    const previous = instance.history.pop();
    if (!previous) return;
    if (instance.current) instance.forwardHistory.push(instance.current);
    this.navigate(instance, previous, false);
  }
  forward(instance) {
    const next = instance.forwardHistory.pop();
    if (!next) return;
    if (instance.current) instance.history.push(instance.current);
    this.navigate(instance, next, false);
  }
  navigate(instance, definition, remember = true) {
    if (remember && instance.current && instance.current.id !== definition.id) {
      instance.history.push(instance.current);
      instance.forwardHistory = [];
    }
    instance.searchResults = null;
    return this.render(instance, definition, false);
  }
  editAddress(instance) {
    const input = instance.element.querySelector('.explorer-address-input');
    input.value = instance.current.address;
    input.hidden = false;
    instance.element.querySelector('.explorer-address-go').hidden = false;
    instance.element.querySelector('.explorer-address strong').hidden = true;
    input.focus();
    input.select?.();
  }
  cancelAddress(instance) {
    instance.element.querySelector('.explorer-address-input').hidden = true;
    instance.element.querySelector('.explorer-address-go').hidden = true;
    instance.element.querySelector('.explorer-address strong').hidden = false;
  }
  goAddress(instance) {
    const input = instance.element.querySelector('.explorer-address-input');
    const requested = normalizeExplorerAddress(input.value);
    const locations = this.allExplorerLocations();
    const target = locations.find((location) => [location.address, location.title, location.id]
      .some((candidate) => normalizeExplorerAddress(candidate) === requested));
    if (target) {
      this.cancelAddress(instance);
      this.navigate(instance, target);
      return true;
    }
    for (const location of locations) {
      const file = location.items.find((item) => !item.location &&
        normalizeExplorerAddress(`${location.address.replace(/[\\/]+$/, '')}\\${item.name}`) === requested);
      if (file) {
        this.cancelAddress(instance);
        this.openFile(location, file);
        return true;
      }
    }
    instance.element.querySelector('.explorer-status').textContent = 'Windows XD : emplacement virtuel introuvable.';
    return false;
  }
  toggleSearch(instance) {
    const panel = instance.element.querySelector('.explorer-search-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) instance.element.querySelector('.explorer-search-input').focus();
  }
  cancelSearch(instance) {
    instance.searchResults = null;
    this.render(instance, instance.current, false);
  }
  search(instance) {
    const query = instance.element.querySelector('.explorer-search-input').value.trim().toLocaleLowerCase('fr');
    if (!query) return this.cancelSearch(instance);
    const results = [];
    const seen = new Set();
    const visit = (location) => {
      if (!location || seen.has(location.id)) return;
      seen.add(location.id);
      for (const item of location.items) {
        if (item.name.toLocaleLowerCase('fr').includes(query)) results.push({ ...item, _sourceLocationId: location.id });
        if (item.location) visit(this.virtualFilesystem.getLocation(item.location), seen);
      }
    };
    for (const root of ['computer', 'folder', 'bin']) visit(this.virtualFilesystem.getLocation(root));
    instance.searchResults = results;
    this.render(instance, instance.current, false);
    instance.element.querySelector('.explorer-status').textContent = `${results.length} résultat(s) pour « ${query} »`;
    return results.length;
  }
  render(instance, definition, remember = true) {
    instance.history ??= [];
    instance.forwardHistory ??= [];
    this.closeExplorerOverlays(instance);
    if (instance.searchResults && definition.id !== instance.current.id) instance.searchResults = null;
    const selectedId = instance.selectedItem?.fileId ??
      (instance.selectedItem?.location ? `location:${instance.selectedItem.location}` : instance.selectedItem?.name);
    instance.selectedItem = null;
    instance.selectedButton = null;
    if (remember && instance.current && instance.current.id !== definition.id) {
      instance.history.push(instance.current);
      instance.forwardHistory = [];
    }
    if (this.virtualFilesystem && !instance.searchResults) definition = this.virtualFilesystem.getLocation(definition.id);
    if (!instance.searchResults) instance.current = definition;
    const { element } = instance;
    const preferences = this.explorerPreferences();
    instance.sortBy = preferences.sortBy;
    element.querySelector('.explorer-address strong').textContent = instance.current.address;
    element.querySelector('.explorer-address-input').value = instance.current.address;
    element.querySelector('.explorer-back').disabled = !instance.history.length;
    element.querySelector('.explorer-forward').disabled = !instance.forwardHistory.length;
    element.querySelector('.explorer-up').disabled = !instance.current.parent;
    // Keep the navigation bar available when an older save has toolbarVisible=false.
    element.querySelector('.explorer-toolbar').hidden = false;
    element.querySelector('.explorer-address').hidden = !preferences.addressVisible;
    element.querySelector('.explorer-status').hidden = !preferences.statusVisible;
    const content = element.querySelector('.explorer-items');
    content.dataset ??= {};
    content.dataset.view = 'icons';
    content.replaceChildren();
    const items = [...(instance.searchResults ?? definition.items)];
    const compare = (a, b) => {
      if (instance.sortBy === 'type') return String(a.detail ?? '').localeCompare(String(b.detail ?? ''), 'fr') || a.name.localeCompare(b.name, 'fr');
      if (instance.sortBy === 'size') {
        const aSize = a.fileId ? this.virtualFilesystem?.metadata(a.fileId)?.size : null;
        const bSize = b.fileId ? this.virtualFilesystem?.metadata(b.fileId)?.size : null;
        if (Number.isFinite(aSize) || Number.isFinite(bSize)) return (aSize ?? Infinity) - (bSize ?? Infinity) || a.name.localeCompare(b.name, 'fr');
      }
      return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    };
    if (instance.sortBy !== 'default') items.sort(compare);
    for (const item of items) {
      const button = document.createElement('button');
      button.className = 'explorer-item';
      button.innerHTML = icon(fileIcon(item));
      const label = document.createElement('strong');
      label.textContent = getDisplayFileName(item);
      const detail = document.createElement('small');
      detail.textContent = item.location ? 'Dossier' : item.detail ?? 'Type de fichier inconnu';
      button.append(label, detail);
      if (item.fileId) button.dataset.fileId = item.fileId;
      if (item._sourceLocationId) button.dataset.sourceLocation = item._sourceLocationId;
      button.setAttribute?.('aria-selected', 'false');
      button.addEventListener('click', () => {
        instance.selectedItem = item;
        instance.selectedButton = button;
        for (const row of content.children) {
          row.classList?.remove('is-selected');
          row.setAttribute?.('aria-selected', 'false');
        }
        button.classList?.add('is-selected');
        button.setAttribute?.('aria-selected', 'true');
        this.renderExplorerSidePanel(instance);
      });
      const activate = () =>
        item.location
          ? this.navigate(instance, explorerLocation(item.location))
          : this.openFile(item._sourceLocationId
            ? explorerLocation(item._sourceLocationId)
            : this.virtualFilesystem ? explorerLocation(instance.current.id) : instance.current, item);
      bindFileActivation(button, activate);
      if (this.virtualFilesystem) {
        button.addEventListener('contextmenu', (event) => {
          event.preventDefault();
          instance.selectedItem = item;
          instance.selectedButton = button;
          for (const row of content.children) {
            row.classList?.remove('is-selected');
            row.setAttribute?.('aria-selected', 'false');
          }
          button.classList?.add('is-selected');
          button.setAttribute?.('aria-selected', 'true');
          this.renderExplorerSidePanel(instance);
          this.showExplorerContext(instance, item, event);
        });
      }
      content.append(button);
      const itemSelectionKey = item.fileId ?? (item.location ? `location:${item.location}` : item.name);
      if (itemSelectionKey === selectedId) {
        instance.selectedItem = item;
        instance.selectedButton = button;
        button.classList?.add('is-selected');
        button.setAttribute?.('aria-selected', 'true');
      }
    }
    if (!items.length) {
      if (localPicture(definition.image)) {
        const image = document.createElement('img');
        image.className = 'explorer-image';
        image.src = definition.image;
        image.alt = definition.description;
        content.append(image);
      }
      const empty = document.createElement('p');
      empty.className = 'explorer-empty';
      empty.textContent = instance.searchResults
        ? 'Aucun fichier ou dossier ne correspond à cette recherche.'
        : definition.text ??
        definition.emptyText ??
        (definition.image ? 'Aperçu de l’image' : undefined) ??
        (instance.kind === 'bin'
          ? 'La corbeille est vide.'
          : 'Ce dossier ne contient aucun fichier.');
      content.append(empty);
    }
    if (!instance.searchResults) element.querySelector('.explorer-status').textContent =
      `${items.length} objet(s) · Windows XD`;
    this.renderExplorerSidePanel(instance, definition, items);
  }
  renderExplorerSidePanel(instance, definition = instance.current, visibleItems = null) {
    const panel = instance.element.querySelector('.explorer-side-panel');
    if (!panel || !definition) return;
    panel.replaceChildren();
    const documentRef = panel.ownerDocument ?? globalThis.document;
    const makeSection = (name, heading, contentNodes) => {
      const section = documentRef.createElement('section');
      section.className = 'explorer-side-section';
      section.dataset ??= {};
      section.dataset.section = name;
      const toggle = documentRef.createElement('button');
      toggle.type = 'button';
      toggle.className = 'explorer-side-heading';
      toggle.setAttribute?.('aria-expanded', 'true');
      toggle.innerHTML = `<span class="explorer-side-chevron" aria-hidden="true">⌄</span><strong>${heading}</strong>`;
      const body = documentRef.createElement('div');
      body.className = 'explorer-side-section-body';
      body.append(...contentNodes);
      toggle.addEventListener('click', () => {
        body.hidden = !body.hidden;
        toggle.setAttribute?.('aria-expanded', String(!body.hidden));
        const chevron = toggle.querySelector?.('.explorer-side-chevron');
        if (chevron) chevron.textContent = body.hidden ? '›' : '⌄';
      });
      section.append(toggle, body);
      panel.append(section);
    };
    const makeLink = (label, iconName, locationId, disabled = false) => {
      const link = documentRef.createElement('button');
      link.type = 'button';
      link.className = 'explorer-side-link';
      link.disabled = disabled;
      link.dataset ??= {};
      if (locationId) link.dataset.explorerSideLocation = locationId;
      link.innerHTML = `${icon(iconName)}<span>${label}</span>`;
      return link;
    };
    const destinations = [
      ['Mes documents', 'folder', 'folder'],
      ['Documents partagés', 'folder', 'shared-profile'],
      ['Panneau de configuration', 'computer', null],
      ['Poste de travail', 'computer', 'computer'],
      ['Mes fichiers reçus', 'download', 'downloads'],
      ['Corbeille', 'bin', 'bin'],
    ].filter(([, , id]) => id !== definition.id);
    makeSection('locations', 'Autres emplacements', destinations.map(([label, iconName, id]) =>
      makeLink(label, iconName, id, !id)));

    const selected = instance.selectedItem;
    const details = [];
    if (selected) {
      const metadata = selected.fileId ? this.virtualFilesystem?.metadata(selected.fileId) : null;
      const name = metadata?.name ?? selected.name ?? selected.title ?? 'Élément sélectionné';
      const type = metadata?.type ?? (selected.location ? 'Dossier' : selected.detail ?? 'Type inconnu');
      const path = metadata?.path ?? (selected.location
        ? this.virtualFilesystem?.getLocation(selected.location)?.address
        : `${definition.address.replace(/\\$/, '')}\\${name}`);
      for (const [label, value] of [
        ['Nom', name], ['Type', type],
        ...(metadata?.size !== undefined ? [['Taille', metadata.size === null ? 'Inconnue' : `${metadata.size} octets`]] : []),
        ['Emplacement', path ?? definition.address],
      ]) {
        const row = documentRef.createElement('div');
        row.className = 'explorer-side-detail-row';
        const key = documentRef.createElement('strong');
        key.textContent = `${label} : `;
        const valueNode = documentRef.createElement('span');
        valueNode.textContent = String(value);
        row.append(key, valueNode);
        details.push(row);
      }
    } else {
      const summary = documentRef.createElement('p');
      summary.className = 'explorer-side-summary';
      const items = visibleItems ?? definition.items ?? [];
      summary.textContent = `${definition.title ?? definition.address} · ${items.length} objet(s)`;
      details.push(summary);
    }
    makeSection('details', 'Détails', details);
  }
  explorerPreferences() {
    return this.virtualFilesystem?.progression?.data?.explorerPreferences ?? {
      hideKnownExtensions: true, sortBy: 'default',
      toolbarVisible: true, addressVisible: true, statusVisible: true,
    };
  }
  allExplorerLocations() {
    const found = new Map();
    const visit = (id) => {
      if (found.has(id)) return;
      let location;
      try { location = this.virtualFilesystem.getLocation(id); } catch { return; }
      found.set(id, location);
      for (const item of location.items) if (item.location) visit(item.location);
    };
    for (const id of ['computer', 'folder', 'bin']) visit(id);
    return [...found.values()];
  }
  openExplorerMenu(instance, name, anchor = null) {
    const body = instance.element.querySelector('.window-body');
    let menu = instance.commandMenu;
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'explorer-command-menu';
      menu.setAttribute('role', 'menu');
      menu.hidden = true;
      body.append(menu);
      menu.addEventListener('keydown', (event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
        buttons[next].focus();
      });
      instance.commandMenu = menu;
    }
    if (!menu.hidden && menu.dataset.menu === name) {
      menu.hidden = true;
      anchor?.setAttribute?.('aria-expanded', 'false');
      return;
    }
    const current = this.explorerPreferences();
    const commands = {
      file: [
        ['open', 'Ouvrir', !instance.selectedItem],
        ['delete', 'Supprimer', !instance.selectedItem?.fileId || !this.virtualFilesystem?.canDelete(instance.selectedItem.fileId)],
        ['properties', 'Propriétés', !instance.selectedItem],
        ['close', 'Fermer'],
      ],
      edit: [['select-all', 'Sélectionner tout'], ['clear-selection', 'Annuler la sélection']],
      view: [
        ['sort-name', 'Trier par nom' + (current.sortBy === 'name' ? ' ✓' : '')],
        ['sort-type', 'Trier par type' + (current.sortBy === 'type' ? ' ✓' : '')],
        ['sort-size', 'Trier par taille' + (current.sortBy === 'size' ? ' ✓' : '')],
        ['toggle-address', `${current.addressVisible ? '✓' : '□'} Barre d’adresse`],
        ['toggle-status', `${current.statusVisible ? '✓' : '□'} Barre d’état`],
      ],
      tools: [['folder-options', 'Options des dossiers…']],
      help: [['help', 'Aide de Poste de travail']],
    }[name] ?? [];
    menu.replaceChildren();
    menu.dataset.menu = name;
    for (const [command, label, disabled] of commands) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'menuitem');
      button.dataset.command = command;
      button.disabled = Boolean(disabled);
      button.textContent = label;
      button.addEventListener('click', () => this.runExplorerCommand(instance, command));
      menu.append(button);
    }
    menu.hidden = false;
    for (const button of instance.element.querySelectorAll('[data-explorer-menu]'))
      button.setAttribute('aria-expanded', String(button.dataset.explorerMenu === name));
    const bodyRect = body.getBoundingClientRect();
    const anchorRect = anchor?.getBoundingClientRect?.();
    menu.style.left = `${Math.max(0, (anchorRect?.left ?? bodyRect.left) - bodyRect.left)}px`;
    menu.style.top = `${Math.max(0, (anchorRect?.bottom ?? bodyRect.top + 24) - bodyRect.top)}px`;
    menu.querySelector('button:not(:disabled)')?.focus();
  }
  runExplorerCommand(instance, command) {
    const menu = instance.commandMenu;
    if (menu) menu.hidden = true;
    const item = instance.selectedItem;
    if (command === 'open' && item) {
      if (item.location) this.navigate(instance, explorerLocation(item.location));
      else this.openFile(item._sourceLocationId
        ? explorerLocation(item._sourceLocationId)
        : this.virtualFilesystem ? explorerLocation(instance.current.id) : instance.current, item);
    } else if (command === 'delete' && item) this.askDelete(instance, item);
    else if (command === 'properties' && item) this.showProperties(instance, item);
    else if (command === 'close') this.manager.close(instance.id);
    else if (command === 'select-all' || command === 'clear-selection') {
      const rows = [...instance.element.querySelector('.explorer-items').querySelectorAll('.explorer-item')];
      const select = command === 'select-all';
      for (const row of rows) {
        row.classList?.toggle?.('is-selected', select);
        row.setAttribute('aria-selected', String(select));
      }
      instance.selectedItem = select ? instance.current.items[0] ?? null : null;
      instance.selectedButton = select ? rows[0] ?? null : null;
    } else if (command.startsWith('sort-')) {
      this.updateExplorerPreferences(instance, { sortBy: command.slice('sort-'.length) });
    } else if (command === 'toggle-address' || command === 'toggle-status') {
      const key = { 'toggle-address': 'addressVisible', 'toggle-status': 'statusVisible' }[command];
      this.updateExplorerPreferences(instance, { [key]: !this.explorerPreferences()[key] });
    } else if (command === 'folder-options') this.showFolderOptions(instance);
    else if (command === 'help') this.showExplorerHelp(instance);
    return true;
  }
  updateExplorerPreferences(instance, patch) {
    const progression = this.virtualFilesystem?.progression;
    if (!progression) return false;
    const previous = this.explorerPreferences();
    const next = { ...previous, ...patch };
    progression.data.explorerPreferences = next;
    if (!progression.save()) {
      progression.data.explorerPreferences = previous;
      instance.element.querySelector('.explorer-status').textContent = 'Windows XD : impossible d’enregistrer cette préférence.';
      return false;
    }
    setHideKnownExtensions(next.hideKnownExtensions);
    const optionsDialog = instance.folderOptionsDialog;
    const keepOptionsOpen = optionsDialog && !optionsDialog.hidden;
    this.refreshExplorers();
    if (keepOptionsOpen) {
      optionsDialog.hidden = false;
      optionsDialog.querySelector('[data-hide-extensions]').checked = next.hideKnownExtensions;
    }
    this.onExplorerPreferencesChanged?.(next);
    return true;
  }
  showFolderOptions(instance) {
    let dialog = instance.folderOptionsDialog;
    if (!dialog) {
      dialog = document.createElement('section');
      dialog.className = 'explorer-dialog explorer-options-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', 'Options des dossiers');
      const title = document.createElement('strong'); title.textContent = 'Options des dossiers';
      const tabs = document.createElement('div'); tabs.className = 'explorer-options-tabs';
      for (const [id, label] of [['general', 'Général'], ['view', 'Affichage']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'xp-button';
        button.dataset.optionsTab = id; button.textContent = label; tabs.append(button);
      }
      const pane = document.createElement('div'); pane.className = 'explorer-options-pane';
      const checkLabel = document.createElement('label'); checkLabel.className = 'explorer-extension-option';
      const check = document.createElement('input'); check.type = 'checkbox'; check.dataset.hideExtensions = 'true';
      const checkText = document.createElement('span'); checkText.textContent = 'Masquer les extensions des fichiers dont le type est connu';
      checkLabel.append(check, checkText);
      pane.append(checkLabel);
      const general = document.createElement('p'); general.className = 'explorer-general-note';
      general.textContent = 'Les dossiers s’ouvrent dans cette fenêtre. Les options d’affichage sont partagées avec Windows XD.';
      const buttons = document.createElement('div'); buttons.className = 'explorer-options-actions';
      for (const [action, label] of [['defaults', 'Paramètres par défaut'], ['apply', 'Appliquer'], ['cancel', 'Annuler'], ['ok', 'OK']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'xp-button'; button.dataset.optionsAction = action; button.textContent = label; buttons.append(button);
      }
      dialog.append(title, tabs, pane, general, buttons); dialog.hidden = true;
      instance.element.querySelector('.window-body').append(dialog);
      instance.folderOptionsDialog = dialog;
      tabs.addEventListener('click', (event) => {
        const tab = event.target.closest?.('[data-options-tab]')?.dataset.optionsTab;
        if (!tab) return;
        dialog.dataset.activeTab = tab;
        pane.hidden = tab !== 'view'; general.hidden = tab !== 'general';
        for (const button of tabs.children) button.setAttribute('aria-selected', String(button.dataset.optionsTab === tab));
      });
      buttons.addEventListener('click', (event) => {
        const action = event.target.closest?.('[data-options-action]')?.dataset.optionsAction;
        if (action === 'defaults') check.checked = true;
        if (action === 'apply' || action === 'ok') {
          const success = this.updateExplorerPreferences(instance, { hideKnownExtensions: check.checked });
          if (success && action === 'ok') dialog.hidden = true;
        }
        if (action === 'cancel') dialog.hidden = true;
      });
    }
    dialog.querySelector('[data-hide-extensions]').checked = this.explorerPreferences().hideKnownExtensions;
    dialog.dataset.activeTab = 'view';
    dialog.querySelector('.explorer-options-pane').hidden = false;
    dialog.querySelector('.explorer-general-note').hidden = true;
    dialog.hidden = false;
    dialog.querySelector('[data-options-tab="view"]')?.setAttribute('aria-selected', 'true');
    dialog.querySelector('[data-hide-extensions]').focus();
  }
  showExplorerHelp(instance) {
    let dialog = instance.helpDialog;
    if (!dialog) {
      dialog = document.createElement('section');
      dialog.className = 'explorer-dialog explorer-help-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', 'Aide de Poste de travail');
      const title = document.createElement('strong'); title.textContent = 'Aide de Poste de travail';
      const help = document.createElement('ul');
      for (const text of ['Double-cliquez sur un dossier ou un fichier pour l’ouvrir.', 'Utilisez Précédente, Suivante et Remonter pour naviguer.', 'Le menu Affichage permet de changer la présentation et le tri.', 'Outils → Options des dossiers permet d’afficher les extensions.', 'Sélectionnez un fichier puis Fichier → Propriétés pour consulter ses informations.']) {
        const item = document.createElement('li'); item.textContent = text; help.append(item);
      }
      const close = document.createElement('button'); close.type = 'button'; close.className = 'xp-button'; close.textContent = 'Fermer';
      dialog.append(title, help, close); dialog.hidden = true;
      instance.element.querySelector('.window-body').append(dialog);
      close.addEventListener('click', () => { dialog.hidden = true; });
      instance.helpDialog = dialog;
    }
    dialog.hidden = false;
    dialog.querySelector('button').focus();
  }
  setupExplorer(instance) {
    const body = instance.element.querySelector('.window-body');
    const content = instance.element.querySelector('.explorer-items');
    instance.element.querySelector('.explorer-side-panel').addEventListener('click', (event) => {
      const button = event.target?.closest?.('[data-explorer-side-location]');
      const locationId = button?.dataset?.explorerSideLocation;
      if (!locationId || button.disabled) return;
      const location = this.virtualFilesystem?.getLocation(locationId);
      if (location) this.navigate(instance, location);
    });
    const menu = document.createElement('div');
    menu.className = 'explorer-context-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    const actions = [
      ['open', 'Ouvrir'],
      ['extract', 'Extraire avec WinRoar'],
      ['delete', 'Supprimer'],
      ['properties', 'Propriétés'],
    ];
    for (const [action, label] of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.explorerAction = action;
      button.setAttribute('role', 'menuitem');
      button.textContent = label;
      menu.append(button);
    }
    const confirmation = document.createElement('section');
    confirmation.className = 'explorer-dialog';
    confirmation.setAttribute('role', 'dialog');
    confirmation.setAttribute('aria-modal', 'true');
    confirmation.setAttribute('aria-label', 'Confirmer la suppression');
    confirmation.hidden = true;
    const question = document.createElement('p');
    const answers = document.createElement('div');
    for (const [answer, label] of [['yes', 'Oui'], ['no', 'Non']]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'xp-button';
      button.dataset.deleteAnswer = answer;
      button.textContent = label;
      answers.append(button);
    }
    confirmation.append(question, answers);
    const properties = document.createElement('section');
    properties.className = 'explorer-dialog explorer-properties';
    properties.setAttribute('role', 'dialog');
    properties.setAttribute('aria-modal', 'true');
    properties.setAttribute('aria-label', 'Propriétés du fichier');
    properties.hidden = true;
    const propertyTitle = document.createElement('strong');
    const propertyList = document.createElement('dl');
    const closeProperties = document.createElement('button');
    closeProperties.type = 'button';
    closeProperties.className = 'xp-button';
    closeProperties.textContent = 'Fermer';
    properties.append(propertyTitle, propertyList, closeProperties);
    body.append(menu, confirmation, properties);
    instance.explorerMenu = menu;
    instance.explorerConfirmation = confirmation;
    instance.explorerProperties = properties;
    const closeOutside = (event) => {
      if (!menu.contains?.(event.target)) menu.hidden = true;
      if (instance.commandMenu && !instance.commandMenu.contains?.(event.target) &&
        !event.target?.closest?.('[data-explorer-menu]')) {
        instance.commandMenu.hidden = true;
        for (const button of instance.element.querySelectorAll?.('[data-explorer-menu]') ?? [])
          button.setAttribute?.('aria-expanded', 'false');
      }
    };
    document.addEventListener('click', closeOutside);
    const closeMenusOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      this.closeExplorerOverlays(instance);
      instance.element.querySelector('.explorer-address-input').hidden = true;
      instance.element.querySelector('.explorer-address-go').hidden = true;
      instance.element.querySelector('.explorer-address strong').hidden = false;
    };
    document.addEventListener('keydown', closeMenusOnEscape);
    const deleteShortcut = (event) => {
      const active = this.manager.isActive
        ? this.manager.isActive(instance.element)
        : this.manager.activeWindow?.() === instance.element;
      if (
        event.key !== 'Delete' ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !active ||
        isTextEntry(event.target) ||
        isTextEntry(document.activeElement) ||
        !instance.explorerConfirmation.hidden ||
        !instance.explorerProperties.hidden
      ) return;
      const item = instance.selectedItem;
      if (!item?.fileId || !this.virtualFilesystem?.canDelete(item.fileId)) return;
      event.preventDefault();
      this.askDelete(instance, item);
    };
    document.addEventListener('keydown', deleteShortcut);
    let fileDrag = null;
    let suppressDragClick = null;
    const onFileDragStart = (event) => {
      if (event.button !== 0 || fileDrag) return;
      const row = event.target.closest?.('.explorer-item');
      const item = row && instance.current?.items.find((entry) => entry.fileId === row.dataset.fileId);
      if (!item?.fileId || item.location || !this.virtualFilesystem?.exists(item.fileId)) return;
      const selected = [...(content.querySelectorAll?.('.explorer-item[aria-selected="true"]') ?? [])];
      if (selected.length > 1) return;
      fileDrag = {
        pointerId: event.pointerId,
        row,
        fileId: item.fileId,
        startX: event.clientX,
        startY: event.clientY,
        started: false,
      };
    };
    const onFileDragMove = (event) => {
      const drag = fileDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const startsNow = !drag.started;
      if (startsNow && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
      drag.started = true;
      event.preventDefault();
      if (startsNow)
        try { drag.row.setPointerCapture?.(drag.pointerId); } catch { /* Pointer may already be released. */ }
      this.onDesktopShortcutDrag?.('preview', drag.fileId, event.clientX, event.clientY);
    };
    const finishFileDrag = (event, canceled = false) => {
      const drag = fileDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      fileDrag = null;
      this.onDesktopShortcutDrag?.(
        canceled || !drag.started ? 'cancel' : 'drop',
        drag.fileId,
        event.clientX,
        event.clientY,
      );
      if (drag.started && !canceled) suppressDragClick = drag.row;
    };
    const onFileDragEnd = (event) => finishFileDrag(event);
    const onFileDragCancel = (event) => finishFileDrag(event, true);
    const onExplorerClick = (event) => {
      if (!suppressDragClick || event.target.closest?.('.explorer-item') !== suppressDragClick) return;
      suppressDragClick = null;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    content.addEventListener('pointerdown', onFileDragStart);
    content.addEventListener('click', onExplorerClick, true);
    document.addEventListener('pointermove', onFileDragMove);
    document.addEventListener('pointerup', onFileDragEnd);
    document.addEventListener('pointercancel', onFileDragCancel);
    instance.disposeExplorer = () => {
      if (fileDrag) this.onDesktopShortcutDrag?.('cancel', fileDrag.fileId);
      fileDrag = null;
      content.removeEventListener('pointerdown', onFileDragStart);
      content.removeEventListener('click', onExplorerClick, true);
      document.removeEventListener('pointermove', onFileDragMove);
      document.removeEventListener('pointerup', onFileDragEnd);
      document.removeEventListener('pointercancel', onFileDragCancel);
      document.removeEventListener('click', closeOutside);
      document.removeEventListener('keydown', deleteShortcut);
      document.removeEventListener('keydown', closeMenusOnEscape);
    };
    menu.addEventListener('click', (event) => {
      event.stopPropagation();
      const action = event.target.closest?.('[data-explorer-action]')?.dataset.explorerAction;
      if (action === 'open' && instance.selectedItem) {
        const item = instance.selectedItem;
        menu.hidden = true;
        if (item.location) this.render(instance, explorerItem(instance.current, item));
        else this.openFile(instance.current, item);
      } else if (action === 'extract' && instance.selectedItem) {
        const item = instance.selectedItem;
        menu.hidden = true;
        this.extractWithWinRoar(item);
      } else if (action === 'delete' && instance.selectedItem) {
        this.askDelete(instance, instance.selectedItem);
      } else if (action === 'properties' && instance.selectedItem) {
        this.showProperties(instance, instance.selectedItem);
      }
    });
    confirmation.querySelector('[data-delete-answer="no"]').addEventListener('click', () => {
      confirmation.hidden = true;
    });
    confirmation.querySelector('[data-delete-answer="yes"]').addEventListener('click', () => {
      const fileId = instance.pendingDelete;
      const result = this.virtualFilesystem.deleteFile(fileId);
      confirmation.hidden = true;
      instance.pendingDelete = null;
      if (!result.ok) {
        instance.element.querySelector('.explorer-status').textContent =
          result.reason === 'protected'
            ? 'Impossible de supprimer ce fichier. Accès refusé.'
            : 'Windows XD : impossible d’enregistrer la suppression.';
        return;
      }
      for (const removedId of result.removedFileIds ?? [fileId]) this.closeOpenFile(removedId);
      this.refreshExplorers();
      this.onFilesystemChange(result);
    });
    closeProperties.addEventListener('click', () => {
      properties.hidden = true;
    });
  }
  teardownExplorer(instance) {
    instance.disposeExplorer?.();
    this.closeExplorerOverlays(instance);
  }
  closeExplorerOverlays(instance) {
    if (instance.explorerMenu) instance.explorerMenu.hidden = true;
    if (instance.explorerConfirmation) instance.explorerConfirmation.hidden = true;
    if (instance.explorerProperties) instance.explorerProperties.hidden = true;
    if (instance.commandMenu) instance.commandMenu.hidden = true;
    if (instance.folderOptionsDialog) instance.folderOptionsDialog.hidden = true;
    if (instance.helpDialog) instance.helpDialog.hidden = true;
    for (const button of instance.element.querySelectorAll?.('[data-explorer-menu]') ?? [])
      button.setAttribute?.('aria-expanded', 'false');
  }
  showExplorerContext(instance, item, event) {
    const menu = instance.explorerMenu;
    if (!menu) return;
    const deleteButton = menu.querySelector('[data-explorer-action="delete"]');
    const canDelete = Boolean(item.fileId && this.virtualFilesystem.canDelete(item.fileId));
    deleteButton.disabled = !canDelete;
    menu.querySelector('[data-explorer-action="extract"]').hidden =
      !['bomb-arena', 'smiley-pack-2009'].includes(item.extractable) ||
      !this.virtualFilesystem.exists(item.fileId);
    deleteButton.title = canDelete ? '' : 'Impossible de supprimer ce fichier. Accès refusé.';
    const body = instance.element.querySelector('.window-body').getBoundingClientRect();
    menu.hidden = false;
    menu.style.left = `${Math.max(0, Math.min(event.clientX - body.left, body.width - menu.offsetWidth))}px`;
    menu.style.top = `${Math.max(0, Math.min(event.clientY - body.top, body.height - menu.offsetHeight))}px`;
  }
  askDelete(instance, item) {
    const confirmation = instance.explorerConfirmation;
    if (!item.fileId || !this.virtualFilesystem.canDelete(item.fileId)) return;
    instance.pendingDelete = item.fileId;
    confirmation.querySelector('p').textContent = `Voulez-vous vraiment supprimer « ${item.name} » ?`;
    instance.explorerMenu.hidden = true;
    confirmation.hidden = false;
    confirmation.querySelector('[data-delete-answer="no"]').focus();
  }
  showProperties(instance, item) {
    const properties = instance.explorerProperties;
    const metadata = item.fileId ? this.virtualFilesystem.metadata(item.fileId) : null;
    const sourceLocation = item._sourceLocationId
      ? this.virtualFilesystem.getLocation(item._sourceLocationId)
      : instance.current;
    const values = metadata ?? {
      name: item.name,
      type: item.location ? 'Dossier' : item.detail ?? 'Type de fichier inconnu',
      location: item.location
        ? this.virtualFilesystem.getLocation(item.location).address
        : sourceLocation.address,
      size: null,
      path: `${(item.location ? this.virtualFilesystem.getLocation(item.location).address : sourceLocation.address).replace(/\\$/, '')}\\${item.name}`,
    };
    properties.querySelector('strong').textContent = values.name;
    const rows = [
      ['Nom', values.name],
      ['Type', values.type],
      ['Emplacement', values.location],
      ['Taille', values.size === null ? '—' : this.formatSize(values.size)],
      ['Chemin', values.path ?? values.location],
    ];
    const list = properties.querySelector('dl');
    list.replaceChildren();
    for (const [label, value] of rows) {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      list.append(term, detail);
    }
    instance.explorerMenu.hidden = true;
    properties.hidden = false;
    properties.querySelector('button').focus();
  }
  formatSize(bytes) {
    if (bytes < 1024) return `${bytes} octets`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Ko`;
    return `${(bytes / (1024 * 1024)).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;
  }
  closeOpenFile(fileId) {
    for (const instance of this.instances.values()) {
      if (instance.fileId !== fileId) continue;
      if (instance.onVirtualDelete) instance.onVirtualDelete();
      else this.manager.close(instance.id);
    }
  }
  openBombArena(_item, fileId) {
    if (this.virtualFilesystem && !this.virtualFilesystem.exists(fileId)) return null;
    const key = 'virtual-app:bomb-arena';
    const existing = this.instances.get(key);
    if (existing?.element.isConnected) {
      this.restore(existing);
      return existing;
    }
    const id = this.manager.spawn('desktopapp', {
      preview: true,
      resizable: true,
      maximizable: true,
      windowClass: 'bomb-arena-window',
      minWidth: 760,
      minHeight: 560,
      x: 0.3,
      y: 0.2,
      content: {
        title: 'BombArena.exe',
        iconName: 'arcade-game',
        body: '<section class="bomb-arena-loading">Initialisation de BombArena...</section>',
      },
      onDismiss: (dismissal = {}) => {
        instance?.disposeGame?.();
        this.instances.delete(key);
        instance.task.remove();
        this.onWindowState();
        const progress = this.virtualFilesystem?.progression?.data?.bombArena;
        if (instance && !instance.returningToMessenger && progress?.status === 'RESULTS_READY') {
          if (dismissal.reason === 'close') {
            this.onBombArenaEvent?.({ type: 'results-closed' });
            instance.onBombArenaFinish?.();
          }
        } else if (instance && !instance.returningToMessenger) {
          this.onBombArenaEvent?.({ type: 'interrupted' });
          this.onBombArenaInterrupted?.(instance);
        }
      },
    });
    const instance = this.attachWindow(key, id, 'BombArena.exe', 'arcade-game');
    instance.fileId = fileId;
    instance.onBombArenaEvent = (event) => this.onBombArenaEvent?.(event);
    instance.onBombArenaFinish = () => {
      if (instance.returningToMessenger) return false;
      const progress = this.virtualFilesystem?.progression?.data?.bombArena;
      const needsHandoff = progress?.expectedAt !== null && progress?.expectedAt !== undefined;
      if (needsHandoff && progress.status !== 'RESULTS_READY' && progress.status !== 'COMPLETED') return false;
      if (needsHandoff && progress.status === 'RESULTS_READY' && !Number.isFinite(progress.resultsClosedAt)) return false;

      // Keep RESULTS_READY persisted until the existing group conversation is
      // actually available. resultsClosedAt records the player's explicit
      // dismissal and is the recovery intent if Messenger cannot open yet.
      instance.returningToMessenger = true;
      const activateGroup = () => {
        const result = this.onBombArenaContinue?.(instance);
        return needsHandoff ? result === true : result !== false;
      };
      const activated = needsHandoff
        ? completeBombArenaHandoff({
            progression: this.virtualFilesystem?.progression,
            onBombArenaEvent: (event) => this.onBombArenaEvent?.(event),
            activateGroup,
          })
        : activateGroup();
      if (!activated) {
        instance.returningToMessenger = false;
        return false;
      }
      return true;
    };
    instance.onBombArenaContinue = () => instance.onBombArenaFinish();
    const savedMatch = this.virtualFilesystem?.progression?.data?.bombArena;
    instance.bombArenaProgress = savedMatch;
    if (savedMatch?.status === 'RESULTS_READY')
      instance.savedMatchResult = {
        winnerId: savedMatch.sessionWinner,
        scores: savedMatch.sessionScores,
        roundsPlayed: savedMatch.sessionRoundsPlayed,
      };
    else if (savedMatch?.expectedAt === null && savedMatch?.firstGameCompletedAt !== null && savedMatch?.firstGameCompletedAt !== undefined)
      instance.savedMatchResult = {
        winnerId: savedMatch.firstGameWinner,
        scores: savedMatch.firstGameScores,
        roundsPlayed: savedMatch.firstGameRoundsPlayed,
      };
    instance.onBombArenaEvent({ type: 'launched' });
    mountBombArena(instance, this.manager);
    this.restore(instance);
    return instance;
  }
  extractWithWinRoar(item) {
    if (
      !['bomb-arena', 'smiley-pack-2009'].includes(item?.extractable) || !item.fileId ||
      !this.virtualFilesystem?.exists(item.fileId)
    ) return null;
    const key = item.extractable === 'bomb-arena'
      ? 'winroar:bomb-arena'
      : `winroar:${item.fileId}`;
    const existing = this.instances.get(key);
    if (existing?.element.isConnected) {
      this.restore(existing);
      return existing;
    }
    const id = this.manager.spawn('desktopapp', {
      preview: true,
      x: 0.34,
      y: 0.25,
      content: {
        title: 'WinRoar',
        iconName: 'archive',
        body: '<section class="winroar-extraction"><strong>Extraction de BombArena.zip</strong><progress max="1" value="0" aria-label="Progression de l’extraction"></progress><p role="status">Extraction en cours...</p></section>',
      },
      onDismiss: () => {
        clearInterval(instance.extractionTimer);
        this.instances.delete(key);
        instance.task.remove();
        this.onWindowState();
      },
    });
    const instance = this.attachWindow(key, id, 'WinRoar', 'archive');
    if (item.extractable !== 'bomb-arena')
      instance.element.querySelector('.winroar-extraction strong').textContent =
        `Extraction de ${item.name}`;
    const progress = instance.element.querySelector('.winroar-extraction progress');
    const status = instance.element.querySelector('.winroar-extraction [role="status"]');
    let elapsed = 0;
    instance.extractionTimer = setInterval(() => {
      if (!instance.element.isConnected) {
        clearInterval(instance.extractionTimer);
        return;
      }
      elapsed += 50;
      progress.value = Math.min(1, elapsed / 3000);
      if (elapsed < 3000) return;
      clearInterval(instance.extractionTimer);
      instance.extractionTimer = null;
      const result = item.extractable === 'bomb-arena'
        ? this.virtualFilesystem.extractBombArena(item.fileId)
        : this.virtualFilesystem.extractArchive(item.fileId);
      status.textContent = item.extractable === 'bomb-arena'
        ? result.ok
          ? result.existing ? 'BombArena.exe existe déjà.' : 'Extraction terminée.'
          : 'Impossible de terminer l’extraction.'
        : result.ok
          ? result.existing ? 'Les fichiers extraits existent déjà.' : 'Extraction terminée.'
          : 'Impossible de terminer l’extraction.';
      if (result.ok) {
        this.refreshExplorers();
        this.onFilesystemChange({ origin: 'system', extracted: result.fileId });
      }
    }, 50);
    instance.fileId = null;
    this.restore(instance);
    return instance;
  }
  refreshExplorers() {
    for (const instance of this.instances.values())
      if (instance.current && this.virtualFilesystem) this.render(instance, instance.current, false);
  }
}
