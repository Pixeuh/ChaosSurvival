const owners = new Set();
const listeners = new Set();

export function subscribeMusicFocus(listener) {
  listeners.add(listener);
  listener(owners.size > 0);
  return () => listeners.delete(listener);
}

export function claimMusicFocus(owner) {
  if (owners.has(owner)) return () => releaseMusicFocus(owner);
  const wasActive = owners.size > 0;
  owners.add(owner);
  if (!wasActive) for (const listener of listeners) listener(true);
  return () => releaseMusicFocus(owner);
}

export function releaseMusicFocus(owner) {
  if (!owners.delete(owner) || owners.size > 0) return;
  for (const listener of listeners) listener(false);
}
