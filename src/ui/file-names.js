// Windows XD's known file types. Keep this shared by file association and
// display code so extension visibility cannot drift from the recognized types.
const FILE_TYPES = Object.freeze({
  exe: 'application',
  txt: 'text',
  mp3: 'audio',
  wav: 'audio',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  bmp: 'image',
  zip: 'archive',
  lnk: 'shortcut',
});
let hideKnownExtensions = true;

export function setHideKnownExtensions(value) {
  hideKnownExtensions = value !== false;
  return hideKnownExtensions;
}

export function getHideKnownExtensions() {
  return hideKnownExtensions;
}

export function fileTypeForName(name) {
  if (typeof name !== 'string') return null;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return null;
  return FILE_TYPES[name.slice(dot + 1).toLowerCase()] ?? null;
}

export function getDisplayFileName(file, { hideKnown = hideKnownExtensions } = {}) {
  const name = typeof file === 'string' ? file : file?.name;
  if (typeof name !== 'string') return '';
  if (typeof file === 'object' && file !== null &&
    (file.location || file.kind === 'folder' ||
      (typeof file.detail === 'string' && file.detail.toLowerCase() === 'dossier'))) return name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || fileTypeForName(name) === null) return name;
  if (!hideKnown && fileTypeForName(name) !== 'shortcut') return name;
  return name.slice(0, dot);
}
