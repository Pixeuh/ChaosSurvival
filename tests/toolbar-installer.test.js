import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { DesktopApplications } from '../src/ui/desktop-apps.js';
import { createExecutableLauncher } from '../src/ui/executable-launcher.js';
import { ToolbarInstaller } from '../src/ui/toolbar-installer.js';
import { VirtualFilesystem } from '../src/story/virtual-filesystem.js';

const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url), 'utf8'));

class FakeElement {
  constructor() {
    this.isConnected = true;
    this.hidden = false;
    this.dataset = {};
    this.listeners = new Map();
    this.value = 0;
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    };
  }
  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) listener({ target: this });
  }
  remove() { this.isConnected = false; }
  setAttribute() {}
  click() { this.dispatch('click'); }
}

class FakeContent extends FakeElement {
  set innerHTML(markup) {
    this.markup = markup;
    this.buttons = new Map();
    this.options = [...markup.matchAll(/<input type="checkbox" data-option="(\d+)"( checked)?/g)]
      .map((match) => {
        const option = new FakeElement();
        option.dataset.option = match[1];
        option.checked = Boolean(match[2]);
        return option;
      });
    this.progress = new FakeElement();
    this.status = new FakeElement();
  }
  querySelector(selector) {
    if (selector === '.toolbar-installer-content progress') return this.progress;
    if (selector === '.toolbar-installer-status') return this.status;
    if (!selector.startsWith('[data-action=')) return null;
    const action = selector.match(/"([^"]+)"/)?.[1];
    if (!this.markup.includes(`data-action="${action}"`)) return null;
    if (!this.buttons.has(action)) this.buttons.set(action, new FakeElement());
    return this.buttons.get(action);
  }
  querySelectorAll(selector) { return selector === '[data-option]' ? this.options : []; }
}

function setup({ realTimers = false } = {}) {
  const calls = [];
  const manager = {
    windows: new Map(),
    spawn(type, options) {
      const id = calls.length + 1;
      calls.push({ type, ...options });
      const element = new FakeElement();
      const root = new FakeContent();
      element.querySelector = (selector) => selector === '.toolbar-installer-content' ? root : root.querySelector(selector);
      this.windows.set(id, { element, onDismiss: options.onDismiss });
      return id;
    },
    close(id) {
      const window = this.windows.get(id);
      if (!window) return;
      window.element.remove();
      this.windows.delete(id);
      window.onDismiss?.();
    },
  };
  const applications = {
    instances: new Map(),
    restores: 0,
    attachWindow(key, id, title) {
      const instance = { key, id, title, element: manager.windows.get(id).element, task: new FakeElement() };
      this.instances.set(key, instance);
      return instance;
    },
    restore(instance) { this.restores++; instance.element.hidden = false; },
    onWindowState() {},
  };
  const intervals = [];
  const cleared = [];
  let now = 0;
  const installer = realTimers
    ? new ToolbarInstaller(manager, applications)
    : new ToolbarInstaller(manager, applications, {
      setIntervalFn: (callback, delay) => (intervals.push({ callback, delay }), intervals.length),
      clearIntervalFn: (id) => cleared.push(id),
      nowFn: () => now,
    });
  return {
    calls,
    manager,
    applications,
    intervals,
    cleared,
    installer,
    advance: (duration) => { now += duration; },
  };
}

test('toolbar_setup.exe opens one fixed, non-resizable wizard and relaunch starts fresh', () => {
  const { calls, installer, applications } = setup();
  const first = installer.open();
  const firstContent = first.element.querySelector('.toolbar-installer-content');
  assert.match(firstContent.markup, /Bienvenue dans l’assistant d’installation de SUPER TOOLBAR 2009/);
  assert.equal(calls[0].windowClass, 'toolbar-installer-window');
  assert.equal(calls[0].resizable, false);
  assert.equal(calls[0].maximizable, false);
  assert.equal(installer.open(), first);
  assert.equal(calls.length, 1);
  assert.equal(applications.restores, 2);
  firstContent.querySelector('[data-action="next"]').click();
  assert.equal(first.step, 'options');
  assert.equal(firstContent.options.length, 4);
  assert.ok(firstContent.options.every((option) => option.checked));
  firstContent.options[1].checked = false;
  firstContent.options[1].dispatch('change');
  assert.deepEqual(first.options, [true, false, true, true]);
  firstContent.querySelector('[data-action="back"]').click();
  firstContent.querySelector('[data-action="next"]').click();
  assert.equal(firstContent.options[1].checked, false);
});

test('toolbar installer simulates the interrupted download and closes after the exact error', () => {
  const { calls, manager, applications, intervals, cleared, installer, advance } = setup();
  const instance = installer.open();
  const root = instance.element.querySelector('.toolbar-installer-content');
  root.querySelector('[data-action="next"]').click();
  root.options[0].checked = false;
  root.options[0].dispatch('change');
  const installButton = root.querySelector('[data-action="install"]');
  installButton.click();
  installButton.click();
  assert.equal(instance.step, 'installing');
  assert.equal(instance.element.classList.contains('is-installing'), true);
  assert.match(root.markup, /disabled>T\u00e9l\u00e9chargement\.\.\./);
  assert.equal(intervals[0].delay, 50);
  assert.equal(intervals.length, 1, 'rapid repeated clicks create only one download timer');
  assert.match(root.markup, /T\u00e9l\u00e9chargement de SUPER TOOLBAR 2009/);
  intervals[0].callback();
  assert.equal(root.progress.value, 0);
  advance(1300);
  intervals[0].callback();
  assert.equal(root.progress.value, 39);
  assert.equal(root.status.textContent, 'T\u00e9l\u00e9chargement de SUPER TOOLBAR 2009...');
  advance(1300);
  intervals[0].callback();
  assert.equal(root.progress.value, 78);
  assert.equal(instance.step, 'installing', 'the bar stops at 78 percent during the pause');
  assert.equal(instance.element.classList.contains('is-installing'), true);
  advance(999);
  intervals[0].callback();
  assert.equal(instance.step, 'installing', 'the progress cursor remains active during the pause');
  assert.equal(instance.element.classList.contains('is-installing'), true);
  advance(1);
  intervals[0].callback();
  assert.equal(instance.step, 'failure');
  assert.equal(instance.element.classList.contains('is-installing'), false);
  assert.match(root.markup, /Erreur de t\u00e9l\u00e9chargement/);
  assert.match(root.markup, /Impossible \u00e0 t\u00e9l\u00e9charger/);
  assert.match(root.markup, /data-action="ok"/);
  assert.deepEqual(cleared, [1]);
  root.querySelector('[data-action="ok"]').click();
  assert.equal(instance.element.isConnected, false);
  assert.equal(applications.instances.has('toolbar-installer'), false);

  const relaunched = installer.open();
  assert.equal(calls.length, 2);
  assert.equal(relaunched.step, 'welcome');
  assert.deepEqual(relaunched.options, [true, true, true, true]);
  manager.close(relaunched.id);
});

test('opening toolbar_setup.exe through the explorer reaches the real wizard and download click handler', () => {
  const progression = new Progression(story);
  const filesystem = new VirtualFilesystem(progression);
  const { applications, intervals, installer, advance } = setup();
  let routed = 0;
  const explorer = Object.assign(Object.create(DesktopApplications.prototype), {
    virtualFilesystem: filesystem,
    instances: applications.instances,
    onLaunchExecutable: createExecutableLauncher({
      'toolbar-installer': (_file, fileId) => {
        assert.equal(fileId, 'downloads/toolbar_setup.exe');
        routed++;
        return installer.open(fileId);
      },
    }),
  });
  const downloads = filesystem.getLocation('downloads');
  const executable = downloads.items.find((item) => item.name === 'toolbar_setup.exe');
  const instance = explorer.openFile(downloads, executable);
  assert.equal(routed, 1);
  const root = instance.element.querySelector('.toolbar-installer-content');
  root.querySelector('[data-action="next"]').click();
  root.querySelector('[data-action="install"]').click();
  assert.equal(instance.step, 'installing');
  assert.equal(intervals.length, 1);
  assert.match(root.markup, /<progress[^>]*value="0"/);
  assert.doesNotMatch(root.markup, /Impossible \u00e0 installer/);
  advance(1000);
  intervals[0].callback();
  assert.ok(root.progress.value > 0);
  advance(1600);
  intervals[0].callback();
  assert.equal(root.progress.value, 78);
  assert.equal(instance.step, 'installing');
  advance(1000);
  intervals[0].callback();
  assert.equal(instance.step, 'failure');
  assert.match(root.markup, /Impossible \u00e0 t\u00e9l\u00e9charger/);
  assert.equal(instance.element.classList.contains('is-installing'), false);
  assert.equal(JSON.stringify(progression.data.virtualFilesystem), JSON.stringify({ deleted: [], added: {} }));
});

test('toolbar installation advances on real asynchronous time and reaches its final step', async () => {
  const { installer } = setup({ realTimers: true });
  const instance = installer.open();
  const root = instance.element.querySelector('.toolbar-installer-content');
  root.querySelector('[data-action="next"]').click();
  root.querySelector('[data-action="install"]').click();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(instance.step, 'installing');
  assert.ok(root.progress.value > 0 && root.progress.value < 78);
  assert.equal(instance.element.classList.contains('is-installing'), true);
  await new Promise((resolve) => setTimeout(resolve, 2700));
  assert.equal(instance.step, 'failure');
  assert.equal(instance.elapsed, 2600);
  assert.equal(instance.element.classList.contains('is-installing'), false);
});

test('the progress cursor stays active only while installation is running', () => {
  const css = readFileSync(new URL('../src/styles-toolbar-installer.css', import.meta.url), 'utf8');
  assert.match(css, /\.toolbar-installer-window\.is-installing,\s*\.toolbar-installer-window\.is-installing \*\s*\{[^}]*cursor:\s*progress/s);
  assert.match(css, /\.toolbar-installer-window \.toolbar-installer-actions \.xp-button:disabled\s*\{[^}]*cursor:\s*inherit/s);
});

test('canceling during setup closes the window and removes any running timer', () => {
  const { manager, intervals, cleared, installer, advance } = setup();
  const instance = installer.open();
  const root = instance.element.querySelector('.toolbar-installer-content');
  root.querySelector('[data-action="next"]').click();
  root.querySelector('[data-action="install"]').click();
  assert.equal(intervals.length, 1);
  manager.close(instance.id);
  assert.deepEqual(cleared, [1]);
  assert.equal(instance.timer, null);
  assert.equal(instance.element.isConnected, false);
  assert.equal(instance.element.classList.contains('is-installing'), false);
  const markupAtClose = root.markup;
  advance(3000);
  intervals[0].callback();
  assert.equal(root.markup, markupAtClose, 'a canceled callback cannot render the failure screen later');
});

test('a progress rendering error clears the timer and shows the download error', () => {
  const { manager, intervals, cleared, installer } = setup();
  const instance = installer.open();
  const root = instance.element.querySelector('.toolbar-installer-content');
  root.querySelector('[data-action="next"]').click();
  root.querySelector('[data-action="install"]').click();
  const originalQuerySelector = instance.element.querySelector;
  instance.element.querySelector = (selector) => {
    if (selector === '.toolbar-installer-content progress') throw new Error('DOM unavailable');
    return originalQuerySelector(selector);
  };
  intervals[0].callback();
  assert.equal(instance.step, 'failure');
  assert.equal(instance.timer, null);
  assert.equal(instance.element.classList.contains('is-installing'), false);
  assert.deepEqual(cleared, [1]);
  assert.match(root.markup, /Erreur de t\u00e9l\u00e9chargement/);
  manager.close(instance.id);
});
