import definitions from '../config/desktop-apps.json' with { type: 'json' };
import filesystem from '../config/filesystem.json' with { type: 'json' };
import { bindFileActivation } from '../utils/activation.js';
import { icon } from './icons.js';
import { isArcadeExecutable } from './arcade-launcher.js';
import { VirtualTextFiles } from '../story/text-files.js';
import { VirtualFilesystem, virtualFileId } from '../story/virtual-filesystem.js';
import { attachNotepad } from './notepad.js';
import { executableAssociation } from './executable-registry.js';
import { isMediaTrack } from './media-library.js';

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
  if (/\.txt$/i.test(item.name)) return 'notepad';
  if (/\.jpg$/i.test(item.name)) return 'image';
  return 'generic';
}
export function localPicture(path) {
  return typeof path === 'string' && /^\.\/(?:wallpaper\.svg|covers\/[a-z0-9-]+\.svg)$/.test(path);
}

function isTextEntry(target) {
  return Boolean(
    target &&
      (target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName ?? '')),
  );
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
  ) {
    Object.assign(this, {
      manager,
      taskbar,
      onWindowState,
      onLaunchArcade,
      onFilesystemChange,
      onOpenReceived,
      onLaunchExecutable,
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
        <div class="explorer-menu">Fichier <span>Édition</span><span>Affichage</span><span>Favoris</span><span>Outils</span><span>Aide</span></div>
        <div class="explorer-toolbar"><button class="xp-button explorer-back" disabled>◀ Précédente</button><button class="xp-button explorer-up" disabled>↑ Remonter</button><button class="xp-button explorer-home">${icon('computer')} Poste de travail</button></div>
        <div class="explorer-address">Adresse <strong></strong></div>
        <div class="explorer-content"><aside><h3>Gestion du système</h3><p>Afficher les informations</p><h3>Autres emplacements</h3><button data-location="computer">Poste de travail</button><button data-location="folder">Mes documents</button><button data-location="bin">Corbeille</button><h3>Détails</h3><p class="explorer-description"></p></aside><section class="explorer-items" aria-label="Contenu du dossier"></section></div>
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
    element.querySelector('.explorer-home').addEventListener('click', () => this.home(instance));
    element.querySelector('.explorer-up').addEventListener('click', () => this.up(instance));
    element.querySelector('.explorer-back').addEventListener('click', () => this.back(instance));
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
    const instance = { id, kind, element, task, history: [] };
    this.instances.set(kind, instance);
    const minimize = document.createElement('button');
    minimize.className = 'msn-minimize';
    minimize.textContent = '−';
    minimize.setAttribute('aria-label', `Réduire ${title}`);
    minimize.addEventListener('click', () => {
      element.hidden = true;
      task.setAttribute('aria-pressed', 'false');
      instance.onMinimize?.();
      this.onWindowState();
    });
    element
      .querySelector('.titlebar')
      .insertBefore(
        minimize,
        element.querySelector('.maximize-button') ?? element.querySelector('.close-button'),
      );
    task.addEventListener('click', () => this.restore(instance));
    return instance;
  }
  openFile(location, item) {
    const fileId = item.fileId ?? virtualFileId(location.id, item.name);
    if (this.virtualFilesystem && !this.virtualFilesystem.exists(fileId)) return;
    if (isMediaTrack(item) && this.onLaunchExecutable)
      return this.onLaunchExecutable('windows-media-play', item, fileId);
    const executable = executableAssociation(item, fileId);
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
  restore(instance) {
    instance.element.hidden = false;
    instance.element.style.zIndex = ++this.manager.z;
    instance.task.setAttribute('aria-pressed', 'true');
    instance.onRestore?.();
    this.onWindowState();
  }
  home(instance) {
    this.render(instance, explorerLocation('computer'));
  }
  up(instance) {
    if (instance.current.parent) this.render(instance, explorerLocation(instance.current.parent));
  }
  back(instance) {
    const previous = instance.history.pop();
    if (previous) this.render(instance, previous, false);
  }
  render(instance, definition, remember = true) {
    this.closeExplorerOverlays(instance);
    instance.selectedItem = null;
    instance.selectedButton = null;
    if (remember && instance.current && instance.current.id !== definition.id)
      instance.history.push(instance.current);
    if (this.virtualFilesystem) definition = this.virtualFilesystem.getLocation(definition.id);
    instance.current = definition;
    const { element } = instance;
    element.querySelector('.explorer-address strong').textContent = definition.address;
    element.querySelector('.explorer-description').textContent = definition.description;
    element.querySelector('.explorer-back').disabled = !instance.history.length;
    element.querySelector('.explorer-up').disabled = !definition.parent;
    const content = element.querySelector('.explorer-items');
    content.replaceChildren();
    for (const item of definition.items) {
      const button = document.createElement('button');
      button.className = 'explorer-item';
      button.innerHTML = icon(item.icon);
      const label = document.createElement('strong');
      label.textContent = item.name;
      const detail = document.createElement('small');
      detail.textContent = item.detail;
      button.append(label, detail);
      if (item.fileId) button.dataset.fileId = item.fileId;
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
      });
      const activate = () =>
        item.location
          ? this.render(instance, explorerItem(definition, item))
          : this.openFile(definition, item);
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
          this.showExplorerContext(instance, item, event);
        });
      }
      content.append(button);
    }
    if (!definition.items.length) {
      if (localPicture(definition.image)) {
        const image = document.createElement('img');
        image.className = 'explorer-image';
        image.src = definition.image;
        image.alt = definition.description;
        content.append(image);
      }
      const empty = document.createElement('p');
      empty.className = 'explorer-empty';
      empty.textContent =
        definition.text ??
        definition.emptyText ??
        (definition.image ? 'Aperçu de l’image' : undefined) ??
        (instance.kind === 'bin'
          ? 'La corbeille est vide.'
          : 'Ce dossier ne contient aucun fichier.');
      content.append(empty);
    }
    element.querySelector('.explorer-status').textContent =
      `${definition.items.length} objet(s) · Windows XD`;
  }
  setupExplorer(instance) {
    const body = instance.element.querySelector('.window-body');
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
    };
    document.addEventListener('click', closeOutside);
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
    instance.disposeExplorer = () => {
      document.removeEventListener('click', closeOutside);
      document.removeEventListener('keydown', deleteShortcut);
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
    const values = metadata ?? {
      name: item.name,
      type: item.location ? 'Dossier' : item.detail ?? 'Type de fichier inconnu',
      location: item.location
        ? this.virtualFilesystem.getLocation(item.location).address
        : instance.current.address,
      size: null,
    };
    properties.querySelector('strong').textContent = values.name;
    const rows = [
      ['Type', values.type],
      ['Emplacement', values.location],
      ['Taille', values.size === null ? '—' : this.formatSize(values.size)],
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
      minWidth: 320,
      minHeight: 240,
      x: 0.3,
      y: 0.2,
      content: {
        title: 'BombArena.exe',
        iconName: 'arcade-game',
        body: '<section class="bomb-arena-placeholder"><strong>BombArena.exe</strong><p>Chargement du salon...</p><p>[Interface multijoueur en préparation]</p></section>',
      },
      onDismiss: () => {
        this.instances.delete(key);
        instance.task.remove();
        this.onWindowState();
      },
    });
    const instance = this.attachWindow(key, id, 'BombArena.exe', 'arcade-game');
    instance.fileId = fileId;
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
