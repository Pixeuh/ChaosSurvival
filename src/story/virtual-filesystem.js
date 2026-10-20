import fileDefinitions from '../config/filesystem.json' with { type: 'json' };
import appDefinitions from '../config/desktop-apps.json' with { type: 'json' };

const locations = Object.freeze({ ...fileDefinitions, ...appDefinitions });
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const keyPattern = /^([a-z0-9-]+)\/([^/\\]+)$/i;
const safeName = (name) =>
  typeof name === 'string' &&
  name.length > 0 &&
  name.length <= 160 &&
  name !== '.' &&
  name !== '..' &&
  !/[\\/\u0000-\u001f]/.test(name);
const protectedImageNames = new Set(['fond-bureau.jpg', 'fond_bureau.jpg', 'fond-ecran.jpg']);
const isDeletableFile = (file) => {
  const name = String(file?.name ?? '').toLowerCase();
  if (protectedImageNames.has(name)) return false;
  return file?.directory === true
    ? file.deletable === true
    : file?.deletable === true || /\.(txt|jpg)$/.test(name) ||
    name === 'pixelsans.ttf' || name === 'smiley_pack_2009.zip';
};

export function virtualFileId(locationId, name) {
  return `${String(locationId).toLowerCase()}/${String(name).toLowerCase()}`;
}

function staticFiles() {
  const files = new Map();
  for (const [locationId, location] of Object.entries(locations))
    for (const item of location.items ?? [])
      if (!item.location && safeName(item.name))
        files.set(virtualFileId(locationId, item.name), { ...item, locationId });
  return files;
}

function staticDirectories() {
  const directories = new Map();
  for (const [locationId, location] of Object.entries(locations))
    for (const item of location.items ?? [])
      if (item.location && safeName(item.name))
        directories.set(virtualFileId(locationId, item.name), {
          ...item,
          detail: item.detail ?? 'Dossier',
          icon: item.icon ?? 'folder',
          directory: true,
          locationId,
          deletable: false,
        });
  return directories;
}

function receivedDeletionId(fileId, transferKey) {
  return `received:${fileId}:${encodeURIComponent(transferKey)}`;
}

function receivedFiles(files = {}, deleted = []) {
  const received = new Map();
  for (const file of Object.values(files)) {
    if (
      file?.status !== 'complete' || file.direction !== 'receive' || !safeName(file.name)
    ) continue;
    const fileId = virtualFileId('downloads', file.name);
    if (deleted.includes(fileId) || deleted.includes(receivedDeletionId(fileId, file.key))) continue;
    received.set(fileId, {
      ...file,
      fileId,
      locationId: 'downloads',
      icon: 'document',
      detail: file.description ?? 'Fichier reçu',
      text: file.description ?? '',
      deletable: true,
      receivedFile: true,
      transferKey: file.key,
    });
  }
  return received;
}

function normalizeAdded(added) {
  if (!added || typeof added !== 'object' || Array.isArray(added)) return {};
  const valid = {};
    const staticIds = new Set([...staticFiles().keys(), ...staticDirectories().keys()]);
  for (const [key, file] of Object.entries(added)) {
    const match = keyPattern.exec(key);
    if (
      !match ||
      unsafeKeys.has(match[1]) || match[1] === 'bin' ||
      !Object.hasOwn(locations, match[1]) ||
      !Array.isArray(locations[match[1]].items) || !safeName(match[2]) ||
      virtualFileId(match[1], match[2]) !== key.toLowerCase() || staticIds.has(key.toLowerCase()) ||
      !file || typeof file !== 'object' || Array.isArray(file) ||
      typeof file.name !== 'string' || file.name.toLowerCase() !== match[2].toLowerCase() ||
      typeof file.detail !== 'string' || typeof file.icon !== 'string'
    ) continue;
    if (file.directory === true &&
      (typeof file.location !== 'string' || !Object.hasOwn(locations, file.location) ||
        locations[file.location].parent !== match[1] || !Array.isArray(locations[file.location].items)))
      continue;
    const normalized = {
      name: file.name,
      detail: file.detail.slice(0, 200),
      icon: /^[a-z0-9-]{1,40}$/i.test(file.icon) ? file.icon : 'document',
      deletable: file.deletable === true,
    };
    if (file.directory === true) {
      normalized.directory = true;
      normalized.location = file.location;
    }
    if (['bomb-arena', 'smiley-pack-2009'].includes(file.extractable))
      normalized.extractable = file.extractable;
    if (['bomb-arena', 'smiley-pack-installer'].includes(file.virtualApp))
      normalized.virtualApp = file.virtualApp;
    if (Number.isFinite(file.size) && file.size >= 0 && file.size <= 2 ** 31)
      normalized.size = Math.floor(file.size);
    if (typeof file.text === 'string' && file.text.length <= 102400) normalized.text = file.text;
    if (typeof file.image === 'string' && /^\.\/(?:wallpaper\.svg|covers\/[a-z0-9-]+\.svg)$/i.test(file.image))
      normalized.image = file.image;
    valid[key.toLowerCase()] = normalized;
  }
  return valid;
}

export function normalizeVirtualFilesystemState(state, files = {}) {
  const added = normalizeAdded(state?.added);
  const completedReceives = Object.values(files).filter(
    (file) => file?.status === 'complete' && file.direction === 'receive' && safeName(file.name),
  );
  const receivedPaths = new Set(completedReceives.map((file) => virtualFileId('downloads', file.name)));
  const reusableReceivedPaths = new Set(completedReceives
    .filter((file) => file.reusableAfterDelete === true)
    .map((file) => virtualFileId('downloads', file.name)));
  const receivedTokens = new Set(completedReceives.map((file) =>
    receivedDeletionId(virtualFileId('downloads', file.name), file.key),
  ));
  const knownDeletable = new Set([
    ...[...staticFiles()].filter(([, file]) => isDeletableFile(file)).map(([key]) => key),
    ...Object.entries(added).filter(([, file]) => isDeletableFile(file)).map(([key]) => key),
    ...receivedPaths,
    ...receivedTokens,
  ]);
  const deleted = [];
  for (const value of Array.isArray(state?.deleted) ? state.deleted : []) {
    if (typeof value !== 'string') continue;
    const key = value.toLowerCase();
    if (reusableReceivedPaths.has(key) && !staticFiles().has(key)) {
      for (const file of completedReceives)
        if (virtualFileId('downloads', file.name) === key)
          deleted.push(receivedDeletionId(key, file.key));
    } else if (knownDeletable.has(key)) deleted.push(key);
  }
  return { deleted: [...new Set(deleted.filter((key) => knownDeletable.has(key)))], added };
}

export class VirtualFilesystem {
  constructor(progression) {
    this.progression = progression;
    progression.data.virtualFilesystem = normalizeVirtualFilesystemState(
      progression.data.virtualFilesystem,
      progression.data.files,
    );
  }
  get state() {
    return this.progression.data.virtualFilesystem;
  }
  getLocation(id) {
    const base = locations[id];
    if (!base || unsafeKeys.has(id)) throw new Error('Emplacement fictif inconnu.');
    const deleted = new Set(this.state.deleted);
    const items = (base.items ?? [])
      .map((item) => {
        if (item.location) return {
          ...item,
          fileId: virtualFileId(id, item.name),
          detail: item.detail ?? 'Dossier',
          directory: true,
          locationId: id,
          deletable: false,
        };
        return { ...item, fileId: virtualFileId(id, item.name) };
      })
      .filter((item) => item.location || !deleted.has(item.fileId));
    const present = new Set(items.filter((item) => item.fileId).map((item) => item.fileId));
    for (const [fileId, file] of Object.entries(this.state.added))
      if (fileId.startsWith(`${id.toLowerCase()}/`) && !deleted.has(fileId) && !present.has(fileId)) {
        items.push({ ...file, fileId });
        present.add(fileId);
      }
    if (id === 'downloads')
      for (const [fileId, file] of receivedFiles(this.progression.data.files, this.state.deleted))
        if (!deleted.has(fileId) && !present.has(fileId)) items.push(file);
    return { ...base, id, items };
  }
  getFile(fileId) {
    if (typeof fileId !== 'string') return null;
    const key = fileId.toLowerCase();
    if (this.state.deleted.includes(key)) return null;
    const added = this.state.added[key];
    const file = added ?? staticFiles().get(key) ?? staticDirectories().get(key) ??
      receivedFiles(this.progression.data.files, this.state.deleted).get(key);
    return file ? { ...file, fileId: key, deletable: isDeletableFile(file) } : null;
  }
  exists(fileId) {
    return Boolean(this.getFile(fileId));
  }
  canDelete(fileId) {
    return isDeletableFile(this.getFile(fileId));
  }
  metadata(fileId) {
    const file = this.getFile(fileId);
    if (!file) return null;
    const location = locations[file.locationId ?? fileId.slice(0, fileId.indexOf('/'))];
    return {
      name: file.name,
      type: file.detail,
      location: location?.address ?? '',
      size: file.directory || !Number.isFinite(file.size) ? null : Math.floor(file.size),
      path: `${location?.address?.replace(/\\$/, '') ?? ''}\\${file.name}`,
    };
  }
  addFile(locationId, file) {
    const key = virtualFileId(locationId, file?.name);
    const match = keyPattern.exec(key);
    const location = locations[locationId];
    if (
      !match || !location || locationId === 'bin' ||
      !Array.isArray(location.items) || unsafeKeys.has(locationId) ||
      !safeName(file?.name) || staticFiles().has(key) || staticDirectories().has(key) || this.state.added[key] ||
      typeof file.detail !== 'string' || !file.detail.trim()
    ) return { ok: false, reason: 'invalid' };
    const normalized = normalizeAdded({ [key]: {
      ...file,
      icon: file.icon ?? 'document',
    } })[key];
    if (!normalized) return { ok: false, reason: 'invalid' };
    const previous = this.state;
    this.progression.data.virtualFilesystem = {
      deleted: previous.deleted.filter((id) => id !== key),
      added: { ...previous.added, [key]: normalized },
    };
    if (!this.progression.save()) {
      this.progression.data.virtualFilesystem = previous;
      return { ok: false, reason: 'save' };
    }
    return { ok: true, fileId: key };
  }
  addDirectory(parentId, name, locationId) {
    const key = virtualFileId(parentId, name);
    const existing = this.getFile(key);
    if (existing?.directory === true && existing.location === locationId)
      return { ok: true, existing: true, fileId: key };
    const location = locations[locationId];
    if (
      !location || location.parent !== parentId || !Array.isArray(location.items) ||
      !safeName(name) || existing || this.state.added[key]
    ) return { ok: false, reason: 'invalid' };
    const normalized = normalizeAdded({ [key]: {
      name,
      icon: 'folder',
      detail: 'Dossier',
      deletable: true,
      directory: true,
      location: locationId,
    } })[key];
    if (!normalized) return { ok: false, reason: 'invalid' };
    const previous = this.state;
    this.progression.data.virtualFilesystem = {
      deleted: previous.deleted.filter((id) => id !== key),
      added: { ...previous.added, [key]: normalized },
    };
    if (!this.progression.save()) {
      this.progression.data.virtualFilesystem = previous;
      return { ok: false, reason: 'save' };
    }
    return { ok: true, fileId: key };
  }
  extractArchive(archiveFileId) {
    const archive = this.getFile(archiveFileId);
    const definitions = {
      'bomb-arena': {
        folderName: 'BombArena',
        locationId: 'bomb-arena-folder',
        file: {
          name: 'BombArena.exe',
          icon: 'arcade-game',
          detail: 'Application',
          size: 31 * 1024 * 1024,
          deletable: true,
          virtualApp: 'bomb-arena',
        },
      },
      'smiley-pack-2009': {
        folderName: 'smiley_pack_2009',
        locationId: 'smiley-pack-2009-folder',
        file: {
          name: 'Smiley Pack 2009.exe',
          icon: 'document',
          detail: 'Installateur',
          size: 524288,
          deletable: true,
          virtualApp: 'smiley-pack-installer',
        },
      },
    };
    const definition = definitions[archive?.extractable];
    if (!definition) return { ok: false, reason: 'invalid-archive' };
    const executableId = virtualFileId(definition.locationId, definition.file.name);
    if (this.exists(executableId)) {
      if (archive.extractable === 'bomb-arena') this.progression.recordBombArenaEvent?.({ type: 'extracted' });
      return { ok: true, existing: true, fileId: executableId };
    }
    const folderId = virtualFileId('downloads', definition.folderName);
    const existingFolder = this.getFile(folderId);
    const folder = existingFolder?.directory === true && existingFolder.location === definition.locationId
      ? { ok: true, fileId: folderId }
      : this.addDirectory('downloads', definition.folderName, definition.locationId);
    if (!folder.ok) return folder;
    const executable = this.addFile(definition.locationId, definition.file);
    if (!executable.ok && !this.exists(executableId)) return executable;
    if (archive.extractable === 'bomb-arena') this.progression.recordBombArenaEvent?.({ type: 'extracted' });
    return { ok: true, fileId: executableId, folderId: folder.fileId };
  }
  extractBombArena(archiveFileId) {
    return this.extractArchive(archiveFileId);
  }
  deleteFile(fileId, { origin = 'manual' } = {}) {
    const key = typeof fileId === 'string' ? fileId.toLowerCase() : fileId;
    const file = this.getFile(key);
    if (!file) return { ok: false, reason: 'missing' };
    if (!['manual', 'system'].includes(origin)) return { ok: false, reason: 'invalid-origin' };
    if (!this.canDelete(key)) return { ok: false, reason: 'protected' };
    const previousState = this.state;
    const previousTextFiles = this.progression.data.textFiles;
    const added = { ...previousState.added };
    const removedFileIds = [key];
    if (file.directory === true) {
      const childPrefix = `${file.location.toLowerCase()}/`;
      for (const childId of Object.keys(added))
        if (childId.startsWith(childPrefix)) {
          removedFileIds.push(childId);
          delete added[childId];
        }
    }
    for (const removedId of removedFileIds) delete added[removedId];
    const deletedIds = removedFileIds.map((removedId) =>
      removedId === key && file.receivedFile && file.reusableAfterDelete === true
        ? receivedDeletionId(removedId, file.transferKey)
        : removedId,
    );
    this.progression.data.virtualFilesystem = {
      deleted: [...new Set([...previousState.deleted, ...deletedIds])],
      added,
    };
    if (previousTextFiles && typeof previousTextFiles === 'object') {
      const textFiles = { ...previousTextFiles };
      for (const key of Object.keys(textFiles))
        if (removedFileIds.includes(key.replaceAll('\\', '/').toLowerCase())) delete textFiles[key];
      this.progression.data.textFiles = textFiles;
    }
    if (!this.progression.save()) {
      this.progression.data.virtualFilesystem = previousState;
      this.progression.data.textFiles = previousTextFiles;
      return { ok: false, reason: 'save' };
    }
    const result = { ok: true, fileId: key, removedFileIds, origin };
    this.onDelete?.(result);
    return result;
  }
}
