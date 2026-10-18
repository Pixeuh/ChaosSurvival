const staticApplications = Object.freeze({
  'messenger-files/love-messenger.exe': 'windows-love-messenger',
  'browser-files/adventurer.exe': 'internet-adventurer',
  'media-files/media-play.exe': 'windows-media-play',
  'downloads/toolbar_setup.exe': 'toolbar-installer',
});

// Resolve only virtual file IDs and stable application metadata. File names are
// used only to recognize an unsupported .exe and show a safe Windows XD error.
export function executableAssociation(file, fileId) {
  if (!/\.exe$/i.test(file?.name ?? '')) return null;
  if (file.virtualApp === 'smiley-pack-installer') return 'smiley-pack-installer';
  if (file.virtualApp === 'bomb-arena') return 'bomb-arena';
  if (typeof file.launch?.game === 'string') return 'mini-game';
  return staticApplications[String(fileId ?? file.fileId ?? '').toLowerCase()] ?? 'unknown';
}
