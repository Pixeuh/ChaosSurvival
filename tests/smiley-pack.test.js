import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Progression } from '../src/story/progression.js';
import { DesktopApplications } from '../src/ui/desktop-apps.js';
import { SmileyPackInstaller } from '../src/ui/smiley-pack-installer.js';
import { createExecutableLauncher } from '../src/ui/executable-launcher.js';
import { executableAssociation } from '../src/ui/executable-registry.js';
import { VirtualFilesystem, virtualFileId } from '../src/story/virtual-filesystem.js';

const story = JSON.parse(readFileSync(new URL('../src/config/story.json', import.meta.url), 'utf8'));

class FakeElement {
  constructor() {
    this.isConnected = true;
    this.hidden = false;
    this.listeners = new Map();
    this.classList = {
      names: new Set(),
      add: (name) => this.classList.names.add(name),
      remove: (name) => this.classList.names.delete(name),
      contains: (name) => this.classList.names.has(name),
    };
    this.style = {};
    this.value = 0;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  click() {
    for (const listener of this.listeners.get('click') ?? []) listener({ target: this });
  }
  remove() { this.isConnected = false; }
}

class FakeInstallerContent extends FakeElement {
  set innerHTML(markup) {
    this.markup = markup;
    this.buttons = new Map();
    this.progress = new FakeElement();
  }
  querySelector(selector) {
    if (selector.endsWith('progress')) return this.progress;
    const action = selector.match(/data-action="([^"]+)"/)?.[1];
    if (!action || !this.markup.includes(`data-action="${action}"`)) return null;
    if (!this.buttons.has(action)) this.buttons.set(action, new FakeElement());
    return this.buttons.get(action);
  }
}

function installerSetup() {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const progression = new Progression(story, storage);
  progression.begin();
  const savedData = JSON.stringify(progression.data);
  const savedStorage = new Map(values);
  const calls = [];
  const manager = {
    windows: new Map(),
    spawn(type, options) {
      const id = calls.length + 1;
      calls.push({ type, ...options });
      const element = new FakeElement();
      const content = new FakeInstallerContent();
      element.querySelector = (selector) => selector === '.smiley-pack-installer-content'
        ? content
        : content.querySelector(selector);
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
      const instance = {
        key, id, title,
        element: manager.windows.get(id).element,
        task: new FakeElement(),
      };
      this.instances.set(key, instance);
      return instance;
    },
    restore(instance) { this.restores++; instance.element.hidden = false; },
    onWindowState() {},
  };
  const intervals = [];
  const cleared = [];
  let now = 0;
  const installer = new SmileyPackInstaller(manager, applications, {
    setIntervalFn: (callback, delay) => (intervals.push({ callback, delay }), intervals.length),
    clearIntervalFn: (id) => cleared.push(id),
    nowFn: () => now,
  });
  return {
    progression, savedData, savedStorage, values, calls, manager, applications,
    intervals, cleared, installer,
    advance: (ms) => { now += ms; },
  };
}

test('WinRoar extracts the pack into a persistent virtual installer and New Game resets extraction', () => {
  const progression = new Progression(story);
  const filesystem = new VirtualFilesystem(progression);
  const archiveId = virtualFileId('downloads', 'smileys_pack_2009.zip');
  const archive = filesystem.getFile(archiveId);
  assert.equal(archive.extractable, 'smiley-pack-2009');
  const extract = new FakeElement();
  const deleteButton = new FakeElement();
  const properties = new FakeElement();
  const winRoarStatus = new FakeElement();
  const winRoarProgress = new FakeElement();
  const winRoarTitle = new FakeElement();
  const spawned = [];
  const cleared = [];
  const manager = {
    windows: new Map(),
    spawn(type, options) { spawned.push({ type, ...options }); return spawned.length; },
  };
  const app = Object.assign(Object.create(DesktopApplications.prototype), {
    manager,
    virtualFilesystem: filesystem,
    instances: new Map(),
    onWindowState() {},
    onFilesystemChange() {},
    refreshExplorers() {},
    attachWindow(key, id) {
      const instance = {
        id, key,
        element: {
          isConnected: true,
          querySelector(selector) {
            if (selector === '.winroar-extraction strong') return winRoarTitle;
            if (selector.includes('progress')) return winRoarProgress;
            if (selector.includes('status')) return winRoarStatus;
            return null;
          },
        },
        task: new FakeElement(),
      };
      this.instances.set(key, instance);
      manager.windows.set(id, { element: instance.element });
      return instance;
    },
    restore() {},
  });
  let timerCallback;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (callback, delay) => {
    assert.equal(delay, 50);
    timerCallback = callback;
    return 19;
  };
  globalThis.clearInterval = (id) => cleared.push(id);
  try {
    const explorerInstance = {
      explorerMenu: {
        style: {}, offsetWidth: 0, offsetHeight: 0,
        querySelector: (selector) => selector.includes('extract') ? extract : selector.includes('delete') ? deleteButton : properties,
      },
      current: filesystem.getLocation('downloads'),
      element: { querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) }) },
    };
    app.showExplorerContext(explorerInstance, archive, { clientX: 30, clientY: 40 });
    assert.equal(extract.hidden, false, 'the ZIP offers the existing WinRoar action');
    const winRoar = app.extractWithWinRoar(archive);
    assert.ok(winRoar);
    assert.equal(winRoarTitle.textContent, 'Extraction de smileys_pack_2009.zip');
    for (let index = 0; index < 60; index++) timerCallback();
    assert.equal(winRoarProgress.value, 1);
    assert.equal(winRoarStatus.textContent, 'Extraction terminée.');

    const folderId = virtualFileId('downloads', 'smiley_pack_2009');
    const executableId = virtualFileId('smiley-pack-2009-folder', 'Smiley Pack 2009.exe');
    const folder = filesystem.getFile(folderId);
    const executable = filesystem.getFile(executableId);
    assert.equal(folder.directory, true);
    assert.deepEqual(filesystem.getLocation(folder.location).items.map((file) => file.name), ['Smiley Pack 2009.exe']);
    assert.equal(executableAssociation(executable, executableId), 'smiley-pack-installer');
    assert.deepEqual(cleared, [19]);

    assert.equal(filesystem.deleteFile(folderId).ok, true);
    assert.equal(new VirtualFilesystem(progression).exists(executableId), false, 'folder deletion removes the EXE persistently');
    assert.equal(filesystem.deleteFile(archiveId).ok, true);
    assert.equal(new VirtualFilesystem(progression).exists(archiveId), false, 'archive deletion persists');
    progression.newGame();
    const freshFilesystem = new VirtualFilesystem(progression);
    assert.equal(freshFilesystem.exists(archiveId), true);
    assert.equal(freshFilesystem.exists(folderId), false);
    assert.equal(freshFilesystem.exists(executableId), false);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});

test('the installer simulates a 43 percent interrupted download without changing saves and can be relaunched', () => {
  const { progression, savedData, savedStorage, values, calls, applications, manager, intervals, cleared, installer, advance } = installerSetup();
  const fileId = virtualFileId('smiley-pack-2009-folder', 'Smiley Pack 2009.exe');
  const instance = installer.open(fileId);
  const content = instance.element.querySelector('.smiley-pack-installer-content');
  assert.equal(instance.step, 'welcome');
  assert.match(content.markup, /Bienvenue dans l.assistant d.installation de Smiley Pack 2009 !/);
  assert.match(content.markup, /data-action="install"/);
  assert.match(content.markup, /data-action="cancel"/);
  assert.equal(installer.open(fileId), instance);
  assert.equal(calls.length, 1, 'relaunching an open installer restores its existing window');

  content.querySelector('[data-action="install"]').click();
  const progressBar = content.progress;
  assert.equal(instance.step, 'installing');
  assert.equal(instance.element.classList.contains('is-installing'), true);
  assert.match(content.markup, /T\u00e9l\u00e9chargement de Smiley Pack 2009\.\.\./);
  assert.equal(intervals[0].delay, 40);
  advance(1250);
  intervals[0].callback();
  assert.equal(progressBar.value, 21.5);
  advance(1250);
  intervals[0].callback();
  assert.equal(progressBar.value, 43);
  assert.equal(instance.step, 'installing', 'the progress remains at 43 percent during the pause');
  assert.equal(instance.element.classList.contains('is-installing'), true);
  advance(999);
  intervals[0].callback();
  assert.equal(instance.step, 'installing');
  assert.equal(instance.element.classList.contains('is-installing'), true);
  advance(1);
  intervals[0].callback();
  assert.equal(instance.step, 'failure');
  assert.equal(instance.element.classList.contains('is-installing'), false);
  assert.match(content.markup, /Erreur de t\u00e9l\u00e9chargement/);
  assert.match(content.markup, /Impossible \u00e0 t\u00e9l\u00e9charger/);
  assert.match(content.markup, /data-action="ok"/);
  assert.equal(JSON.stringify(progression.data), savedData, 'the simulation does not mutate game saves');
  assert.deepEqual(values, savedStorage, 'installation does not write to browser storage');
  assert.equal(progression.data.flags.smileyPack2009Installed, undefined);
  content.querySelector('[data-action="ok"]').click();
  assert.deepEqual(cleared, [1]);
  assert.equal(instance.element.classList.contains('is-installing'), false);

  const second = installer.open(fileId);
  assert.notEqual(second, instance);
  assert.equal(second.step, 'welcome', 'a later launch always restarts the wizard');
  assert.equal(calls.length, 2);
  assert.equal(applications.restores, 3);
  assert.equal(manager.windows.size, 1);
});

test('opening the extracted EXE through the explorer reaches the real Smiley Pack click handler', () => {
  const { progression, applications, installer, intervals, advance } = installerSetup();
  const filesystem = new VirtualFilesystem(progression);
  const folderId = virtualFileId('downloads', 'smiley_pack_2009');
  const executableId = virtualFileId('smiley-pack-2009-folder', 'Smiley Pack 2009.exe');
  filesystem.addDirectory('downloads', 'smiley_pack_2009', 'smiley-pack-2009-folder');
  filesystem.addFile('smiley-pack-2009-folder', {
    name: 'Smiley Pack 2009.exe', icon: 'application', detail: 'Installateur',
    deletable: true, virtualApp: 'smiley-pack-installer',
  });
  let routed = 0;
  const explorer = Object.assign(Object.create(DesktopApplications.prototype), {
    virtualFilesystem: filesystem,
    instances: applications.instances,
    onLaunchExecutable: createExecutableLauncher({
      'smiley-pack-installer': (_file, fileId) => {
        assert.equal(fileId, executableId);
        routed++;
        return installer.open(fileId);
      },
    }),
  });

  const executable = filesystem.getFile(executableId);
  const instance = explorer.openFile(filesystem.getLocation('smiley-pack-2009-folder'), executable);
  assert.equal(routed, 1);
  assert.equal(instance.step, 'welcome');
  const content = instance.element.querySelector('.smiley-pack-installer-content');
  content.querySelector('[data-action="install"]').click();
  assert.equal(instance.step, 'installing');
  assert.equal(intervals.length, 1);
  assert.equal(content.progress.value, 0);
  advance(1000);
  intervals[0].callback();
  assert.ok(content.progress.value > 0);
  advance(1500);
  intervals[0].callback();
  assert.equal(content.progress.value, 43);
  advance(1000);
  intervals[0].callback();
  assert.match(content.markup, /Impossible \u00e0 t\u00e9l\u00e9charger/);
  assert.equal(instance.element.classList.contains('is-installing'), false);
  assert.ok(filesystem.exists(folderId));
});

test('the real installer timer shows progress before the paused error', async () => {
  const { installer } = installerSetup();
  installer.setInterval = setInterval;
  installer.clearInterval = clearInterval;
  installer.now = () => performance.now();
  const instance = installer.open('smiley-pack-2009-folder/Smiley Pack 2009.exe');
  const content = instance.element.querySelector('.smiley-pack-installer-content');
  content.querySelector('[data-action="install"]').click();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(instance.step, 'installing');
  assert.ok(content.progress.value > 0 && content.progress.value < 43);
  await new Promise((resolve) => setTimeout(resolve, 2600));
  assert.equal(instance.step, 'failure');
  assert.equal(instance.element.classList.contains('is-installing'), false);
});

test('closing during installation cancels its timer and restores the normal cursor', () => {
  const { manager, intervals, cleared, installer, advance } = installerSetup();
  const instance = installer.open('smiley-pack-2009-folder/smiley pack 2009.exe');
  instance.element.querySelector('.smiley-pack-installer-content')
    .querySelector('[data-action="install"]').click();
  manager.close(instance.id);
  assert.deepEqual(cleared, [1]);
  assert.equal(instance.element.classList.contains('is-installing'), false);
  advance(5000);
  intervals[0].callback();
  assert.equal(instance.step, 'closed');
  assert.equal(instance.element.isConnected, false);
});

test('an old extracted installer remains launchable while its legacy installed flag has no effect', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const folderId = virtualFileId('downloads', 'smiley_pack_2009');
  const executableId = virtualFileId('smiley-pack-2009-folder', 'Smiley Pack 2009.exe');
  values.set('chaos-survival-story-v1', JSON.stringify({
    version: 1,
    started: true,
    current: story.start,
    completed: [],
    flags: { smileyPack2009Installed: true },
    virtualFilesystem: { deleted: [], added: {
      [folderId]: {
        name: 'smiley_pack_2009', icon: 'folder', detail: 'Dossier', deletable: true,
        directory: true, location: 'smiley-pack-2009-folder',
      },
      [executableId]: {
        name: 'Smiley Pack 2009.exe', icon: 'application', detail: 'Installateur',
        deletable: true, virtualApp: 'smiley-pack-installer',
      },
    } },
  }));
  const progression = new Progression(story, storage);
  const filesystem = new VirtualFilesystem(progression);
  const executable = filesystem.getFile(executableId);
  assert.equal(executableAssociation(executable, executableId), 'smiley-pack-installer');
  assert.equal(progression.data.flags.smileyPack2009Installed, true, 'legacy data remains intact but is ignored by the installer');
  assert.ok(filesystem.getFile(folderId));
});
