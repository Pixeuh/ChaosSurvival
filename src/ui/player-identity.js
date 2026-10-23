import profile from '../config/player.json' with { type: 'json' };
import { normalizePlayerIdentity } from '../story/player-identity.js';

// Keep one shared UI profile object so open Messenger and browser views use the
// identity restored from the progression save as soon as it is applied.
export const playerIdentity = { ...profile };
const listeners = new Set();

function notify() {
  for (const listener of [...listeners]) listener(playerIdentity);
}

export function subscribePlayerIdentity(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function applyPlayerIdentity(value) {
  const normalized = normalizePlayerIdentity(value);
  if (!normalized) return false;
  Object.assign(playerIdentity, normalized, { avatar: profile.avatar });
  notify();
  return true;
}

export function resetPlayerIdentity() {
  Object.assign(playerIdentity, profile);
  notify();
}
