import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicToggle } from '../src/ui/music-toggle.js';

test('music button toggles its own track without opening a settings panel', () => {
  const previousDocument = globalThis.document;
  const listeners = {};
  const button = {
    attributes: {},
    addEventListener: (name, callback) => { listeners[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
  const hud = { append: (item) => { hud.button = item; } };
  const desktop = { querySelector: (selector) => selector === '.hud' ? hud : null };
  const audio = {
    muted: false,
    setMuted(value) { this.muted = Boolean(value); },
  };

  globalThis.document = { createElement: (tag) => { assert.equal(tag, 'button'); return button; } };
  try {
    const toggle = createMusicToggle(desktop, audio);
    assert.equal(typeof toggle.render, 'function');
    assert.equal(hud.button, button);
    assert.equal(button.textContent, 'Musique : ON');
    assert.equal(button.attributes['aria-pressed'], 'true');
    listeners.click();
    assert.equal(audio.muted, true);
    assert.equal(button.textContent, 'Musique : OFF');
    assert.equal(button.attributes['aria-pressed'], 'false');
    listeners.click();
    assert.equal(audio.muted, false);
    assert.equal(button.textContent, 'Musique : ON');
    audio.setMuted(true);
    toggle.render();
    assert.equal(button.textContent, 'Musique : OFF');
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
