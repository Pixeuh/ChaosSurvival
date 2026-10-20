// Focused UI check against the local production build; no portable packaging.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import electron from 'electron';
import { Progression } from '../src/story/progression.js';
import { DialogueSession } from '../src/story/dialogue.js';
import { ConversationThread } from '../src/story/conversation-thread.js';
import { smileyIcon } from '../src/minigames/smiley-icons.js';
import contacts from '../src/config/contacts.json' with { type: 'json' };
import { orderedContacts, visibleContacts } from '../src/ui/contacts.js';

const rulesOnly = process.argv.includes('--rules-only');
const typingOnly = process.argv.includes('--typing-only');
const messengerOnly = process.argv.includes('--messenger-only');
const notepadOnly = process.argv.includes('--notepad-only');
const movementOnly = process.argv.includes('--window-movement-only');
const stabilityOnly = process.argv.includes('--layout-stability-only');
const gridOnly = process.argv.includes('--desktop-grid-only');
const menuLayoutOnly = process.argv.includes('--menu-layout-only');
const smileyDialogueOnly = process.argv.includes('--smiley-dialogue-only');
const newGameOnly = process.argv.includes('--new-game-only');
const buddyOnly = process.argv.includes('--buddy-only');
const browserOnly = process.argv.includes('--browser-only');
const browserSecurityElectron = process.argv.includes('--browser-security-electron');
const skyPageOnly = process.argv.includes('--skypage-only');
const flashZoneOnly = process.argv.includes('--flashzone-only');
const videoTubeOnly = process.argv.includes('--videotube-only');
const wikiOnly = process.argv.includes('--wiki-only');
const hoplaHotelOnly = process.argv.includes('--hopla-hotel-only');
const explorerOnly = process.argv.includes('--explorer-only');
const visibleExplorerOnly = process.argv.includes('--visible-explorer-only');
const visibleMessengerOnly = process.argv.includes('--visible-messenger-only');
const visibleK7DeliveryOnly = process.argv.includes('--visible-k7-delivery-only');
const visibleSmokeOnly = process.argv.includes('--visible-smoke-only');
const visiblePortraitOnly = process.argv.includes('--visible-portrait-only');
const minigameOnly =
  process.argv.includes('--minigame-only') ||
  typingOnly ||
  rulesOnly ||
  messengerOnly ||
  notepadOnly ||
  movementOnly ||
  gridOnly ||
  menuLayoutOnly ||
  smileyDialogueOnly ||
  newGameOnly ||
  buddyOnly ||
  browserOnly ||
  skyPageOnly ||
  flashZoneOnly ||
  videoTubeOnly ||
  wikiOnly ||
  hoplaHotelOnly ||
  explorerOnly ||
  visibleExplorerOnly ||
  visibleMessengerOnly ||
  visibleK7DeliveryOnly ||
  visibleSmokeOnly ||
  visiblePortraitOnly ||
  stabilityOnly;
const browserAutomation =
  minigameOnly &&
  !visibleExplorerOnly &&
  !visibleMessengerOnly &&
  !visibleK7DeliveryOnly &&
  !visibleSmokeOnly &&
  !visiblePortraitOnly;
let browserServer, profile, port, gameUrl, chromiumExecutable = null, child, spawnError = null;
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.qa');
let dialogueDefinitionsCache;
async function visibleRosterFor(progressionState) {
  if (!dialogueDefinitionsCache) {
    const files = (await readdir(path.join(root, 'src/dialogues'))).filter((name) =>
      name.endsWith('.json'),
    );
    dialogueDefinitionsCache = Object.fromEntries(
      await Promise.all(
        files.map(async (name) => {
          const dialogue = JSON.parse(
            await readFile(path.join(root, 'src/dialogues', name), 'utf8'),
          );
          return [dialogue.id, dialogue];
        }),
      ),
    );
  }
  return orderedContacts(
    visibleContacts(
      dialogueDefinitionsCache,
      progressionState.unlockedConversations,
      contacts,
      progressionState.contactConnections,
      progressionState.contactProfiles,
      progressionState.flags,
    ),
  );
}
try {
await mkdir(output, { recursive: true });
profile = await mkdtemp(path.join(tmpdir(), 'chaos-survival-desktop-profile-'));
const listener = createServer().listen(0, '127.0.0.1');
await once(listener, 'listening');
port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CHAOS_DEV_URL;
if (browserAutomation) {
  const { preview } = await import('vite');
  browserServer = await preview({
    configLoader: 'runner',
    preview: { host: '127.0.0.1', port: 0 },
  });
}
gameUrl = browserAutomation ? browserServer.resolvedUrls.local[0] : 'chaos://game/';
const chromiumCandidates = [
  process.env.CHAOS_CHROMIUM_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);
if (browserAutomation) {
  for (const candidate of chromiumCandidates) {
    try {
      await access(candidate);
      chromiumExecutable = candidate;
      break;
    } catch {
      // Try the next locally installed browser.
    }
  }
  if (!chromiumExecutable) {
    throw new Error(
      'Aucun navigateur Chromium trouvé. Définissez CHAOS_CHROMIUM_PATH ou installez Chrome/Edge.',
    );
  }
}
const executable = browserAutomation ? chromiumExecutable : electron;
child = spawn(
  executable,
  browserAutomation
    ? [
        '--headless=new',
        '--disable-gpu',
        '--disable-gpu-compositing',
        '--disable-features=Vulkan,WebGPU,SkiaGraphite',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--no-first-run',
        '--no-default-browser-check',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        gameUrl,
      ]
    : [root, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`],
  { env, windowsHide: browserAutomation, stdio: ['ignore', 'ignore', 'pipe'] },
);
child.on('error', (error) => {
  spawnError = error;
});
} catch (error) {
  if (child?.pid && child.exitCode === null) child.kill();
  if (browserServer)
    await new Promise((resolve) => browserServer.httpServer.close(resolve)).catch(() => {});
  if (profile)
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
  throw error;
}
const scenarioName = visibleSmokeOnly
  ? 'Bureau minimal Electron visible'
  : visiblePortraitOnly
    ? 'Disposition des portraits Messenger'
    : visibleK7DeliveryOnly
      ? 'Réception K7 Messenger (Electron visible)'
  : visibleMessengerOnly || messengerOnly
    ? 'Messenger'
    : visibleExplorerOnly
      ? 'Poste de travail Electron visible'
      : explorerOnly
        ? 'Poste de travail Chromium'
        : 'campagne de validation visuelle';
const scenarioBudgetMs = visibleK7DeliveryOnly
  ? 60_000
  : visibleSmokeOnly || visiblePortraitOnly
  ? 45_000
  : visibleMessengerOnly || messengerOnly
    ? 90_000
    : 240_000;
const scenarioStartedAt = Date.now();
const scenarioDeadline = scenarioStartedAt + scenarioBudgetMs;
const rawWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function qaLog(message) {
  console.log(`[VISUAL QA] ${message}`);
}
let currentStep = 'application startup';
function qaStep(message) {
  currentStep = message;
  qaLog(message);
}
qaLog(`Commande : ${process.env.npm_lifecycle_event ? `npm run ${process.env.npm_lifecycle_event}` : process.argv.join(' ')}`);
qaLog(`Début du scénario : ${scenarioName} (limite ${Math.round(scenarioBudgetMs / 1000)} s)`);
let stderr = '',
  socket,
  sequence = 0;
child.stderr.on('data', (bytes) => {
  stderr = (stderr + bytes).slice(-4096);
});
const pending = new Map(),
  exceptions = [];
async function wait(ms) {
  const remaining = scenarioDeadline - Date.now();
  if (remaining <= 0) throw new Error(`Limite totale du scénario atteinte après ${scenarioBudgetMs} ms.`);
  const delay = Math.min(ms, remaining);
  await rawWait(delay);
  if (delay < ms || Date.now() >= scenarioDeadline)
    throw new Error(`Limite totale du scénario atteinte après ${scenarioBudgetMs} ms.`);
}
async function until(check, description, timeout = 12000) {
  const localDeadline = Math.min(Date.now() + timeout, scenarioDeadline);
  while (Date.now() < localDeadline) {
    if (spawnError) throw spawnError;
    if (await check()) return;
    await wait(Math.min(50, localDeadline - Date.now()));
  }
  if (Date.now() >= scenarioDeadline)
    throw new Error(`Limite totale du scénario atteinte pendant « ${description} » après ${scenarioBudgetMs} ms. ${stderr}`);
  throw new Error(`Délai dépassé : ${description}. ${stderr}`);
}
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = Math.min(10000, scenarioDeadline - Date.now());
    if (timeout <= 0) {
      reject(new Error(`Limite totale du scénario atteinte avant ${method}.`));
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timeout ${timeout} ms CDP : ${method} ${params.expression ?? ''}. ${stderr}`));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const doubleClick = (selector) =>
  evaluate(
    `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('dblclick', {bubbles:true}))`,
  );
async function verifyNotepad() {
  const story = JSON.parse(await readFile(path.join(root, 'src/config/story.json')));
  const progression = new Progression(story);
  progression.begin();
  progression.complete('arcade-1');
  progression.complete('pixelgirl-hello');
  await command('Page.enable');
  const injection = await command('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('chaos-survival-story-v1',${JSON.stringify(JSON.stringify(progression.data))});window.__notepadFixture=true`,
  });
  await command('Page.reload');
  await until(
    () =>
      evaluate("window.__notepadFixture&&window.chaosDebug?.snapshot().phase==='menu'").catch(
        () => false,
      ),
    'notepad fixture',
  );
  await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
  async function desktop() {
    await click('#menu-play');
    await until(() => evaluate("window.chaosDebug.snapshot().phase==='desktop'"), 'desktop');
    await doubleClick('[data-shortcut=folder]');
  }
  const names = ['devoir_final_v7_VRAIMENT_FINAL.txt', 'liens_trop_biens.txt'];
  const selector = (name) => `[data-file-path="folder/${name}"]`;
  const area = (name) => `${selector(name)} .notepad-content`;
  const value = (name) => evaluate(`document.querySelector(${JSON.stringify(area(name))}).value`);
  async function open(name) {
    await evaluate(`(() => {
      const row=[...document.querySelectorAll('.explorer-item')].find(row=>row.querySelector('strong').textContent===${JSON.stringify(name)});
      row.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    })()`);
  }
  async function edit(name, text) {
    await evaluate(`(() => {
      const editor=document.querySelector(${JSON.stringify(area(name))});
      editor.value=${JSON.stringify(text)};editor.dispatchEvent(new Event('input',{bubbles:true}));editor.focus();
    })()`);
  }
  async function ctrlS() {
    await command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 's',
      code: 'KeyS',
      modifiers: 2,
    });
    await command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 's',
      code: 'KeyS',
      modifiers: 2,
    });
  }
  const saved = () =>
    evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1')).textFiles");
  const title = (name) =>
    evaluate(
      `document.querySelector(${JSON.stringify(selector(name) + ' .window-title > span')}).textContent`,
    );
  await desktop();
  const retainedStartOrder = await verifyStartMenuOrder();
  await open(names[0]);
  const fileButton = selector(names[0]) + ' .messenger-menu-group > button';
  const dropdown = selector(names[0]) + ' .messenger-dropdown';
  await until(
    () =>
      evaluate(
        `getComputedStyle(document.querySelector(${JSON.stringify(selector(names[0]))})).transform==='none'`,
      ),
    'notepad animation',
  );
  const menuHidden = () => evaluate(`document.querySelector(${JSON.stringify(dropdown)}).hidden`);
  async function checkFileMenu() {
    await physicalClick(fileButton);
    const geometry = await evaluate(`(() => {
      const button=document.querySelector(${JSON.stringify(fileButton)}).getBoundingClientRect();
      const menu=document.querySelector(${JSON.stringify(dropdown)});
      const rect=menu.getBoundingClientRect();
      const frame=menu.closest('.xp-window').getBoundingClientRect();
      const options=[...menu.querySelectorAll('button')].map(option=>{
        const r=option.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,visible:option.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};
      });
      return {left:rect.left,top:rect.top,buttonLeft:button.left,buttonBottom:button.bottom,inside:rect.left>=frame.left&&rect.right<=frame.right&&rect.bottom<=frame.bottom,background:getComputedStyle(menu).backgroundColor,image:getComputedStyle(menu).backgroundImage,options};
    })()`);
    assert.equal(geometry.left, geometry.buttonLeft);
    assert.equal(geometry.top, geometry.buttonBottom);
    assert.equal(geometry.inside, true);
    assert.equal(
      geometry.background,
      'rgb(255, 253, 244)',
      'Notepad keeps its original menu palette',
    );
    assert.equal(geometry.image, 'none');
    assert.ok(geometry.options.every((option) => option.visible));
    assert.ok(geometry.options[0].bottom <= geometry.options[1].top);
    assert.equal(geometry.options[0].left, geometry.options[1].left);
  }
  await checkFileMenu();
  await capture('notepad-file-menu.png');
  await physicalClick(fileButton);
  assert.equal(await menuHidden(), true);
  await physicalClick(fileButton);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  assert.equal(await menuHidden(), true);
  await physicalClick(fileButton);
  await physicalClick(area(names[0]));
  assert.equal(await menuHidden(), true);
  // Native titlebar drag places Notepad at the right desktop edge, then checks the menu again.
  await physicalDrag(selector(names[0]) + ' .titlebar', 10000, 100);
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(selector(names[0]))}).getBoundingClientRect().right`,
    ),
    await evaluate("document.querySelector('.desktop').getBoundingClientRect().right"),
  );
  await checkFileMenu();
  await physicalClick(fileButton);
  const original = await value(names[0]);
  const payload =
    '<script>window.__notepadExecuted=true</script>\nnew Function("alert(1)")\nété 😃 日本語';
  await edit(names[0], payload);
  assert.ok((await title(names[0])).startsWith('*'));
  await ctrlS();
  assert.equal((await saved())[`folder/${names[0]}`].text, payload);
  assert.ok(!(await title(names[0])).startsWith('*'));
  assert.equal(await evaluate('window.__notepadExecuted===undefined'), true);
  await click(selector(names[0]) + ' .close-button');
  await open(names[0]);
  assert.equal(await value(names[0]), payload);
  await edit(names[0], 'discard me');
  await click(selector(names[0]) + ' .close-button');
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(selector(names[0]) + ' .notepad-confirm')}).hidden`,
    ),
    false,
  );
  await click(selector(names[0]) + ' [data-answer=cancel]');
  assert.equal(await value(names[0]), 'discard me');
  await click(selector(names[0]) + ' .close-button');
  await capture('notepad-save-confirmation.png');
  await click(selector(names[0]) + ' [data-answer=no]');
  await open(names[0]);
  assert.equal(await value(names[0]), payload);
  await edit(names[0], 'saved with Yes');
  // Exercise the real shared menu, including File > Quit.
  await click(selector(names[0]) + ' .messenger-menu-group > button');
  await physicalClick(selector(names[0]) + ' .messenger-dropdown button:last-child');
  await evaluate(
    `window.__realTextSave=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='chaos-survival-story-v1')throw new Error('quota');return window.__realTextSave.call(this,key,value)}`,
  );
  await click(selector(names[0]) + ' [data-answer=yes]');
  assert.equal(await value(names[0]), 'saved with Yes');
  assert.ok((await title(names[0])).startsWith('*'));
  assert.equal((await saved())[`folder/${names[0]}`].text, payload);
  await evaluate('Storage.prototype.setItem=window.__realTextSave;delete window.__realTextSave');
  await click(selector(names[0]) + ' [data-answer=yes]');
  await open(names[0]);
  assert.equal(await value(names[0]), 'saved with Yes');
  await open(names[1]);
  await verifyTaskbarOrder();
  await edit(names[0], 'first dirty');
  await edit(names[1], 'second saved');
  await ctrlS();
  assert.equal((await saved())[`folder/${names[0]}`].text, 'saved with Yes');
  assert.equal((await saved())[`folder/${names[1]}`].text, 'second saved');
  const boundary = '😃'.repeat(25600);
  await edit(names[1], boundary);
  await ctrlS();
  await edit(names[1], boundary + 'é');
  assert.equal(await value(names[1]), boundary);
  assert.ok(
    (
      await evaluate(
        `document.querySelector(${JSON.stringify(selector(names[1]) + ' .window-status')}).textContent`,
      )
    ).includes('refusée'),
  );
  await evaluate(`document.querySelector(${JSON.stringify(area(names[1]))}).select()`);
  await command('Input.insertText', { text: 'x'.repeat(102401) });
  assert.equal(await value(names[1]), boundary);
  await edit(names[1], 'small again');
  await click(selector(names[1]) + ' .messenger-menu-group > button');
  await physicalClick(selector(names[1]) + ' .messenger-dropdown button:first-child');
  // An active explorer must not save a minimized or background Notepad.
  await edit(names[1], 'not saved behind explorer');
  await click(selector(names[1]) + ' .msn-minimize');
  await doubleClick('[data-shortcut=folder]');
  await ctrlS();
  assert.equal((await saved())[`folder/${names[1]}`].text, 'small again');
  await open(names[1]);
  await capture('notepad-editor.png');
  // A new JS context reloads the saved story, not the editors' unsaved buffers.
  await evaluate('window.__notepadBeforeReload=true');
  await command('Page.reload');
  await until(
    () =>
      evaluate("!window.__notepadBeforeReload&&window.chaosDebug?.snapshot().phase==='menu'").catch(
        () => false,
      ),
    'notepad restart',
  );
  await desktop();
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('#start-menu > [data-start-app]')].map(b=>b.dataset.startApp)",
    ),
    retainedStartOrder,
  );
  await open(names[0]);
  await open(names[1]);
  assert.equal(await value(names[0]), 'saved with Yes');
  assert.equal(await value(names[1]), 'small again');
  assert.notEqual(original, 'saved with Yes');
  assert.deepEqual(
    await evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1')).completed"),
    ['arcade-1', 'pixelgirl-hello'],
  );
  console.log(
    'Bloc-notes : édition, Ctrl+S actif, menus, Oui/Non/Annuler, Unicode, limite UTF-8, texte inerte et relance validés.',
  );
}
async function verifyStartMenuOrder() {
  const order = () =>
    evaluate(
      "[...document.querySelectorAll('#start-menu > [data-start-app]')].map(b=>b.dataset.startApp)",
    );
  await physicalClick('#windows-start');
  const initial = await order();
  const desktopCells = await evaluate(
    "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).desktopIcons)",
  );
  const taskIds = await evaluate(
    "[...document.querySelectorAll('.taskbar > button.task-tab[data-window-id]')].map(b=>b.dataset.windowId)",
  );
  const apps = await evaluate("document.querySelectorAll('#playfield > .popup').length");
  async function move(id, target, bias) {
    const source = `#start-menu > [data-start-app="${id}"]`;
    const rect = await evaluate(
      `(() => {const r=document.querySelector('#start-menu > [data-start-app="${target}"]').getBoundingClientRect();return {left:r.left,top:r.top};})()`,
    );
    await physicalDrag(source, rect.left, rect.top + bias);
    assert.equal(await evaluate("document.querySelector('#start-menu').hidden"), false);
    assert.equal(
      await evaluate("document.querySelectorAll('#playfield > .popup').length"),
      apps,
      'drag must not launch an application',
    );
    assert.equal(
      await evaluate(
        "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).desktopIcons)",
      ),
      desktopCells,
    );
    assert.deepEqual(
      await evaluate(
        "[...document.querySelectorAll('.taskbar > button.task-tab[data-window-id]')].map(b=>b.dataset.windowId)",
      ),
      taskIds,
    );
    assert.equal(
      await evaluate("document.querySelector('#start-menu > header').nextElementSibling.id"),
      'menu-buddy',
    );
    assert.equal(
      await evaluate("document.querySelector('#start-menu').lastElementChild.className"),
      'start-menu-actions',
    );
  }
  await move(initial[0], initial.at(-1), 10);
  assert.deepEqual(await order(), [...initial.slice(1), initial[0]]);
  await move(initial[0], initial[1], -10);
  assert.deepEqual(await order(), initial);
  await move(initial[0], initial[1], 10);
  const changed = [initial[1], initial[0], ...initial.slice(2)];
  assert.deepEqual(await order(), changed);
  await capture('start-menu-reordered.png');
  await physicalClick('#windows-start');
  await physicalClick('#windows-start');
  assert.deepEqual(await order(), changed);
  // A movement below five pixels stays a regular click and launches the original action.
  const bin = await evaluate(
    "(() => {const r=document.querySelector('#start-menu > [data-start-app=bin]').getBoundingClientRect();return {left:r.left,top:r.top};})()",
  );
  await physicalDrag('#start-menu > [data-start-app=bin]', bin.left + 2, bin.top + 2);
  await until(
    () => evaluate("!!document.querySelector('[data-app=bin]')"),
    'ordinary start-menu application click',
  );
  assert.equal(await evaluate("document.querySelector('#start-menu').hidden"), true);
  await click(
    '[data-window-id="' +
      (await evaluate(
        "document.querySelector('.desktop-app-task[data-app=bin]').dataset.windowId ?? [...document.querySelectorAll('.popup-desktopapp')].find(w=>w.querySelector('.window-title > span').textContent==='Corbeille').dataset.windowId",
      )) +
      '"] .close-button',
  );
  await physicalClick('#windows-start');
  assert.deepEqual(await order(), changed);
  await physicalClick('#start-menu-main');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='menu'"),
    'fixed main-menu command',
  );
  await click('#menu-play');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='desktop'"),
    'continue after fixed command',
  );
  await doubleClick('[data-shortcut=folder]');
  console.log(
    'Menu Démarrer : premier/dernier/milieu, seuil de déplacement, aucun lancement pendant drag, commande fixe et ordre conservé validés.',
  );
  return changed;
}
async function verifyTaskbarOrder() {
  const startOrder = await evaluate(
    "[...document.querySelectorAll('#start-menu > [data-start-app]')].map(b=>b.dataset.startApp)",
  );
  const iconCells = await evaluate(
    "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).desktopIcons)",
  );
  const order = () =>
    evaluate(
      "[...document.querySelectorAll('.taskbar > button.task-tab[data-window-id]')].map(b=>b.dataset.windowId)",
    );
  const windows = () =>
    evaluate(
      "[...document.querySelectorAll('#playfield > .popup')].map(w=>({id:w.dataset.windowId,hidden:w.hidden,z:w.style.zIndex}))",
    );
  const fixed = () =>
    evaluate(
      "['#windows-start','.tray'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top};})",
    );
  const initial = await order(),
    beforeWindows = await windows(),
    beforeFixed = await fixed();
  assert.ok(initial.length >= 3);
  async function move(id, target, bias) {
    const rect = await evaluate(
      `(() => {const r=document.querySelector('.taskbar > button[data-window-id="${target}"]').getBoundingClientRect();const source=document.querySelector('.taskbar > button[data-window-id="${id}"]');const s=source.getBoundingClientRect();const icon=source.querySelector('.icon').getBoundingClientRect();return {left:r.left+r.width/2-(icon.left+icon.width/2-s.left),top:r.top};})()`,
    );
    await physicalDrag(`.taskbar > button[data-window-id="${id}"]`, rect.left + bias, rect.top);
    assert.deepEqual(
      await windows(),
      beforeWindows,
      'task drag must not change visibility or window stacking',
    );
    assert.deepEqual(await fixed(), beforeFixed, 'Start and notification area remain fixed');
    assert.deepEqual(
      await evaluate(
        "[...document.querySelectorAll('#start-menu > [data-start-app]')].map(b=>b.dataset.startApp)",
      ),
      startOrder,
    );
    assert.equal(
      await evaluate(
        "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).desktopIcons)",
      ),
      iconCells,
    );
  }
  await move(initial.at(-1), initial[0], -10);
  assert.deepEqual(await order(), [initial.at(-1), ...initial.slice(0, -1)]);
  await move(initial.at(-1), initial.at(-2), 10);
  assert.deepEqual(await order(), initial);
  await move(initial[0], initial[1], 10);
  const changed = [initial[1], initial[0], ...initial.slice(2)];
  assert.deepEqual(await order(), changed);
  const last = initial.at(-1);
  await click(`[data-window-id="${last}"].popup .msn-minimize`);
  assert.equal(
    await evaluate(`document.querySelector('.popup[data-window-id="${last}"]').hidden`),
    true,
  );
  await physicalClick(`.taskbar > button[data-window-id="${last}"]`);
  assert.equal(
    await evaluate(`document.querySelector('.popup[data-window-id="${last}"]').hidden`),
    false,
  );
  await doubleClick('[data-shortcut=bin]');
  await until(() => evaluate("!!document.querySelector('.taskbar > [data-app=bin]')"), 'new task');
  const added = await evaluate(
    "document.querySelector('.taskbar > [data-app=bin]').dataset.windowId",
  );
  assert.deepEqual(await order(), [...changed, added]);
  await click(`.popup[data-window-id="${added}"] .close-button`);
  assert.deepEqual(await order(), changed);
  await physicalClick('#windows-start');
  assert.equal(await evaluate("document.querySelector('#start-menu').hidden"), false);
  await physicalClick('#windows-start');
  await capture('taskbar-reordered.png');
  console.log(
    'Barre des tâches : réordre horizontal, clic simple, aucun changement de focus lors du drag, ajout/fermeture et éléments fixes validés.',
  );
}
async function capture(name) {
  await wait(250); // Capture settled windows, not their translucent opening animation.
  const shot = await command('Page.captureScreenshot');
  await writeFile(path.join(output, name), Buffer.from(shot.data, 'base64'));
}
async function verifyVisibleSmoke() {
  qaStep('Étape 1/5 : menu de premier lancement');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='menu'"), 'menu');
  await physicalClick('#menu-play');
  await until(
    () => evaluate("!!document.querySelector('.rules-confirm')||['desktop','playing'].includes(window.chaosDebug.snapshot().phase)"),
    'first-run rules or Windows XD desktop',
  );
  if (await evaluate("!!document.querySelector('.rules-confirm')")) {
    qaStep('Étape 2/5 : confirmation des règles par le bouton normal');
    await physicalClick('.rules-confirm');
  }
  await until(
    () => evaluate("['desktop','playing'].includes(window.chaosDebug.snapshot().phase)"),
    'Windows XD after first-run rules',
  );
  assert.equal(
    await evaluate("!!document.querySelector('.rules-layer:not([hidden])')"),
    false,
    'the first-run rules are dismissed through their normal confirmation button',
  );
  assert.equal(
    await evaluate("!!document.querySelector('#desktop')&&!document.querySelector('#desktop').hidden"),
    true,
    'the Windows XD desktop is visible after confirming the first-run rules',
  );
  qaStep('Étape 3/5 : ouverture de Poste de travail');
  await physicalClick('#desktop > .desktop-icons [data-shortcut=computer]', true);
  const explorer = '.popup-desktopapp:has(.explorer-menu)';
  await until(() => evaluate(`!!document.querySelector(${JSON.stringify(explorer)})`), 'Poste de travail');
  qaStep('Étape 4/5 : fermeture de Poste de travail');
  await physicalClick(`${explorer} .close-button`);
  await until(() => evaluate(`!document.querySelector(${JSON.stringify(explorer)})`), 'Poste de travail closed');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  qaStep('Étape 5/5 : parcours terminé sans recharger ni relancer le jeu');
}
async function verifyExplorer() {
  qaLog('Étape 2 : lancement par le bouton Jouer');
  await physicalClick('#menu-play');
  await until(
    () =>
      evaluate(
        "!!document.querySelector('.rules-confirm')||['desktop','playing'].includes(window.chaosDebug.snapshot().phase)",
      ),
    'first-run rules or Windows XD desktop',
  );
  const rulesVisible = await evaluate("!!document.querySelector('.rules-confirm')");
  if (rulesVisible) {
    qaLog('Confirmation des règles du premier lancement');
    await physicalClick('.rules-confirm');
  }
  await until(
    () => evaluate("['desktop','playing'].includes(window.chaosDebug.snapshot().phase)"),
    'desktop after first-run rules',
  );
  assert.equal(
    await evaluate("!!document.querySelector('.rules-layer:not([hidden])')"),
    false,
    'the first-run rules are dismissed through their normal confirmation button',
  );
  {
    // After confirming the real first-run screen, use a disposable save to reach
    // the post-intro desktop for the deeper Explorer checks. This is one explicit
    // renderer reload for the persistence fixture, not an application retry.
    qaLog('Rechargement unique du renderer pour installer le profil Explorer temporaire (pas de nouveau processus)');
    const story = JSON.parse(await readFile(path.join(root, 'src/config/story.json')));
    const progression = new Progression(story);
    progression.begin();
    progression.complete('arcade-1');
    progression.complete('pixelgirl-hello');
    await command('Page.enable');
    const injection = await command('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('chaos-survival-story-v1',${JSON.stringify(JSON.stringify(progression.data))});window.__explorerFixture=true`,
    });
    await command('Page.reload');
    await until(
      () =>
        evaluate("window.__explorerFixture&&window.chaosDebug?.snapshot().phase==='menu'").catch(
          () => false,
        ),
      'isolated Explorer fixture',
    );
    await command('Page.removeScriptToEvaluateOnNewDocument', {
      identifier: injection.identifier,
    });
    qaLog('Fixture Explorer prête; poursuite via le bouton Jouer');
  }
  await physicalClick('#menu-play');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='desktop'"), 'desktop');
  assert.equal(
    await evaluate("!!document.querySelector('#desktop')&&!document.querySelector('#desktop').hidden"),
    true,
    'the Windows XD desktop is displayed whether rules were new or already accepted',
  );
  assert.deepEqual(
    await evaluate(
      "['computer','folder','bin'].map(kind=>document.querySelectorAll(`#desktop > .desktop-icons [data-shortcut=${kind}]`).length)",
    ),
    [1, 1, 1],
    'the three primary Windows XD system icons are present once',
  );
  await physicalClick('#desktop > .desktop-icons [data-shortcut=computer]', true);
  const windowSelector = '.popup-desktopapp:has(.explorer-menu)';
  await until(() => evaluate(`!!document.querySelector(${JSON.stringify(windowSelector)})`), 'Poste de travail');
  const taskSelector = '.desktop-app-task[data-app=computer]';
  await physicalClick(`${windowSelector} .msn-minimize`);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(windowSelector)}).hidden`), true,
    'the active Explorer window minimizes instead of closing');
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(taskSelector)}) !== null`), true,
    'the minimized window stays on the taskbar');
  await physicalClick(taskSelector);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(windowSelector)}).hidden`), false,
    'the taskbar restores the minimized Explorer window');
  await physicalClick(taskSelector);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(windowSelector)}).hidden`), true,
    'clicking the active taskbar button minimizes the window');
  await physicalClick(taskSelector);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(windowSelector)}).hidden`), false,
    'clicking the minimized taskbar button restores the window');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${windowSelector} .explorer-toolbar-button')).map(button=>({label:button.querySelector('span')?.textContent,icon:!!button.querySelector('svg')}))`), [
    { label: 'Précédente', icon: true }, { label: 'Suivante', icon: true },
    { label: 'Remonter', icon: true }, { label: 'Rechercher', icon: true },
  ]);
  assert.equal(await evaluate(`document.querySelectorAll('${windowSelector} .explorer-folders-toggle,.explorer-view-toggle,.explorer-home,[data-explorer-menu=favorites]').length`), 0);
  assert.equal(await evaluate(`document.querySelectorAll('${windowSelector} .explorer-side-panel').length`), 1,
    'the permanent left task pane is present without an activation button');
  assert.equal(await evaluate(`document.querySelector('${windowSelector} .explorer-side-panel').textContent.includes('Tâches sur cet emplacement')`), false);
  assert.equal(await evaluate(`document.querySelector('${windowSelector} .explorer-toolbar').hidden`), false,
    'the toolbar remains visible for its Search button');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${windowSelector} .explorer-side-section')).map(section=>section.dataset.section)`),
    ['locations', 'details']);
  await click(`${windowSelector} .explorer-side-link[data-explorer-side-location=shared-profile]`);
  await until(() => evaluate(`document.querySelector('${windowSelector} .explorer-address strong').textContent.includes('All Users')`), 'shared documents link');
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('${windowSelector} .explorer-side-section')).map(section=>section.dataset.section)`),
    ['locations', 'details'], 'the side pane keeps only locations and details in folders');
  await click(`${windowSelector} .explorer-side-link[data-explorer-side-location=computer]`);
  await until(() => evaluate(`document.querySelector('${windowSelector} .explorer-address strong').textContent==='Poste de travail'`), 'My Computer link');
  const firstItem = `${windowSelector} .explorer-item`;
  await click(firstItem);
  assert.ok(await evaluate(`document.querySelector('${windowSelector} .explorer-side-section[data-section=details]').textContent.includes('Nom :')`),
    'the details section reacts to an item selection');
  await physicalRightClick(firstItem);
  assert.equal(
    await evaluate(`!!document.querySelector('${windowSelector} .explorer-context-menu:not([hidden])')`),
    true,
    'a real right-click opens the selected item context menu',
  );
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  assert.equal(await evaluate(`document.querySelector('${windowSelector} .explorer-context-menu').hidden`), true,
    'Escape closes the context menu cleanly');
  await capture('explorer-toolbar-xp.png');
  await click(`${windowSelector} [data-explorer-menu=tools]`);
  await click('.explorer-command-menu [data-command=folder-options]');
  await until(() => evaluate(`!!document.querySelector('${windowSelector} .explorer-options-dialog:not([hidden])')`), 'Options des dossiers');
  assert.equal(await evaluate(`document.querySelector('${windowSelector} [data-hide-extensions]').checked`), true);
  await capture('explorer-folder-options.png');
  await click(`${windowSelector} [data-hide-extensions]`);
  await click(`${windowSelector} [data-options-action=apply]`);
  assert.equal(await evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1')).explorerPreferences.hideKnownExtensions"), false);
  await click(`${windowSelector} [data-options-action=ok]`);
  await click(`${windowSelector} [data-explorer-menu=view]`);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.explorer-command-menu button')).some(button=>/^view-(icons|list|details|thumbnails)$/.test(button.dataset.command))"), false);
  await click('.explorer-command-menu [data-command=sort-name]');
  assert.equal(await evaluate(`document.querySelector('${windowSelector} .explorer-items').dataset.view`), 'icons');
  await click(`${windowSelector} .explorer-address strong`);
  await evaluate(`(()=>{const i=document.querySelector('${windowSelector} .explorer-address-input');i.value='C:\\\\Documents and Settings\\\\Joueur\\\\Mes documents\\\\My Games';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);
  await until(() => evaluate(`document.querySelectorAll('${windowSelector} .explorer-item strong').length>0`), 'address navigation');
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('${windowSelector} .explorer-item strong')).some(n=>n.textContent==='ChaosSurvival.exe')`));
  await click(`${windowSelector} .explorer-search-toggle`);
  assert.ok(await evaluate(`!!document.querySelector('${windowSelector} .explorer-search-panel:not([hidden])')`));
  await evaluate(`(()=>{const i=document.querySelector('${windowSelector} .explorer-search-input');i.value='ChaosSurvival';document.querySelector('${windowSelector} .explorer-search-submit').click();})()`);
  await until(() => evaluate(`document.querySelectorAll('${windowSelector} .explorer-item').length===1`), 'virtual file search');
  await capture('explorer-icons-search.png');
  await evaluate(`(()=>{const i=document.querySelector('${windowSelector} .explorer-search-input');i.value='no-such-virtual-file';document.querySelector('${windowSelector} .explorer-search-submit').click();})()`);
  assert.ok(await evaluate(`document.querySelector('${windowSelector} .explorer-empty').textContent.includes('Aucun fichier')`));
  await physicalClick(`${windowSelector} .close-button`);
  await until(
    () => evaluate(`!document.querySelector(${JSON.stringify(windowSelector)}) && !document.querySelector(${JSON.stringify(taskSelector)})`),
    'clean Explorer close',
  );
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    `OK: ${visibleExplorerOnly ? 'Electron visible' : 'Chromium'} desktop/system icons, Explorer minimize/restore/taskbar toggle, context menu, close cleanup, toolbar/menu, XP task pane, navigation, selection details, folder options, icon-only view, virtual address and search. Screenshots saved in .qa.`,
  );
}
try {
  let target;
  await until(async () => {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
        (item) => item.type === 'page' && item.url.startsWith(gameUrl),
      );
      return !!target;
    } catch {
      return false;
    }
  }, 'Electron');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data),
      request = pending.get(message.id);
    if (request) {
      clearTimeout(request.timer);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown')
      exceptions.push(message.params.exceptionDetails);
  });
  await once(socket, 'open');
  await command('Runtime.enable');
  await command('Emulation.setFocusEmulationEnabled', { enabled: true });
  await until(() => evaluate("window.chaosDebug?.snapshot().phase==='menu'"), 'menu');
  qaLog('Étape 1 : application lancée et menu principal prêt');
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.session-info,.session-dot,#session-label,#window-count').length",
    ),
    0,
  );
  if (visibleSmokeOnly) {
    await verifyVisibleSmoke();
  } else if (visiblePortraitOnly) {
    await verifyVisiblePortraitLayout();
  } else if (visibleK7DeliveryOnly) {
    await verifyVisibleK7Delivery();
  } else if (browserSecurityElectron) {
    await verifyBrowser();
  } else if (minigameOnly) {
    if (visibleExplorerOnly || explorerOnly) await verifyExplorer();
    else if (hoplaHotelOnly) await verifyHoplaHotel();
    else if (wikiOnly) await verifyWiki();
    else if (videoTubeOnly) await verifyVideoTube();
    else if (flashZoneOnly) await verifyFlashZone();
    else if (skyPageOnly) await verifySkyPage();
    else if (browserOnly) await verifyBrowser();
    else if (buddyOnly) await verifyBuddy();
    else if (newGameOnly) await verifyNewGame();
    else if (smileyDialogueOnly) await verifySmileyDialogue();
    else if (menuLayoutOnly) await verifyMenuLayout();
    else if (gridOnly) await verifyDesktopGrid();
    else if (movementOnly || stabilityOnly) await verifyArcadeMovement();
    else if (notepadOnly) await verifyNotepad();
    else if (messengerOnly || visibleMessengerOnly) {
      await verifyTypingIndicator();
      await verifyMessengerWindows();
    } else if (rulesOnly) await verifyRulesFlow();
    else if (typingOnly) await verifyTypingIndicator();
    else await verifyMiniGameLaunch();
  } else {
    await click('#menu-play');
    await until(() => evaluate("!!document.querySelector('.rules-confirm')"), 'first rules');
    await click('.rules-confirm');
    await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'niveau');
    qaLog('Étape 2 : règles confirmées, bureau Windows XD actif');
    await click('#windows-start');
    await click('#menu-messenger');
    await until(() => evaluate("!!document.querySelector('.messenger-contact-list')"), 'contacts');
    qaLog('Étape 3 : roster Messenger ouvert, assertions basées sur les règles de visibilité');
    const progressionState = await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1'))",
    );
    const expectedContacts = await visibleRosterFor(progressionState);
    const actualContacts = await evaluate(
      "[...document.querySelectorAll('.messenger-contact-row')].map(row=>({id:row.dataset.contactId,offline:row.classList.contains('offline')}))",
    );
    assert.equal(
      actualContacts.length,
      expectedContacts.length,
      'the roster contains exactly the contacts visible for the current saved narrative state',
    );
    assert.deepEqual(
      actualContacts.map((contact) => contact.id).sort(),
      expectedContacts.map((contact) => contact.id).sort(),
      'roster visibility follows contacts.json and visibleContacts narrative rules',
    );
    assert.deepEqual(
      actualContacts.filter((contact) => contact.offline).map((contact) => contact.id).sort(),
      expectedContacts.filter((contact) => !contact.online).map((contact) => contact.id).sort(),
      'offline rows match the effective connection state',
    );
    assert.equal(
      actualContacts.some((contact) => contact.id === 'pixelgirl'),
      expectedContacts.some((contact) => contact.id === 'pixelgirl'),
      'PixelGirl visibility follows her initial visibility or unlock state',
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.messenger-contact-row.offline button').length"),
      0,
    );
    await click('.messenger-contact-list details[data-group="false"] summary');
    assert.equal(
      await evaluate(
        "document.querySelector('.messenger-contact-list details[data-group=false]').open",
      ),
      false,
    );
    await click('.messenger-contact-list details[data-group="false"] summary');
    await capture('messenger-contacts-offline.png');
    await click('.msn-minimize');
    await click('[data-app=\"messenger:contacts\"]');
    assert.ok(await evaluate("!document.querySelector('.popup-narrative').hidden"));
    await click('.popup-narrative .close-button');
    assert.equal(
      await evaluate('!!document.querySelector(\'[data-app="messenger:contacts"]\')'),
      false,
    );
    for (const kind of ['computer', 'folder', 'bin']) {
      await doubleClick(`[data-shortcut=${kind}]`);
      await until(
        () => evaluate(`!!document.querySelector('.desktop-app-task[data-app=${kind}]')`),
        kind,
      );
      await doubleClick(`[data-shortcut=${kind}]`);
      assert.equal(
        await evaluate(`document.querySelectorAll('.desktop-app-task[data-app=${kind}]').length`),
        1,
      );
      if (kind === 'computer') {
        await doubleClick('.popup-desktopapp:last-of-type .explorer-item:first-child');
        assert.ok(
          await evaluate(
            "document.querySelector('.popup-desktopapp:last-of-type .explorer-address strong').textContent.startsWith('C:')",
          ),
        );
        await click('.popup-desktopapp:last-of-type .explorer-back');
      }
      if (kind === 'folder') {
        const folderId = await evaluate(
          "document.querySelector('.popup-desktopapp:last-of-type').dataset.windowId",
        );
        const homeworkFileId = await evaluate(`(() => {
          const row=[...document.querySelectorAll('.popup-desktopapp:last-of-type .explorer-item')]
            .find(item=>item.querySelector('strong')?.textContent.includes('devoir_final_v7_VRAIMENT_FINAL'));
          row?.scrollIntoView({block:'nearest'});
          return row?.dataset.fileId ?? null;
        })()`);
        assert.ok(homeworkFileId, 'the homework text file is present in Mes documents');
        await physicalClick(
          `.popup-desktopapp:last-of-type .explorer-item[data-file-id="${homeworkFileId}"]`,
          true,
        );
        assert.ok(
          await evaluate(
            "document.querySelector('.notepad-content').value.includes('Devoir pour lundi')",
          ),
        );
        await click('.file-notepad .msn-minimize');
        await evaluate(
          "[...document.querySelectorAll('.desktop-app-task')].find(task=>task.title.includes('Bloc-notes')).click()",
        );
        assert.equal(await evaluate("document.querySelector('.file-notepad').hidden"), false);
        await click('.file-notepad .close-button');
        assert.ok(
          await evaluate(
            `!!document.querySelector('[data-window-id="${folderId}"] .explorer-items')`,
          ),
        );
        await doubleClick('.popup-desktopapp:last-of-type .explorer-item:first-child');
        await doubleClick('.popup-desktopapp:last-of-type .explorer-item:first-child');
        await until(
          () => evaluate("document.querySelector('.picture-content')?.naturalWidth>0"),
          'image',
        );
        await capture('desktop-picture-viewer.png');
        await click('.file-image .close-button');
        await click('.popup-desktopapp:last-of-type .explorer-back');
      }
    }

    assert.equal(await evaluate("document.querySelectorAll('.popup-desktopapp').length"), 3);
    assert.ok(
      await evaluate(
        "document.querySelector('.popup-desktopapp:last-of-type .explorer-empty').textContent.includes('vide')",
      ),
    );
    await capture('desktop-explorer.png');
    await click('.popup-desktopapp:last-of-type .msn-minimize');
    assert.ok(await evaluate("document.querySelector('.popup-desktopapp:last-of-type').hidden"));
    await click('.desktop-app-task[data-app=bin]');
    assert.equal(
      await evaluate("document.querySelector('.popup-desktopapp:last-of-type').hidden"),
      false,
    );
    await click('.popup-desktopapp:last-of-type .close-button');
    assert.equal(
      await evaluate("!!document.querySelector('.desktop-app-task[data-app=bin]')"),
      false,
    );
    await click('#windows-start');
    await click('#start-menu-main');
    assert.equal(await evaluate("document.querySelectorAll('.desktop-app-task').length"), 0);

    const story = JSON.parse(await readFile(path.join(root, 'src/config/story.json')));
    const intro = JSON.parse(await readFile(path.join(root, 'src/dialogues/pixelgirl-intro.json')));
    const progression = new Progression(story);
    progression.begin();
    progression.complete('arcade-1');
    const session = new DialogueSession(intro, progression);
    while (session.nextMessage()) session.deliver();
    session.offerChoices();
    new ConversationThread('pixelgirl', progression, () => [intro]).sync();
    await evaluate(
      `localStorage.setItem('chaos-survival-story-v1',${JSON.stringify(JSON.stringify(progression.data))});window.__uiReload=true`,
    );
    await command('Page.reload');
    await until(
      () =>
        evaluate("window.__uiReload!==true&&window.chaosDebug?.snapshot().phase==='menu'").catch(
          () => false,
        ),
      'save fixture',
    );
    await click('#menu-play');
    await until(() => evaluate("!!document.querySelector('[data-choice-id=greeting-1]')"), 'intro');
    assert.equal(await evaluate("!!document.querySelector('#pause-messages')"), false);
    await click('#windows-start');
    await click('#menu-messenger');
    assert.equal(
      await evaluate("document.querySelectorAll('[data-contact-id=pixelgirl]').length"),
      1,
    );
    await command('Emulation.setDeviceMetricsOverride', {
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await capture('messenger-contacts-online.png');
    await doubleClick('[data-contact-id=pixelgirl]');
    assert.equal(await evaluate("document.querySelectorAll('.dialogue-choice').length"), 3);
    await click('[data-messenger-contact=pixelgirl] .close-button');
    await doubleClick('[data-shortcut=arcade]');
    await until(
      () =>
        evaluate("window.chaosDebug.snapshot().phase==='playing'"),
      'level one replay launch',
    );
    await until(
      () =>
        evaluate(
          "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).replayReactions.at(-1)?.ready===true",
        ),
      'replay reaction becomes ready during gameplay',
      10000,
    );
    assert.equal(
      await evaluate(
        "!!JSON.parse(localStorage.getItem('chaos-survival-story-v1')).conversations.pixelgirl.history.find(m=>m.text==='et bah !!!')",
      ),
      false,
      'the pending replay waits until Windows XD returns to the desktop',
    );
    await until(
      () => evaluate("window.chaosDebug.snapshot().phase==='ended'"),
      'replay level finishes',
      60000,
    );
    await click('#dialog-secondary');
    await until(
      () => evaluate("window.chaosDebug.snapshot().phase==='desktop'"),
      'return to desktop after replay',
    );
    await until(
      () =>
        evaluate(
          "!!JSON.parse(localStorage.getItem('chaos-survival-story-v1')).conversations.pixelgirl.history.find(m=>m.text==='et bah !!!')",
        ),
      'first replay message received on desktop',
      10000,
    );
    const replayNotification = '.message-toast[data-notification-key="pixelgirl:pixelgirl"]';
    await until(
      () => evaluate(`!!document.querySelector(${JSON.stringify(replayNotification)})`),
      'replay message notification',
    );
    await physicalClick(replayNotification);
    await until(() => evaluate("!!document.querySelector('.conversation-log')"), 'MSN');
    assert.equal(
      await evaluate("document.querySelectorAll('.conversation-log .dialogue-choice').length"),
      0,
      'pending choices stay outside the received-message history',
    );
    await until(
      () => evaluate("document.querySelectorAll('.dialogue-choices .dialogue-choice').length===3"),
      'choix narratifs conserv?s apr?s le replay',
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.conversation-log .dialogue-choice').length"),
      0,
    );
    assert.equal(
      await evaluate("!!document.querySelector('[data-choice-id=replay-music]')"),
      false,
    );
    await capture('messenger-queued-choices.png');
    await evaluate("window.__closedLog=document.querySelector('.conversation-log')");
    await click('[data-messenger-contact=pixelgirl] .close-button');
    await evaluate(
      "window.__closedLog.dispatchEvent(new Event('scroll'));delete window.__closedLog",
    );
    await click('#windows-start');
    await click('#menu-messenger');
    await doubleClick('[data-contact-id=pixelgirl]');
    assert.equal(
      await evaluate("document.querySelectorAll('.dialogue-choice:not(:disabled)').length"),
      3,
    );
    assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
    qaLog('Scénario terminé : SUCCÈS');
    console.log(
      'OK : contacts, groupes, PixelGirl masquée puis disponible, fermeture/réduction, explorateurs uniques, barre des tâches, replay progressif et choix en attente.',
    );
  }
  qaLog(`Scénario terminé : SUCCÈS (${((Date.now() - scenarioStartedAt) / 1000).toFixed(1)} s)`);
} catch (error) {
  qaLog(`ÉCHEC après ${((Date.now() - scenarioStartedAt) / 1000).toFixed(1)} s : ${error?.message ?? error}`);
  qaLog(`Étape active : ${currentStep}`);
  qaLog('Arrêt du scénario; aucune nouvelle tentative automatique');
  throw error;
} finally {
  qaLog('Fermeture de l’application et nettoyage du profil temporaire');
  if (socket?.readyState === WebSocket.OPEN) await evaluate('window.close()').catch(() => {});
  socket?.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  if (child.exitCode === null) {
    await Promise.race([once(child, 'exit'), rawWait(2000)]);
    if (child.exitCode === null) child.kill();
  }
  await new Promise((resolve) =>
    browserServer ? browserServer.httpServer.close(resolve) : resolve(),
  );
  const relative = path.relative(tmpdir(), profile);
  assert.ok(
    path.basename(relative).startsWith('chaos-survival-desktop-profile-') &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative),
  );
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  qaLog(`Nettoyage terminé (${((Date.now() - scenarioStartedAt) / 1000).toFixed(1)} s)`);
}

async function physicalClick(selector, twice = false) {
  await command('Page.bringToFront');
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const rect = element.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    return {x, y, hit: element.contains(document.elementFromPoint(x, y)),
      blocker: document.elementFromPoint(x, y)?.id};
  })()`);
  assert.ok(point.hit, `Click intercepted for ${selector} by ${point.blocker}`);
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
  });
  await wait(25);
  for (let count = 1; count <= (twice ? 2 : 1); count++) {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await command('Input.dispatchMouseEvent', {
        type,
        x: point.x,
        y: point.y,
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
        clickCount: count,
      });
    }
  }
  await wait(25);
}

async function physicalRightClick(selector) {
  const point = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const rect = element.getBoundingClientRect();
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    return {x, y, hit: element.contains(document.elementFromPoint(x, y)),
      blocker: document.elementFromPoint(x, y)?.id};
  })()`);
  assert.ok(point.hit, `Right-click intercepted for ${selector} by ${point.blocker}`);
  for (const type of ['mousePressed', 'mouseReleased'])
    await command('Input.dispatchMouseEvent', {
      type,
      x: point.x,
      y: point.y,
      button: 'right',
      buttons: type === 'mousePressed' ? 2 : 0,
      clickCount: 1,
    });
}

async function verifyMenuLayout() {
  await assertMenuDesktopMatches();
  await verifyDesktopGrid();
  await click('.popup-desktopapp .close-button');
  await click('#windows-start');
  await click('#start-menu-main');
  await assertMenuDesktopMatches();
  for (const [width, height] of [
    [1280, 800],
    [800, 560],
  ]) {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wait(150);
    for (const options of [false, true]) {
      if (options) await click('#menu-options');
      const layout = await evaluate(`(() => {
        const menu=document.querySelector('#main-menu');
        return {height:menu.clientHeight, content:menu.scrollHeight, width:menu.clientWidth, contentWidth:menu.scrollWidth,
          scrollbars:getComputedStyle(menu).scrollbarWidth,
          buttons:[...menu.querySelectorAll('.menu-shell button')].filter(b=>b.getClientRects().length).map(b=>{
            const r=b.getBoundingClientRect();return {label:b.textContent.trim(),top:r.top,bottom:r.bottom};})};
      })()`);
      await capture(`menu-layout-${width}-${height}-${options ? 'options' : 'home'}.png`);
      assert.equal(layout.content, height, JSON.stringify({ width, height, options, layout }));
      assert.equal(layout.scrollbars, 'none');
      assert.equal(layout.width, width, 'no scrollbar gutter');
      assert.equal(layout.contentWidth, width, 'no horizontal overflow');
      assert.equal(layout.content, height, 'menu fits the available desktop height');
      assert.ok(
        layout.buttons.every((button) => button.top >= 0 && button.bottom <= height - 36),
        JSON.stringify(layout),
      );
      await assertMenuDesktopMatches();
      if (options) await click('#options-back');
    }
  }
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    'OK: menu mirrors default/custom/saved/resized desktop cells; home/options/continue fit reduced viewport without native scroll controls; no Electron.',
  );
}

async function verifyNewGame() {
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const initialOrder = await evaluate(
    "[...document.querySelectorAll('#start-menu > [data-start-app]')].map(b=>b.dataset.startApp)",
  );
  const initialCells = await evaluate(
    "[...document.querySelectorAll('#desktop > .desktop-icons button')].map(b=>({id:b.dataset.shortcut,left:b.style.left,top:b.style.top}))",
  );
  const story = JSON.parse(await readFile(path.join(root, 'src/config/story.json')));
  const intro = JSON.parse(await readFile(path.join(root, 'src/dialogues/pixelgirl-intro.json')));
  const game = JSON.parse(await readFile(path.join(root, 'src/minigames/smiley-catcher.json')));
  const p = new Progression(story);
  p.begin();
  p.complete('arcade-1', { score: 5000 });
  const session = new DialogueSession(intro, p);
  for (let n = 0; n < 150 && !session.state.finished; n++) {
    if (session.nextMessage()) session.deliver();
    else if (session.advance()) continue;
    else if (session.choices.length) session.choose(session.choices[0].id);
    else if (session.activeTransfer) p.finishTransfer(session.activeTransfer.key);
  }
  p.complete('pixelgirl-hello');
  p.complete('super-mega-game', { score: 2000 });
  p.data.tutorials[game.rules.id] = true;
  p.data.tutorials['arcade-1'] = true;
  p.data.flags.oldRun = true;
  p.data.contactConnections = { turbo: { status: 'pending', dueAt: Date.now() + 3000 } };
  await command('Page.enable');
  const fixture = await command('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('chaos-survival-story-v1',${JSON.stringify(JSON.stringify(p.data))});localStorage.setItem('chaos-survival-best','5000');localStorage.setItem('chaos-survival-history-v1','old archive');localStorage.setItem('chaos-sync-test','0.2');localStorage.setItem('chaos-survival-settings-v1','{"version":1,"musicVolume":0.2,"effectsVolume":0.3,"fullscreen":false}');localStorage.setItem('unrelated-app','keep');window.__resetFixture=true`,
  });
  await command('Page.reload');
  await until(
    () =>
      evaluate("window.__resetFixture&&window.chaosDebug?.snapshot().phase==='menu'").catch(
        () => false,
      ),
    'new-game fixture',
  );
  await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier });
  await click('#menu-play');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='desktop'"),
    'customized desktop',
  );
  await click('[data-messenger-contact=pixelgirl] [data-msn-action=wizz]');
  await click('[data-messenger-contact=pixelgirl] .close-button');
  await physicalDrag('#desktop > .desktop-icons [data-shortcut=bin]', 140, 644);
  await physicalDrag('#desktop > .desktop-icons [data-shortcut=computer]', 260, 124);
  const changedOrder = await verifyStartMenuOrder();
  assert.notDeepEqual(changedOrder, initialOrder);
  const names = ['devoir_final_v7_VRAIMENT_FINAL.txt', 'liens_trop_biens.txt'],
    originals = [];
  await doubleClick('#desktop > .desktop-icons [data-shortcut=folder]');
  for (const [index, name] of names.entries()) {
    await evaluate(
      `([...document.querySelectorAll('.explorer-item')].find(b=>b.querySelector('strong').textContent===${JSON.stringify(name)})).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
    );
    const editor = `[data-file-path="folder/${name}"] .notepad-content`;
    originals.push(await evaluate(`document.querySelector(${JSON.stringify(editor)}).value`));
    await evaluate(
      `(()=>{const a=document.querySelector(${JSON.stringify(editor)});a.value=${JSON.stringify('EDITED PREVIOUS RUN ' + index)};a.dispatchEvent(new Event('input',{bubbles:true}));a.focus();})()`,
    );
    await command('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 's',
      code: 'KeyS',
      modifiers: 2,
    });
    await command('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 's',
      code: 'KeyS',
      modifiers: 2,
    });
  }
  const snapshot = () => evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1'))");
  const old = await snapshot();
  assert.equal(Object.keys(old.textFiles).length, 2);
  assert.equal(old.desktopIcons['shortcut:bin'].row, 6);
  await command('Page.reload');
  await until(
    () => evaluate("window.chaosDebug?.snapshot().phase==='menu'").catch(() => false),
    'saved customization reload',
  );
  assert.deepEqual((await snapshot()).textFiles, old.textFiles);
  assert.deepEqual((await snapshot()).desktopIcons, old.desktopIcons);
  assert.deepEqual(
    await evaluate("JSON.parse(localStorage.getItem('chaos-survival-settings-v1')).startMenuOrder"),
    changedOrder,
  );
  await click('#menu-new-game');
  assert.equal(
    await evaluate("document.querySelector('.menu-confirm p').textContent"),
    'Commencer une nouvelle partie ? Toute votre progression et vos modifications seront perdues.',
  );
  assert.equal(await evaluate("document.querySelector('#menu-confirm-yes').textContent"), 'Oui');
  assert.equal(await evaluate("document.querySelector('#menu-confirm-no').textContent"), 'Non');
  const beforeCancel = await snapshot();
  await click('#menu-confirm-no');
  assert.deepEqual(await snapshot(), beforeCancel);
  for (let round = 0; round < 2; round++) {
    await click('#menu-new-game');
    await click('#menu-confirm-yes');
    await until(
      () => evaluate("window.chaosDebug.snapshot().phase==='rules'"),
      'initial tutorial after NEW GAME',
    );
    const fresh = await snapshot();
    assert.notEqual(fresh.runId, old.runId);
    assert.equal(fresh.current, 'arcade-1');
    for (const key of ['completed', 'choices', 'replayReactions', 'unlockedConversations'])
      assert.deepEqual(fresh[key], []);
    for (const key of ['flags', 'dialogues', 'files', 'results', 'tutorials'])
      assert.deepEqual(fresh[key], {});
    assert.equal(fresh.textFiles, undefined);
    assert.equal(fresh.contactConnections, undefined);
    assert.equal(fresh.level1Launches, 0);
    assert.equal(await evaluate("localStorage.getItem('chaos-survival-best')"), null);
    assert.equal(await evaluate("localStorage.getItem('chaos-survival-history-v1')"), null);
    assert.equal(await evaluate("localStorage.getItem('chaos-sync-test')"), null);
    assert.equal(await evaluate("localStorage.getItem('chaos-survival-reset-pending')"), null);
    assert.equal(await evaluate("localStorage.getItem('unrelated-app')"), 'keep');
    assert.deepEqual(
      await evaluate(
        "[...document.querySelectorAll('#desktop > .desktop-icons button')].map(b=>({id:b.dataset.shortcut,left:b.style.left,top:b.style.top}))",
      ),
      initialCells,
    );
    assert.equal(
      await evaluate(
        "document.querySelectorAll('#desktop > .desktop-icons button[aria-pressed=true], .desktop-file, .popup, .desktop-app-task, .contact-typing').length",
      ),
      0,
    );
    assert.deepEqual(
      await evaluate(
        "[...document.querySelectorAll('#start-menu > [data-start-app]')].map(b=>b.dataset.startApp)",
      ),
      initialOrder,
    );
    const preferences = await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-settings-v1'))",
    );
    assert.equal(preferences.musicVolume, 0.55);
    assert.equal(preferences.effectsVolume, 0.65);
    assert.equal(preferences.fullscreen, false);
    assert.deepEqual(preferences.startMenuOrder, []);
    assert.equal((await evaluate('window.chaosDebug.snapshot()')).audioTime, 0);
    assert.equal((await evaluate('window.chaosDebug.snapshot()')).offset, 0);
    await click('.rules-cancel');
  }
  await command('Page.reload');
  await until(
    () => evaluate("window.chaosDebug?.snapshot().phase==='menu'").catch(() => false),
    'clean restart',
  );
  await click('#menu-play');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='rules'"),
    'tutorial remains first event',
  );
  await click('.rules-confirm');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='playing'"),
    'clean first level starts normally',
  );
  await doubleClick('#desktop > .desktop-icons [data-shortcut=folder]');
  await until(
    () => evaluate("!!document.querySelector('.explorer-item')"),
    'original filesystem after reset',
  );
  for (const [index, name] of names.entries()) {
    await evaluate(
      `([...document.querySelectorAll('.explorer-item')].find(b=>b.querySelector('strong').textContent===${JSON.stringify(name)})).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-file-path="folder/${name}"] .notepad-content').value`,
      ),
      originals[index],
    );
  }
  await click('#windows-start');
  await click('#menu-messenger');
  const contacts = await evaluate(
    "['pixelgirl','turbo','luna','offline'].map(id=>{const rows=document.querySelectorAll('[data-contact-id='+id+']'); const row=rows[0];return {id,count:rows.length,name:row?.querySelector('strong').textContent,offline:row?.classList.contains('offline'),group:row?.closest('details').dataset.group};})",
  );
  assert.deepEqual(
    contacts.map((contact) => contact.name),
    ['xX_PixelGirl_Xx', 'xX_TURBO_59_Xx', '°•.LuNa.°•', '0FFLINE'],
  );
  assert.ok(
    contacts.every(
      (contact) => contact.count === 1 && contact.offline && contact.group === 'false',
    ),
  );
  const resetRosterState = await evaluate(
    "JSON.parse(localStorage.getItem('chaos-survival-story-v1'))",
  );
  const expectedOfflineRoster = (await visibleRosterFor(resetRosterState))
    .filter((contact) => !contact.online)
    .map((contact) => contact.id);
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('.messenger-contact-list details[data-group=false] [data-contact-id]')].map(row=>row.dataset.contactId)",
    ),
    expectedOfflineRoster,
  );
  assert.equal(
    await evaluate("document.querySelector('.messenger-contact-list').textContent.includes('☺')"),
    false,
  );
  for (const id of ['pixelgirl', 'luna', 'offline']) {
    await doubleClick(`[data-contact-id=${id}]`);
    assert.equal(
      await evaluate(
        `document.querySelectorAll('[data-messenger-contact=${id}] .conversation-message, [data-messenger-contact=${id}] .dialogue-choice').length`,
      ),
      0,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-messenger-contact=${id}] [data-msn-action=wizz]').disabled`,
      ),
      true,
    );
  }
  assert.deepEqual((await snapshot()).dialogues, {});
  await capture('msn-initial-offline-contacts.png');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    'OK: persisted icon moves, two edited files, Start order, MSN/Wizz and game results; Non preserves data; repeated Oui clears all game data/records/preferences and restores initial tutorial, apps and layout; unrelated storage survives; no Electron.',
  );
}

async function verifySmileyDialogue() {
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const story = JSON.parse(await readFile(path.join(root, 'src/config/story.json')));
  const intro = JSON.parse(await readFile(path.join(root, 'src/dialogues/pixelgirl-intro.json')));
  const dialogue = JSON.parse(
    await readFile(path.join(root, 'src/dialogues/pixelgirl-smiley-victory.json')),
  );
  const game = JSON.parse(await readFile(path.join(root, 'src/minigames/smiley-catcher.json')));
  const progression = new Progression(story);
  progression.begin();
  progression.complete('arcade-1');
  const session = new DialogueSession(intro, progression);
  for (let step = 0; step < 150 && !session.state.finished; step++) {
    if (session.nextMessage()) session.deliver();
    else if (session.advance()) continue;
    else if (session.choices.length) session.choose(session.choices[0].id);
    else if (session.activeTransfer) progression.finishTransfer(session.activeTransfer.key);
  }
  assert.ok(session.state.finished);
  progression.complete('pixelgirl-hello');
  progression.data.tutorials[game.rules.id] = true;
  const file = Object.values(progression.data.files).find((item) => item.launch?.game === game.id);
  await command('Page.enable');
  const fixture = await command('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('chaos-survival-story-v1',${JSON.stringify(JSON.stringify(progression.data))});window.__smileyFixture=true`,
  });
  await command('Page.reload');
  await until(
    () =>
      evaluate("window.__smileyFixture&&window.chaosDebug?.snapshot().phase==='menu'").catch(
        () => false,
      ),
    'Smiley story fixture',
  );
  await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: fixture.identifier });
  await click('#menu-play');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='desktop'"),
    'Smiley story desktop',
  );
  await physicalClick(`#desktop > .desktop-files [data-file-id="${file.id}"]`, true);
  await until(
    () => evaluate("document.querySelectorAll('.catch-smiley').length>0"),
    'real Smiley launch',
  );
  await click('.catch-smiley');
  await until(
    () => evaluate("!!document.querySelector('.flash-result:not([hidden])')"),
    'normal Smiley victory',
    40000,
  );
  assert.equal(
    await evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1')).current"),
    'pixelgirl-smiley-win',
  );
  await until(
    () =>
      evaluate(
        `JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues['${dialogue.id}']?.cursor===3`,
      ),
    'first messages received with MSN closed',
  );
  assert.equal(await evaluate("document.querySelectorAll('[data-messenger-contact]').length"), 0);
  await click('.flash-return');
  const pixel = '[data-messenger-contact=pixelgirl]';
  async function openChat() {
    await click('#windows-start');
    await click('#menu-messenger');
    await doubleClick('[data-contact-id=pixelgirl]');
    await until(
      () => evaluate(`!!document.querySelector('${pixel} .conversation-log')`),
      'PixelGirl chat',
    );
  }
  await openChat();
  assert.equal(await evaluate(`document.querySelectorAll('${pixel} .dialogue-choice').length`), 3);
  assert.ok(
    await evaluate(
      `document.querySelector('${pixel} .conversation-log').textContent.includes('AAAAAA')`,
    ),
  );
  assert.ok(
    await evaluate(
      `document.querySelector('${pixel} .conversation-log').textContent.includes('heyyyy')`,
    ),
  );
  // Accelerate only MSN's wall clock after the real game victory; use each saved deadline.
  await evaluate('window.__storyNow=Date.now();Date.now=()=>window.__storyNow');
  async function drainMessages() {
    for (let step = 0; step < 100; step++) {
      const due = await evaluate(
        `JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues['${dialogue.id}'].receiveDueAt ?? null`,
      );
      if (due === null) return;
      const before = await evaluate(
        `JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues['${dialogue.id}'].transcript.length`,
      );
      await evaluate(`window.__storyNow=${due}`);
      await until(
        () =>
          evaluate(
            `JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues['${dialogue.id}'].transcript.length>${before}`,
          ),
        'next scheduled NPC message',
      );
    }
    throw new Error('Smiley dialogue loop');
  }
  for (let question = 0; question < 10; question++) {
    await until(
      () => evaluate(`document.querySelectorAll('${pixel} .dialogue-choice').length>0`),
      'narrative answers',
    );
    const nodeId = await evaluate(
      `JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues['${dialogue.id}'].node`,
    );
    const choices = dialogue.nodes[nodeId].choices;
    assert.equal(
      await evaluate(
        `document.querySelectorAll('${pixel} .conversation-flow .dialogue-choice').length`,
      ),
      0,
    );
    assert.equal(
      await evaluate(`document.querySelectorAll('${pixel} .dialogue-choice').length`),
      choices.length,
    );
    const choice = choices[nodeId === 's6' ? 3 : question % choices.length];
    await click(`${pixel} [data-choice-id="${choice.id}"]`);
    if (question === 0) await click(`${pixel} .close-button`);
    await drainMessages();
    if (question === 0) await openChat();
  }
  await until(
    () => evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1')).current===null"),
    'conversation complete',
  );
  assert.equal(
    await evaluate(`document.querySelector('${pixel}').classList.contains('contact-away')`),
    false,
  );
  assert.ok(
    await evaluate(
      `document.querySelector('${pixel} .contact-status').textContent.includes('En ligne')`,
    ),
  );
  assert.equal(await evaluate("document.querySelectorAll('[data-contact-id=turbo]').length"), 1);
  assert.equal(await evaluate("!!document.querySelector('[data-contact-id=turbo].online')"), false);
  const due = await evaluate(
    "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).contactConnections.turbo.dueAt",
  );
  await evaluate(`window.__storyNow=${due - 1}`);
  await wait(60);
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).contactConnections.turbo.status",
    ),
    'pending',
  );
  await evaluate(`window.__storyNow=${due}`);
  await until(
    () => evaluate("!!document.querySelector('[data-contact-id=turbo].online')"),
    'Turbo connection',
  );
  assert.equal(
    await evaluate("document.querySelector('#toast').textContent.includes('xX_TURBO_59_Xx')"),
    true,
  );
  assert.equal(
    await evaluate(
      "document.querySelector('#toast').textContent.includes('est maintenant en ligne.')",
    ),
    true,
  );
  assert.equal(
    await evaluate("document.querySelectorAll('[data-messenger-contact=turbo]').length"),
    0,
  );
  const connectedAt = await evaluate(
    "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).contactConnections.turbo.connectedAt",
  );
  const firstMessageDueAt = await evaluate(
    "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).pendingConnectionMessages['turbo-first-connection'].dueAt",
  );
  assert.equal(connectedAt, due);
  assert.equal(firstMessageDueAt, connectedAt + 3000);
  await capture('pixelgirl-smiley-victory-turbo.png');
  await evaluate(`window.__storyNow=${firstMessageDueAt - 1}`);
  await wait(80);
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues['turbo-smiley-catcher']?.transcript.length ?? 0",
    ),
    0,
    'Turb0 first message stays unread until the full connection delay expires',
  );
  assert.equal(
    await evaluate("document.querySelectorAll('[data-messenger-contact=turbo]').length"),
    0,
    'no Turbo conversation window is created before the first message',
  );
  await evaluate(`window.__storyNow=${firstMessageDueAt}`);
  await until(
    () =>
      evaluate(
        "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues['turbo-smiley-catcher']?.transcript.length === 1",
      ),
    'Turb0 first message at its saved connection deadline',
  );
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues['turbo-smiley-catcher'].transcript[0].text",
    ),
    'mdrrrr noob',
  );
  assert.equal(
    await evaluate("document.querySelectorAll('[data-messenger-contact=turbo]').length"),
    1,
    'Messenger creates the background conversation only after receipt',
  );
  assert.equal(
    await evaluate("document.querySelector('[data-messenger-contact=turbo]').hidden"),
    true,
    'background receipt does not take focus',
  );
  const history = await evaluate(
    "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).conversations.pixelgirl.history)",
  );
  await command('Page.reload');
  await until(
    () => evaluate("window.chaosDebug?.snapshot().phase==='menu'").catch(() => false),
    'completed conversation restart',
  );
  await click('#menu-play');
  await openChat();
  assert.equal(
    await evaluate(
      "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).conversations.pixelgirl.history)",
    ),
    history,
  );
  assert.equal(await evaluate(`document.querySelectorAll('${pixel} .dialogue-choice').length`), 0);
  assert.ok(
    await evaluate(
      `document.querySelector('${pixel} .conversation-log').textContent.includes('bon jreviens')`,
    ),
  );
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    'OK: real Smiley victory, closed-window receipt, ten UI choices across eight sequences, background branches, online PixelGirl, delayed Turbo without auto-chat, persistent completed history; no Electron.',
  );
}

async function assertMenuDesktopMatches() {
  assert.equal(
    await evaluate(`(() => {
    const nodes=[...document.querySelectorAll('#desktop > .desktop-icons button, #desktop > .desktop-files button')];
    const copies=[...document.querySelectorAll('.menu-desktop-background .desktop-icons button, .menu-desktop-background .desktop-files button')];
    return nodes.length === copies.length && nodes.every(node=>{
      const copy=copies.find(item=>node.dataset.fileId ? item.dataset.fileId===node.dataset.fileId : item.dataset.shortcut===node.dataset.shortcut);
      if (!copy) return false;
      const a=node.getBoundingClientRect(),b=copy.getBoundingClientRect();
      return node.style.left===copy.style.left && node.style.top===copy.style.top && a.left===b.left && a.top===b.top && a.width===b.width && a.height===b.height;
    });
  })()`),
    true,
    'menu and interactive desktop have identical icon coordinates',
  );
}

async function physicalDrag(selector, left, top) {
  const start = await evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const rect = element.getBoundingClientRect();
    const image = element.querySelector('.icon').getBoundingClientRect();
    return { x: image.x + image.width / 2, y: image.y + image.height / 2, left: rect.x, top: rect.y };
  })()`);
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: start.x,
    y: start.y,
    button: 'left',
    clickCount: 1,
  });
  for (let step = 1; step <= 8; step++)
    await command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: start.x + ((left - start.left) * step) / 8,
      y: start.y + ((top - start.top) * step) / 8,
      button: 'left',
      buttons: 1,
    });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: start.x + left - start.left,
    y: start.y + top - start.top,
    button: 'left',
    clickCount: 1,
  });
}

async function verifyHoplaHotel() {
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const { project } = await import('../src/browser/sites/hopla-hotel/model.js');
  const { hoplaHotelData, hoplaHotelRooms } = await import('../src/browser/sites/hopla-hotel/index.js');
  const room = hoplaHotelData.room;
  await command('Page.enable');
  await command('Network.enable');
  const requests = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
  });
  await click('#menu-play');
  await until(() => evaluate("!!document.querySelector('.rules-confirm')"), 'first rules');
  await click('.rules-confirm');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'playing');
  await doubleClick('#desktop > .desktop-icons [data-shortcut=browser]');
  const ready = () =>
    until(
      () =>
        evaluate("document.querySelector('.browser-page')?.getAttribute('aria-busy')==='false'"),
      'hotel page ready',
    );
  const go = async (url) => {
    await evaluate(
      `document.querySelector('.browser-address input').value=${JSON.stringify(url)};document.querySelector('.browser-address').requestSubmit()`,
    );
    await ready();
  };
  const narrative = () =>
    evaluate(
      "(()=>{const s=JSON.parse(localStorage.getItem('chaos-survival-story-v1'));return JSON.stringify([s.current,s.completed,s.dialogues,s.choices,s.files]);})()",
    );
  await ready();
  const before = await narrative();
  assert.ok(
    await evaluate(
      '!!document.querySelector(\'.xd-sites [data-browser-link="http://www.hoplahotel.fr/"]\')',
    ),
  );
  for (const query of ['hopla hotel', 'hotel virtuel']) {
    await go(`xdsearch.fr/?q=${encodeURIComponent(query)}`);
    assert.ok(
      await evaluate(
        '!!document.querySelector(\'.xd-search-result [data-browser-link="http://www.hoplahotel.fr/"]\')',
      ),
    );
  }
  await go('www.hoplahotel.fr');
  assert.equal(
    await evaluate("document.querySelector('.browser-address input').value"),
    'http://www.hoplahotel.fr/',
  );
  await go('www.hoplahotel.fr');
  assert.equal(
    await evaluate("document.querySelector('.hopla-hotel h1').textContent"),
    'Bienvenue à Hopla Hotel !',
  );
  await capture('hopla-hotel-home.png');
  assert.equal(await evaluate("!!document.querySelector('.browser-page .hotel-intro')"), false);
  assert.ok(
    await evaluate(
      "!document.querySelector('.browser-page').textContent.includes('Pose tes valises')",
    ),
  );
  const browserHistory = await evaluate(
    "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).browser)",
  );
  await click('.hotel-enter');
  await until(
    () => evaluate("!!document.querySelector('.hopla-hotel-client .hotel-canvas')"),
    'desktop Hotel opens',
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.hopla-hotel-client .window-title > span').textContent",
    ),
    'Hopla Hotel',
  );
  assert.equal(
    await evaluate(
      "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).browser)",
    ),
    browserHistory,
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.browser-page .hotel-canvas').length"),
    0,
  );
  assert.ok(await evaluate("!!document.querySelector('.browser-page .hotel-enter')"));
  assert.ok(await evaluate("!!document.querySelector('.task-tab[data-app=hopla-hotel]')"));
  await until(
    () =>
      evaluate(
        "getComputedStyle(document.querySelector('.hopla-hotel-client')).transform==='none'",
      ),
    'Hotel opening animation',
  );
  assert.ok(
    await evaluate(
      `(()=>{const h=document.querySelector('.hopla-hotel-client'),b=document.querySelector('.internet-adventurer'),d=document.querySelector('.desktop').getBoundingClientRect(),t=document.querySelector('.taskbar').getBoundingClientRect(),r=h.getBoundingClientRect();const ratio=r.width*r.height/(d.width*(t.top-d.top));return ratio>=.85&&ratio<=.9&&r.left>=d.left&&r.top>=d.top&&r.right<=d.right&&r.bottom<=t.top&&r.width>b.offsetWidth&&r.height>b.offsetHeight&&Number(h.style.zIndex)>Number(b.style.zIndex);})()`,
    ),
  );
  await evaluate(
    "for(let i=0;i<5;i++)document.querySelector('.browser-page .hotel-enter').click()",
  );
  assert.equal(await evaluate("document.querySelectorAll('.hopla-hotel-client').length"), 1);
  assert.equal(
    await evaluate("document.querySelector('.hotel-current-room').textContent"),
    "Hall de l'hôtel",
  );
  // Observe the avatar's original purple shirt in the Canvas, without a production counter.
  const location = () =>
    evaluate(`(()=>{
      const c=document.querySelector('.hotel-canvas');
      const pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let left=c.width,top=c.height;
      for(let y=0;y<c.height;y++) for(let x=0;x<c.width;x++) {
        const i=(y*c.width+x)*4;
        if(pixels[i]===162&&pixels[i+1]===132&&pixels[i+2]===220) {
          left=Math.min(left,x);top=Math.min(top,y);
        }
      }
      if(left===c.width) return '';
      const a=(left+10-c.width/2)/16,b=(top+26-90)/8;
      return 'case '+(Math.round((a+b)/2)+1)+', '+(Math.round((b-a)/2)+1);
    })()`);
  const assertCleanClient = async (definition = room) => {
    assert.equal(await evaluate("document.querySelectorAll('.hotel-nickname').length"), 0);
    assert.equal(
      await evaluate("document.querySelectorAll('.hotel-room input, .hotel-room textarea').length"),
      0,
    );
    assert.ok(
      await evaluate(`(()=>{
      const c=document.querySelector('.hotel-canvas'),ctx=c.getContext('2d');
      return [[0,0],[c.width-1,0],[0,c.height-1],[c.width-1,c.height-1]].every(([x,y])=>{
        const p=ctx.getImageData(x,y,1,1).data;return p[0]===0&&p[1]===0&&p[2]===0&&p[3]===255;
      })&&getComputedStyle(document.querySelector('.hotel-stage')).backgroundColor==='rgb(0, 0, 0)'
        &&getComputedStyle(document.querySelector('.hotel-navigator')).backgroundColor==='rgb(213, 220, 225)'
        &&getComputedStyle(document.querySelector('.browser-page .hopla-hotel')).backgroundColor==='rgb(228, 238, 244)';
    })()`),
      'black render background only, in every room',
    );
    assert.equal(await evaluate("document.querySelector('.hotel-room-nav').children.length"), 3);
    assert.ok(
      await evaluate(
        `!document.querySelector('.hotel-room').textContent.includes("Retour à l'accueil")`,
      ),
    );
    assert.equal(
      await evaluate("!!document.querySelector('.hotel-room-status, .hotel-location')"),
      false,
    );
    assert.equal(
      await evaluate(
        "document.querySelector('.hotel-room').textContent.includes('Cliquez sur une case libre pour vous déplacer')",
      ),
      false,
    );
  };
  await assertCleanClient();
  assert.ok(
    await evaluate(`(()=>{
    const r=document.querySelector('.hotel-room'),v=r.querySelector('.hotel-viewport'),
      t=r.querySelector('.hotel-room-nav'),b=r.querySelector('.hotel-navigator-open'),
      rr=r.getBoundingClientRect(),vr=v.getBoundingClientRect(),tr=t.getBoundingClientRect(),br=b.getBoundingClientRect();
    return !r.querySelector('.hotel-header,h2') && getComputedStyle(v).backgroundColor==='rgb(0, 0, 0)'
      && vr.top===rr.top && vr.left===rr.left && vr.right===rr.right
      && Math.abs(vr.bottom-tr.top)<1 && tr.bottom===rr.bottom && tr.width===rr.width
      && br.left-tr.left<10 && br.bottom<=tr.bottom && getComputedStyle(t).backgroundColor==='rgb(191, 199, 205)';
  })()`),
    'full black scene and full-width compact toolbar at bottom',
  );
  const assertEarlyAmbient = async (definition) => {
    await until(
      () => evaluate("!!document.querySelector('.hotel-bubble')"),
      `${definition.id}: visible ambient speech within seven seconds without input`,
      7000,
    );
    assert.ok(
      await evaluate(`(()=>{
      const stage=document.querySelector('.hotel-stage').getBoundingClientRect();
      return [...document.querySelectorAll('.hotel-bubble')].some(b=>{
        const r=b.getBoundingClientRect(),s=getComputedStyle(b),author=b.querySelector('strong');
        return ${JSON.stringify(definition.npcs.map((n) => [n.id, `${n.name} : `]))}.some(([id,name])=>b.dataset.speaker===id&&author.textContent===name)
          && Number(s.opacity)>.95 && s.display!=='none' && s.visibility==='visible'
          && s.backgroundColor==='rgb(255, 255, 255)' && r.width>r.height
          && r.left>=stage.left && r.right<=stage.right && r.top>=stage.top && r.bottom<=stage.bottom;
      });
    })()`),
      `${definition.id}: real DOM bubble is opaque, attributed and inside the scene`,
    );
    await capture(`hopla-early-${definition.id}.png`);
  };
  await assertEarlyAmbient(room);
  const floorClick = async (col, row, offsetY = 0) => {
    const point = project(col, row, room);
    const hit = await evaluate(
      `(()=>{const c=document.querySelector('.hotel-canvas');c.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return {x:r.left+${point.x}/c.width*r.width,y:r.top+${point.y + offsetY}/c.height*r.height};})()`,
    );
    await command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      clickCount: 1,
      ...hit,
    });
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      clickCount: 1,
      ...hit,
    });
  };
  assert.ok((await location()).endsWith('case 8, 8'));
  await floorClick(8, 7);
  await until(async () => (await location()).endsWith('case 9, 8'), 'avatar moves');
  await floorClick(2, 4);
  await wait(350);
  assert.ok((await location()).endsWith('case 9, 8'));
  await floorClick(9, 7);
  await floorClick(8, 8);
  await until(async () => (await location()).endsWith('case 9, 9'), 'replace destination');
  await floorClick(...room.npcs[0].position, -25);
  assert.equal(
    await evaluate(
      "[...document.querySelectorAll('.hotel-bubble .hotel-message-text')].at(-1).textContent",
    ),
    room.npcs[0].dialogue,
  );
  assert.equal(await evaluate("!!document.querySelector('.hotel-bubble')"), true);
  await floorClick(...room.npcs[0].position, -25);
  assert.ok(
    await evaluate(`(()=>{
    const bubbles=[...document.querySelectorAll('.hotel-bubble[data-speaker="reception-xd"]')];
    return bubbles.length===2 && bubbles.every(b=>b.querySelector('strong').textContent==='ReceptionHotel : ')
      && bubbles[0].parentElement===bubbles[1].parentElement
      && bubbles[0].getBoundingClientRect().bottom<=bubbles[1].getBoundingClientRect().top;
  })()`),
    'repeated speaker appears in successive rows with author names',
  );
  await capture('hopla-hotel-hall.png');
  const assertSceneFits = async () => {
    assert.ok(
      await evaluate(
        `(()=>{const w=document.querySelector('.hopla-hotel-client .window-body').getBoundingClientRect(),c=document.querySelector('.hotel-canvas').getBoundingClientRect(),h=document.querySelector('.hopla-hotel-client').getBoundingClientRect(),d=document.querySelector('.desktop').getBoundingClientRect(),t=document.querySelector('.taskbar').getBoundingClientRect();return Math.abs(c.width/c.height-4/3)<.01&&c.left>=w.left&&c.right<=w.right&&c.top>=w.top&&c.bottom<=w.bottom&&h.left>=d.left&&h.top>=d.top&&h.right<=d.right+.5&&h.bottom<=t.top+.5&&getComputedStyle(document.querySelector('.hotel-canvas')).imageRendering==='pixelated';})()`,
      ),
    );
  };
  await assertSceneFits();
  const rect = (selector) =>
    evaluate(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height};})()`,
    );
  // Exercise the same titlebar drag and CSS resize handles as the other desktop windows.
  const drag = async (start, dx, dy) => {
    await command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      buttons: 1,
      clickCount: 1,
      ...start,
    });
    await command('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      button: 'left',
      buttons: 1,
      x: start.x + dx,
      y: start.y + dy,
    });
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      buttons: 0,
      x: start.x + dx,
      y: start.y + dy,
    });
    await wait(100);
  };
  const windowBefore = await rect('.hopla-hotel-client');
  const bar = await rect('.hopla-hotel-client .titlebar');
  await drag({ x: bar.x, y: bar.y }, 10, 10);
  const moved = await rect('.hopla-hotel-client');
  assert.ok(moved.x > windowBefore.x && moved.y > windowBefore.y);
  assert.equal(
    await evaluate("getComputedStyle(document.querySelector('.hopla-hotel-client')).resize"),
    'both',
  );
  await drag({ x: moved.x + moved.width / 2 - 8, y: moved.y + moved.height / 2 - 8 }, -150, -100);
  assert.ok((await rect('.hopla-hotel-client')).width < moved.width, 'native CSS resize handle');
  await assertSceneFits();
  await command('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(100);
  await assertSceneFits();
  await floorClick(8, 7);
  await until(
    async () => (await location()).endsWith('case 9, 8'),
    'scaled clicks after desktop shrink',
  );
  await floorClick(...room.npcs[0].position, -25);
  await evaluate(
    'window.__hotelGreetingNodes=[...document.querySelectorAll(\'.hotel-bubble[data-speaker="reception-xd"]\')]',
  );
  assert.ok(
    await evaluate(
      `(()=>{const s=document.querySelector('.hotel-stage').getBoundingClientRect(),b=[...document.querySelectorAll('.hotel-bubble[data-speaker="reception-xd"]')].at(-1).getBoundingClientRect();return b.left>=s.left&&b.right<=s.right&&b.top>=s.top&&b.bottom<=s.bottom;})()`,
    ),
  );
  await capture('hopla-hotel-small.png');
  await until(
    () => evaluate('window.__hotelGreetingNodes.every(b=>!b.isConnected)'),
    'greeting bubbles expire while ambient conversation continues',
    11000,
  );
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click('.hotel-navigator-open');
  assert.equal(await evaluate("document.querySelector('.hotel-navigator').hidden"), false);
  assert.equal(await evaluate("document.querySelectorAll('[data-hotel-room]').length"), 5);
  const panelSize = () =>
    evaluate(`(()=>{
    const p=document.querySelector('.hotel-navigator'),r=p.getBoundingClientRect(),
      room=document.querySelector('.hotel-room').getBoundingClientRect(),
      rows=[...p.querySelectorAll('.hotel-room-entry')].filter(row=>getComputedStyle(row).display!=='none'),
      last=rows.at(-1).getBoundingClientRect(),w=document.querySelector('.hopla-hotel-client').getBoundingClientRect();
    return {height:r.height,tail:r.bottom-last.bottom,scroll:p.scrollHeight>p.clientHeight,
      bounded:r.top>=room.top&&r.bottom<=room.bottom&&r.left>=room.left&&r.right<=room.right,
      window:[w.width,w.height]};
  })()`);
  const fullPanel = await panelSize();
  assert.ok(fullPanel.bounded && !fullPanel.scroll);
  assert.ok(fullPanel.tail >= 3 && fullPanel.tail <= 7, 'panel ends just after its content');
  await evaluate(
    "[...document.querySelectorAll('.hotel-room-entry')].slice(1).forEach(row=>row.style.display='none')",
  );
  const oneRoom = await panelSize();
  assert.ok(oneRoom.height < fullPanel.height, 'panel shrinks with fewer rooms');
  assert.ok(oneRoom.bounded && oneRoom.tail <= 12);
  await evaluate(
    "document.querySelectorAll('.hotel-room-entry').forEach(row=>row.style.display='')",
  );
  // Extra rows exist only in this isolated layout check, never in room data.
  await evaluate(
    `(()=>{const p=document.querySelector('.hotel-navigator'),row=p.querySelector('.hotel-room-entry');for(let i=0;i<30;i++){const clone=row.cloneNode(true);clone.dataset.layoutProbe='true';p.append(clone);}})()`,
  );
  const manyRooms = await panelSize();
  assert.ok(manyRooms.bounded && manyRooms.scroll, 'long list scrolls inside the available height');
  assert.deepEqual(manyRooms.window, fullPanel.window, 'panel never resizes the client window');
  await evaluate("document.querySelectorAll('[data-layout-probe]').forEach(row=>row.remove())");
  assert.deepEqual((await panelSize()).window, fullPanel.window);
  await capture('hopla-navigator.png');
  const panelBeforeDrag = await rect('.hotel-navigator');
  const canvasBeforeDrag = await rect('.hotel-canvas');
  const panelTitle = await rect('.hotel-navigator > header');
  await drag({ x: panelTitle.x, y: panelTitle.y }, 40, -20);
  assert.ok((await rect('.hotel-navigator')).x > panelBeforeDrag.x, 'internal panel is draggable');
  assert.deepEqual(
    await rect('.hotel-canvas'),
    canvasBeforeDrag,
    'panel does not displace the room',
  );
  const restoreSize = await evaluate(`(()=>{const w=document.querySelector('.hopla-hotel-client');
    const size=[w.style.width,w.style.height];w.style.width='320px';w.style.height='220px';return size;})()`);
  await wait(150);
  await assertSceneFits();
  assert.ok(
    (await panelSize()).bounded && (await panelSize()).scroll,
    'minimum client keeps panel bounded and scrollable',
  );
  assert.ok(
    await evaluate(
      `(()=>{const t=document.querySelector('.hotel-room-nav').getBoundingClientRect(),p=document.querySelector('.hotel-navigator').getBoundingClientRect();return p.bottom<=t.top;})()`,
    ),
    'navigator never covers toolbar',
  );
  await capture('hopla-minimum.png');
  await click('.hotel-navigator-open');
  assert.equal(await evaluate("document.querySelector('.hotel-navigator').hidden"), true);
  await click('.hotel-navigator-open');
  await evaluate(
    `(()=>{const w=document.querySelector('.hopla-hotel-client');[w.style.width,w.style.height]=${JSON.stringify(restoreSize)};})()`,
  );
  await wait(150);
  await click('.hotel-navigator-close');
  assert.equal(await evaluate("document.querySelector('.hotel-navigator').hidden"), true);
  const enterRoom = async (id) => {
    await click('.hotel-navigator-open');
    await click(`[data-hotel-room="${id}"]`);
    await ready();
    assert.equal(await evaluate("document.querySelector('.hotel-navigator').hidden"), true);
  };
  for (const destination of hoplaHotelRooms.slice(1)) {
    await floorClick(9, 8);
    await enterRoom(destination.id);
    await assertEarlyAmbient(destination);
    assert.equal(
      await evaluate("document.querySelector('.hotel-current-room').textContent"),
      destination.name,
    );
    await assertCleanClient(destination);
    assert.ok((await location()).endsWith('case 8, 8'));
    await wait(350);
    assert.ok((await location()).endsWith('case 8, 8'), 'old walking path is cancelled');
    await capture(`hopla-${destination.id}.png`);
    await floorClick(8, 7);
    await until(async () => (await location()).endsWith('case 9, 8'), `${destination.id} walks`);
    const obstacle = destination.furniture.find((item) => item.type === 'table');
    await floorClick(...obstacle.position);
    await wait(350);
    assert.ok((await location()).endsWith('case 9, 8'), `${destination.id} blocks furniture`);
    await floorClick(...destination.npcs[0].position, -25);
    assert.equal(
      await evaluate(
        `[...document.querySelectorAll('.hotel-bubble .hotel-message-text')].some(b=>b.textContent===${JSON.stringify(destination.npcs[0].dialogue)})`,
      ),
      false,
    );
  }
  for (const id of ['hall', 'cafe', 'hall']) await enterRoom(id);
  await floorClick(8, 8);
  await until(async () => (await location()).endsWith('case 9, 9'), 'client position');
  await wait(350);
  await click('.hopla-hotel-client .msn-minimize');
  assert.equal(await evaluate("document.querySelector('.hopla-hotel-client').hidden"), true);
  await click('.task-tab[data-app=hopla-hotel]');
  assert.equal(await evaluate("document.querySelector('.hopla-hotel-client').hidden"), false);
  assert.ok((await location()).endsWith('case 9, 9'), 'taskbar restoration preserves position');
  await enterRoom('cafe');
  await floorClick(7, 8);
  await until(async () => (await location()).endsWith('case 8, 9'), 'cafe position');
  await wait(350);
  await click('.hopla-hotel-client .msn-minimize');
  await evaluate("document.querySelector('.browser-page .hotel-enter').click()");
  assert.equal(await evaluate("document.querySelector('.hopla-hotel-client').hidden"), false);
  assert.ok((await location()).endsWith('case 8, 9'), 'site restoration preserves position');
  assert.equal(
    await evaluate("document.querySelector('.hotel-current-room').textContent"),
    'Café Hopla',
  );
  await click('.task-tab[data-app=browser]');
  await click('[data-browser-action=new]');
  await ready();
  await go('hoplahotel.fr');
  await click('.browser-page .hotel-enter');
  assert.equal(await evaluate("document.querySelectorAll('.hopla-hotel-client').length"), 1);
  assert.ok(
    (await location()).endsWith('case 8, 9'),
    'launching from another tab preserves the same client',
  );
  await click('.task-tab[data-app=browser]');
  await ready();
  assert.ok(await evaluate("!!document.querySelector('.browser-page .hotel-enter')"));
  await click('[data-browser-action=back]');
  await ready();
  await click('[data-browser-action=forward]');
  await ready();
  assert.ok(await evaluate("!!document.querySelector('.browser-page .hotel-enter')"));
  await click('.internet-adventurer .close-button');
  assert.ok((await location()).endsWith('case 8, 9'), 'closing browser leaves client intact');
  await click('.hopla-hotel-client .close-button');
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.hopla-hotel-client, .task-tab[data-app=hopla-hotel]').length",
    ),
    0,
  );
  await doubleClick('#desktop > .desktop-icons [data-shortcut=browser]');
  await ready();
  // Seed only this test instance's random source; timers and animation use the real clock.
  await evaluate(
    `(()=>{const original=Math.random;let seed=11;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);try{document.querySelector('.browser-page .hotel-enter').click();}finally{Math.random=original;}})()`,
  );
  assert.ok((await location()).endsWith('case 8, 8'));
  assert.equal(
    await evaluate("document.querySelector('.hotel-current-room').textContent"),
    "Hall de l'hôtel",
  );
  await capture('hopla-desktop-window.png');
  // Read visible shirt pixels, rather than adding permanent name labels or a debug API.
  const npcPositions = () =>
    evaluate(`(()=>{
    const c=document.querySelector('.hotel-canvas'),pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    return ${JSON.stringify(room.npcs.map((n) => [n.id, n.appearance?.shirt ?? '#f3bf43']))}.map(([id,color])=>{
      const rgb=color.slice(1).match(/../g).map(v=>parseInt(v,16));
      let x=0,y=0,count=0;
      for(let i=0;i<pixels.length;i+=4) if(rgb.every((v,j)=>pixels[i+j]===v)){
        x+=(i/4)%c.width;y+=Math.floor(i/4/c.width);count++;
      }
      return [id,count?Math.round(x/count):null,count?Math.round(y/count):null];
    });
  })()`);
  const initialPositions = await npcPositions();
  const receptionPosition = initialPositions.find(([id]) => id === 'reception-xd');
  let observedMotion = false,
    observedChat = false,
    overlap = false;
  await until(
    async () => {
      const positions = await npcPositions();
      observedMotion ||= JSON.stringify(positions) !== JSON.stringify(initialPositions);
      const visible = await evaluate(
        "[...document.querySelectorAll('.hotel-bubble:not([hidden])')].map(b=>[b.dataset.speaker,b.textContent])",
      );
      observedChat ||= visible.some(([id]) => id !== 'reception-xd');
      overlap ||= visible.length >= 2;
      assert.deepEqual(
        positions.find(([id]) => id === 'reception-xd'),
        receptionPosition,
      );
      assert.ok(visible.length <= 4);
      return observedMotion && observedChat && overlap && visible.length >= 2;
    },
    'autonomous visitors move and exchange messages without player input',
    90000,
  );
  await capture('hopla-social-hall.png');
  const socialState = () =>
    evaluate(
      "[...document.querySelectorAll('.hotel-bubble')].map(n=>[n.dataset.speaker,n.textContent,n.hidden,n.style.left,n.style.top])",
    );
  await click('.hopla-hotel-client .msn-minimize');
  const pausedSocial = await socialState();
  await wait(1200);
  assert.deepEqual(await socialState(), pausedSocial, 'minimized simulation has no activity');
  const immediateRestore = await evaluate(
    "(()=>{document.querySelector('.task-tab[data-app=hopla-hotel]').click();return [...document.querySelectorAll('.hotel-bubble')].map(n=>[n.dataset.speaker,n.textContent,n.hidden,n.style.left,n.style.top]);})()",
  );
  assert.deepEqual(
    immediateRestore,
    pausedSocial,
    'restoration preserves the active messages and positions',
  );
  assert.ok(
    await evaluate(
      `(()=>{const s=document.querySelector('.hotel-stage').getBoundingClientRect();return [...document.querySelectorAll('.hotel-bubble:not([hidden])')].every(b=>{const r=b.getBoundingClientRect();return r.left>=s.left&&r.right<=s.right&&r.top>=s.top&&r.bottom<=s.bottom&&getComputedStyle(b).backgroundColor==='rgb(255, 255, 255)'&&getComputedStyle(b).color==='rgb(0, 0, 0)';});})()`,
    ),
  );
  await click('.hopla-hotel-client .close-button');
  assert.ok(await evaluate("!!document.querySelector('.browser-page .hotel-enter')"));
  assert.equal(await narrative(), before);
  assert.equal(
    await evaluate(
      "(()=>{const s=JSON.parse(localStorage.getItem('chaos-survival-story-v1'));return !Object.hasOwn(s,'hopla-hotel');})()",
    ),
    false,
  );
  await doubleClick('#desktop > .desktop-icons [data-shortcut=computer]');
  assert.ok(await evaluate("!!document.querySelector('.explorer-items')"));
  await evaluate("document.querySelector('.browser-page .hotel-enter').click()");
  await click('#windows-start');
  await click('#start-menu-main');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='menu'"),
    'Hotel desktop teardown',
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.hopla-hotel-client, .task-tab[data-app=hopla-hotel]').length",
    ),
    0,
  );
  await click('#menu-new-game');
  await click('#menu-confirm-yes');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='rules'"),
    'Hotel New Game reset',
  );
  await click('.rules-confirm');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'Hotel fresh run');
  await doubleClick('#desktop > .desktop-icons [data-shortcut=browser]');
  await ready();
  await go('hoplahotel.fr');
  await click('.browser-page .hotel-enter');
  assert.equal(await evaluate("document.querySelectorAll('.hopla-hotel-client').length"), 1);
  assert.ok((await location()).endsWith('case 8, 8'), 'fresh client after New Game');
  await click('.hopla-hotel-client .close-button');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  assert.ok(
    requests.every((url) => url.startsWith(gameUrl)),
    JSON.stringify(requests),
  );
  console.log(
    'OK: single desktop Hotel window, unchanged browser homepage/history, bounded resize, five populated rooms, no permanent nicknames, reception-only click dialogue, scaled clicks/collisions/NPCs, autonomous movement/conversations and simultaneous white bubbles, frozen minimized social state/restoration, repeated room changes, close/relaunch, menu teardown/New Game, unchanged story/save and local requests; no Electron.',
  );
}

async function verifyWiki() {
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command('Page.enable');
  await command('Network.enable');
  const requests = [];
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  await click('#menu-play');
  await until(() => evaluate("!!document.querySelector('.rules-confirm')"), 'first rules');
  await click('.rules-confirm');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'playing');
  await doubleClick('#desktop > .desktop-icons [data-shortcut=browser]');
  const ready = () =>
    until(
      () =>
        evaluate("document.querySelector('.browser-page')?.getAttribute('aria-busy')==='false'"),
      'page ready',
    );
  const go = async (url) => {
    await evaluate(
      `document.querySelector('.browser-address input').value=${JSON.stringify(url)};document.querySelector('.browser-address').requestSubmit()`,
    );
    await ready();
  };
  await ready();
  const saved = JSON.parse(await evaluate("localStorage.getItem('chaos-survival-story-v1')"));
  await click('.xd-sites [data-browser-link="http://www.wiki.fr/"]');
  await ready();
  assert.equal(
    await evaluate("document.querySelector('.wiki h1').textContent"),
    'Bienvenue sur Wiki',
  );
  assert.deepEqual(
    await evaluate(
      "(()=>{const s=getComputedStyle(document.querySelector('.wiki h1'));return [s.color,s.fontStyle,s.textShadow];})()",
    ),
    ['rgb(17, 17, 17)', 'normal', 'none'],
  );
  await capture('wiki-home.png');
  await click('.wiki-sidebar [data-browser-link="http://www.wiki.fr/articles"]');
  await ready();
  const articles = await evaluate(
    "[...document.querySelectorAll('.wiki-content [data-browser-link]')].map(a=>({title:a.textContent,url:a.dataset.browserLink}))",
  );
  assert.equal(articles.length, 16);
  for (const article of articles) {
    await go('wiki.fr/articles');
    await click(`.wiki-content [data-browser-link="${article.url}"]`);
    await ready();
    assert.equal(await evaluate("document.querySelector('.wiki h1').textContent"), article.title);
    const sectionCount = await evaluate(
      "document.querySelectorAll('.wiki-article-section').length",
    );
    assert.ok(sectionCount >= 2 && sectionCount <= 6);
    assert.equal(await evaluate("document.querySelectorAll('.wiki-toc li').length"), sectionCount);
    await click('.wiki-toc li:last-child a');
    assert.ok(await evaluate("document.querySelector('.browser-page').scrollTop>0"));
    assert.equal(
      await evaluate("document.querySelector('.browser-address input').value"),
      article.url,
    );
    await go(`xdsearch.fr/?q=${encodeURIComponent(article.title)}`);
    assert.ok(
      await evaluate(
        `!!document.querySelector('.xd-search-result [data-browser-link="${article.url}"]')`,
      ),
    );
  }
  await go('wiki.fr/article/internet');
  await click('.wiki-content [data-browser-link="http://www.wiki.fr/article/blog"]');
  await ready();
  assert.equal(await evaluate("document.querySelector('.wiki h1').textContent"), 'Blog');
  await click('[data-browser-action=back]');
  await ready();
  assert.equal(await evaluate("document.querySelector('.wiki h1').textContent"), 'Internet');
  await click('[data-browser-action=forward]');
  await ready();
  assert.equal(await evaluate("document.querySelector('.wiki h1').textContent"), 'Blog');
  await evaluate(
    "document.querySelector('.wiki-search input').value='MUSIQUE ELECTRONIQUE';document.querySelector('.wiki-search').requestSubmit()",
  );
  await ready();
  await click(
    '.wiki-content [data-browser-link="http://www.wiki.fr/article/musique-electronique"]',
  );
  await ready();
  assert.equal(
    await evaluate("document.querySelector('.wiki h1').textContent"),
    'Musique électronique',
  );
  await click('.wiki-sidebar .wiki-random');
  await ready();
  assert.ok(
    articles
      .map((article) => article.url)
      .includes(await evaluate("document.querySelector('.browser-address input').value")),
  );
  assert.ok(
    articles
      .map((article) => article.title)
      .includes(await evaluate("document.querySelector('.wiki h1').textContent")),
  );
  for (const query of [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///C:/Windows/',
    '../../../../',
  ]) {
    await evaluate(
      `document.querySelector('.wiki-search input').value=${JSON.stringify(query)};document.querySelector('.wiki-search').requestSubmit()`,
    );
    await ready();
    assert.ok(await evaluate("!!document.querySelector('.wiki-empty')"));
    assert.equal(await evaluate("document.querySelector('.wiki-search input').value"), query);
    assert.equal(
      await evaluate("document.querySelectorAll('.wiki script,.wiki iframe,.wiki webview').length"),
      0,
    );
  }
  await go('wiki.fr/article/primates');
  await capture('wiki-article.png');
  await evaluate("document.querySelector('.internet-adventurer').style.width='500px'");
  await capture('wiki-narrow.png');
  assert.ok(
    await evaluate(
      "(()=>{const p=document.querySelector('.browser-page'),r=p.getBoundingClientRect();return p.scrollWidth<=p.clientWidth+1&&[...document.querySelectorAll('.wiki-infobox,.wiki-toc')].every(n=>{const b=n.getBoundingClientRect();return b.right<=r.right&&b.left>=r.left;});})()",
    ),
  );
  const after = JSON.parse(await evaluate("localStorage.getItem('chaos-survival-story-v1')"));
  delete saved.browser;
  delete after.browser;
  assert.deepEqual(after, saved);
  assert.ok(
    requests.every(
      (url) => !/^https?:/.test(url) || new URL(url).origin === new URL(gameUrl).origin,
    ),
  );
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    'OK: Wiki home/catalogue, 16 articles and search indexing, TOCs, internal links, back/forward, title search, random article, hostile searches, resize, unchanged narrative/save and local requests; no Electron.',
  );
}

async function verifyVideoTube() {
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command('Page.enable');
  await command('Network.enable');
  const requests = [];
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  await click('#menu-play');
  await until(() => evaluate("!!document.querySelector('.rules-confirm')"), 'first rules');
  await click('.rules-confirm');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'playing');
  await doubleClick('#desktop > .desktop-icons [data-shortcut=browser]');
  const ready = () =>
    until(
      () =>
        evaluate("document.querySelector('.browser-page')?.getAttribute('aria-busy')==='false'"),
      'page ready',
    );
  const go = async (url) => {
    await evaluate(
      `document.querySelector('.browser-address input').value=${JSON.stringify(url)};document.querySelector('.browser-address').requestSubmit()`,
    );
    await ready();
  };
  await ready();
  const saved = await evaluate("localStorage.getItem('chaos-survival-story-v1')");
  assert.ok(
    await evaluate(
      '!!document.querySelector(\'.xd-sites [data-browser-link="http://www.videotube.fr/"]\')',
    ),
  );
  await click('.xd-sites [data-browser-link="http://www.videotube.fr/"]');
  await ready();
  assert.equal(await evaluate("document.querySelectorAll('.videotube-card').length"), 7);
  await evaluate(
    "Promise.all([...document.querySelectorAll('.videotube img')].map(img=>img.decode()))",
  );
  await capture('videotube-home.png');
  const ids = [
    'numa-numa',
    'chocolate-rain',
    'leave-britney-alone',
    'dramatic-chipmunk',
    'laughing-baby',
    'sneezing-baby-panda',
    'what-what',
  ];
  const titles = [
    'Numa Numa Dance',
    'Chocolate Rain',
    'LEAVE BRITNEY ALONE!',
    'Dramatic Chipmunk',
    'Laughing Baby',
    'Sneezing Baby Panda',
    'What What (In the Butt)',
  ];
  await evaluate(
    'window.__videoIds=[];window.chaosVideo={open:async id=>{window.__videoIds.push(id);return {ok:true};}}',
  );
  for (let index = 0; index < ids.length; index++) {
    if (index) await go('videotube.fr');
    await click(
      `.videotube-card [data-browser-link="http://www.videotube.fr/watch/${ids[index]}"]`,
    );
    await ready();
    assert.equal(
      await evaluate("document.querySelector('.videotube h2').textContent"),
      titles[index],
    );
    assert.equal(
      await evaluate("document.querySelectorAll('.videotube-comments article').length"),
      3,
    );
    assert.ok(
      await evaluate(
        "/Note : [1-5] sur 5/.test(document.querySelector('.videotube-stars').getAttribute('aria-label'))",
      ),
    );
    assert.equal(await evaluate("document.querySelector('.videotube-watch').disabled"), false);
    await evaluate("document.querySelector('.videotube-player img').decode()");
    {
      const address = await evaluate("document.querySelector('.browser-address input').value");
      const tabs = await evaluate("document.querySelectorAll('.browser-tab').length");
      await click('.videotube-watch');
      await until(
        () =>
          evaluate(
            "document.querySelector('.videotube-open-status').textContent.startsWith('Vidéo ouverte')",
          ),
        'external button response',
      );
      assert.equal(
        await evaluate("document.querySelector('.browser-address input').value"),
        address,
      );
      assert.equal(await evaluate("document.querySelectorAll('.browser-tab').length"), tabs);
    }
    if (index === 1) {
      await capture('videotube-watch.png');
      await evaluate('window.chaosVideo.open=async()=>{throw new Error("Simulated failure")};');
      await click('.videotube-watch');
      await until(
        () =>
          evaluate(
            "document.querySelector('.videotube-open-status').textContent.startsWith('Impossible')",
          ),
        'external error',
      );
      await evaluate(
        'window.chaosVideo.open=async id=>{window.__videoIds.push(id);return {ok:true};};',
      );
      await evaluate("document.querySelector('.internet-adventurer').style.width='500px'");
      assert.ok(
        await evaluate(
          "(()=>{const r=document.querySelector('.videotube-player').getBoundingClientRect(),p=document.querySelector('.browser-page').getBoundingClientRect();return r.left>=p.left&&r.right<=p.right;})()",
        ),
      );
    }
    await go(`xdsearch.fr/?q=${encodeURIComponent(titles[index])}`);
    assert.ok(
      await evaluate(
        `!!document.querySelector('.xd-search-result [data-browser-link="http://www.videotube.fr/watch/${ids[index]}"]')`,
      ),
    );
  }
  assert.deepEqual(await evaluate('window.__videoIds'), ids);
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///C:/Windows/',
  ]) {
    await go(url);
    assert.ok(await evaluate("!!document.querySelector('.browser-error')"));
  }
  const before = JSON.parse(saved),
    after = JSON.parse(await evaluate("localStorage.getItem('chaos-survival-story-v1')"));
  delete before.browser;
  delete after.browser;
  assert.deepEqual(after, before);
  assert.ok(
    requests.every(
      (url) => !/^https?:/.test(url) || new URL(url).origin === new URL(gameUrl).origin,
    ),
  );
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    'OK: VideoTube 7 cards/pages/images/comments/ratings, internal links/search, external-ID bridge simulated with success/failure, all watch buttons enabled, resize, hostile URLs, unchanged narrative/save and local requests; no Electron or real browser opened.',
  );
}

async function verifyFlashZone() {
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await command('Page.enable');
  await command('Network.enable');
  const requests = [];
  socket.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  await click('#menu-play');
  await until(() => evaluate("!!document.querySelector('.rules-confirm')"), 'first rules');
  await click('.rules-confirm');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'playing');
  await doubleClick('#desktop > .desktop-icons [data-shortcut=browser]');
  const ready = () =>
    until(
      () =>
        evaluate("document.querySelector('.browser-page')?.getAttribute('aria-busy')==='false'"),
      'page ready',
    );
  const go = async (url) => {
    await evaluate(
      `document.querySelector('.browser-address input').value=${JSON.stringify(url)};document.querySelector('.browser-address').requestSubmit()`,
    );
    await ready();
  };
  await ready();
  const narrative = await evaluate(
    "JSON.stringify([JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues,JSON.parse(localStorage.getItem('chaos-survival-story-v1')).completed])",
  );
  assert.ok(
    await evaluate(
      '!!document.querySelector(\'.xd-sites [data-browser-link="http://www.flashzone.fr/"]\')',
    ),
  );
  await click('.xd-sites [data-browser-link="http://www.flashzone.fr/"]');
  await ready();
  assert.equal(await evaluate("document.querySelectorAll('.flashzone-card').length"), 3);
  await evaluate(
    "Promise.all([...document.querySelectorAll('.flashzone img')].map(img=>img.decode()))",
  );
  await capture('flashzone-home.png');
  await click('.flashzone-card [data-browser-link="http://www.flashzone.fr/jeux/bubble-pop"]');
  await ready();
  await evaluate(
    'window.__bubbleShift=0;window.__bubbleRaf=requestAnimationFrame;window.__bubbleNow=performance.now.bind(performance);window.requestAnimationFrame=fn=>window.__bubbleRaf(t=>fn(t+window.__bubbleShift));performance.now=()=>window.__bubbleNow()+window.__bubbleShift',
  );
  await click('.bubble-play');
  await until(() => evaluate("document.querySelectorAll('.bubble-target').length>0"), 'bubbles');
  await click('.bubble-target');
  assert.equal(
    await evaluate("document.querySelector('.bubble-stats strong').textContent"),
    'Score : 10',
  );
  await capture('flashzone-bubble-playing.png');
  await evaluate('window.__bubbleShift+=30001');
  await until(
    () => evaluate("!document.querySelector('.bubble-result').hidden"),
    '30 second result',
  );
  assert.equal(
    await evaluate("document.querySelector('.bubble-result strong').textContent"),
    'Score final : 10',
  );
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).flashzone.bestScores['bubble-pop']",
    ),
    10,
  );
  await capture('flashzone-bubble-result.png');
  await click('.bubble-replay');
  assert.equal(
    await evaluate("document.querySelector('.bubble-stats strong').textContent"),
    'Score : 0',
  );
  await click('[data-browser-action=new]');
  await ready();
  await go('flashzone.fr/jeux/bubble-pop');
  assert.equal(await evaluate("document.querySelector('.bubble-intro').hidden"), false);
  await click('.bubble-play');
  await click('.bubble-target');
  await click('.internet-adventurer .close-button');
  await evaluate('window.__bubbleShift+=60000');
  await click('#windows-start');
  await click('#menu-browser');
  await ready();
  assert.equal(await evaluate("document.querySelector('.bubble-intro').hidden"), false);
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).flashzone.bestScores['bubble-pop']",
    ),
    10,
  );
  await go('xdsearch.fr/?q=bubble%20pop');
  assert.ok(
    await evaluate(
      '!!document.querySelector(\'.xd-search-result [data-browser-link="http://www.flashzone.fr/jeux/bubble-pop"]\')',
    ),
  );
  await evaluate(
    "document.dispatchEvent(new CustomEvent('windows-xd:open-url',{detail:{url:'http://www.flashzone.fr/jeux/bubble-pop'}}))",
  );
  await ready();
  assert.ok(await evaluate("!!document.querySelector('.bubble-play')"));
  await evaluate('window.__bubbleShift=0');
  await go('flashzone.fr/jeux/avoid-the-squares');
  assert.equal(await evaluate("document.querySelector('.squares-intro').hidden"), false);
  await click('.squares-play');
  assert.equal(await evaluate("document.querySelectorAll('.squares-enemy').length"), 2);
  await evaluate(
    "(()=>{const a=document.querySelector('.squares-arena'),r=a.getBoundingClientRect();a.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+100,clientY:r.top+100,bubbles:true}));})()",
  );
  const startPosition = await evaluate("document.querySelector('.squares-player').style.left");
  assert.ok(parseFloat(startPosition) > 0 && parseFloat(startPosition) < 40);
  await capture('flashzone-squares-playing.png');
  await wait(1100);
  await evaluate(
    "(()=>{const a=document.querySelector('.squares-arena'),e=document.querySelector('.squares-enemy').getBoundingClientRect();a.dispatchEvent(new PointerEvent('pointermove',{clientX:e.left+e.width/2,clientY:e.top+e.height/2,bubbles:true}));})()",
  );
  await until(
    () => evaluate("!document.querySelector('.squares-result').hidden"),
    'squares collision',
  );
  const squaresBest = await evaluate(
    "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).flashzoneBestTimes['avoid-the-squares']",
  );
  assert.ok(squaresBest >= 750);
  await capture('flashzone-squares-result.png');
  await click('.squares-replay');
  assert.equal(await evaluate("document.querySelector('.squares-result').hidden"), true);
  await evaluate("document.querySelector('.internet-adventurer').style.width='500px'");
  const squareSize = await evaluate(
    "(()=>{const r=document.querySelector('.squares-player').getBoundingClientRect();return {w:r.width,h:r.height};})()",
  );
  assert.ok(Math.abs(squareSize.w - squareSize.h) < 0.2);
  await click('[data-browser-action=new]');
  await ready();
  await go('flashzone.fr/jeux/avoid-the-squares');
  assert.equal(await evaluate("document.querySelector('.squares-intro').hidden"), false);
  await go('xdsearch.fr/?q=avoid%20the%20squares');
  assert.ok(
    await evaluate(
      '!!document.querySelector(\'.xd-search-result [data-browser-link="http://www.flashzone.fr/jeux/avoid-the-squares"]\')',
    ),
  );
  assert.equal(
    await evaluate(
      "JSON.stringify([JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues,JSON.parse(localStorage.getItem('chaos-survival-story-v1')).completed])",
    ),
    narrative,
  );
  await go('flashzone.fr');
  await click('.flashzone-card [data-browser-link="http://www.flashzone.fr/jeux/pixel-runner"]');
  await ready();
  await click('.runner-play');
  assert.ok(await evaluate("document.activeElement===document.querySelector('.runner-canvas')"));
  for (const code of ['Space', 'ArrowUp']) {
    assert.equal(
      await evaluate(
        `(()=>{const c=document.querySelector('.runner-canvas');const e=new KeyboardEvent('keydown',{code:'${code}',cancelable:true});c.dispatchEvent(e);return e.defaultPrevented;})()`,
      ),
      true,
    );
  }
  assert.equal(
    await evaluate(
      "(()=>{const i=document.querySelector('.browser-address input');i.focus();const e=new KeyboardEvent('keydown',{code:'Space',cancelable:true});i.dispatchEvent(e);return e.defaultPrevented;})()",
    ),
    false,
  );
  await wait(250);
  const runnerTab = await evaluate(
    "document.querySelector('.browser-tab[aria-selected=true] [data-browser-action=select]').dataset.tabId",
  );
  await evaluate("window.__runnerRoot=document.querySelector('.pixel-runner')");
  await click('[data-browser-action=new]');
  const pausedDistance = await evaluate(
    "window.__runnerRoot.querySelector('.runner-distance').textContent",
  );
  await ready();
  assert.equal(
    await evaluate("window.__runnerRoot.querySelector('.runner-distance').textContent"),
    pausedDistance,
  );
  await go('flashzone.fr/jeux/pixel-runner');
  assert.equal(await evaluate("document.querySelector('.runner-intro').hidden"), false);
  const otherRunnerTab = await evaluate(
    "document.querySelector('.browser-tab[aria-selected=true] [data-browser-action=select]').dataset.tabId",
  );
  await click(`.browser-tab [data-browser-action=select][data-tab-id="${runnerTab}"]`);
  await ready();
  assert.equal(await evaluate("document.querySelector('.runner-intro').hidden"), true);
  await click(`.browser-tab [data-browser-action=close][data-tab-id="${otherRunnerTab}"]`);
  await wait(250);
  assert.ok(await evaluate("document.querySelector('.pixel-runner')===window.__runnerRoot"));
  const resumedDistance = await evaluate("document.querySelector('.runner-distance').textContent");
  assert.notEqual(resumedDistance, 'Distance : 0 m');
  await capture('flashzone-runner-playing.png');
  await until(
    () => evaluate("!document.querySelector('.runner-result').hidden"),
    'runner collision',
    15000,
  );
  const runnerBest = await evaluate(
    "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).flashzoneBestDistances['pixel-runner']",
  );
  assert.ok(runnerBest > 400);
  await capture('flashzone-runner-result.png');
  await click('.runner-replay');
  assert.equal(await evaluate("document.querySelector('.runner-result').hidden"), true);
  await go('xdsearch.fr/?q=pixel%20runner');
  assert.ok(
    await evaluate(
      '!!document.querySelector(\'.xd-search-result [data-browser-link="http://www.flashzone.fr/jeux/pixel-runner"]\')',
    ),
  );
  await command('Page.reload');
  await until(() => evaluate("window.chaosDebug?.snapshot().phase==='menu'"), 'restart');
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).flashzone.bestScores['bubble-pop']",
    ),
    10,
  );
  await click('#menu-new-game');
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).flashzoneBestDistances['pixel-runner']",
    ),
    runnerBest,
  );
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).flashzoneBestTimes['avoid-the-squares']",
    ),
    squaresBest,
  );
  await click('#menu-confirm-yes');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='rules'"), 'New Game');
  assert.equal(
    await evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1')).flashzone"),
    undefined,
  );
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).flashzoneBestTimes",
    ),
    undefined,
  );
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).flashzoneBestDistances",
    ),
    undefined,
  );
  assert.ok(
    requests.every(
      (url) => !/^https?:/.test(url) || new URL(url).origin === new URL(gameUrl).origin,
    ),
  );
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    'OK: FlashZone three games, keyboard/pointer controls, collision/replay/resize, Runner tab suspension/resume, browser close/reopen, search, independent records/restart/New Game, unchanged narrative and local requests; no Electron.',
  );
}

async function verifySkyPage() {
  await command('Page.enable');
  await command('Network.enable');
  const requests = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
  });
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await click('#menu-play');
  await until(() => evaluate("!!document.querySelector('.rules-confirm')"), 'first rules');
  await click('.rules-confirm');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'first level');
  await doubleClick('#desktop > .desktop-icons [data-shortcut=browser]');
  const ready = () =>
    until(
      () =>
        evaluate(
          "document.querySelector('.internet-adventurer .browser-page')?.getAttribute('aria-busy')==='false'",
        ),
      'SkyPage ready',
    );
  const go = async (address) => {
    await evaluate(
      `document.querySelector('.browser-address input').value=${JSON.stringify(address)};document.querySelector('.browser-address').requestSubmit()`,
    );
    await ready();
  };
  const page = () => evaluate("document.querySelector('.browser-page').textContent");
  const openLink = async (url) => {
    await evaluate(
      `([...document.querySelectorAll('.skypage [data-browser-link]')].find(link=>link.dataset.browserLink===${JSON.stringify(url)})).click()`,
    );
    await ready();
  };
  await ready();
  const narrative = await evaluate(
    "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues)",
  );
  assert.deepEqual(
    await evaluate(
      "[...document.querySelectorAll('.xd-sites a')].map(link=>link.dataset.browserLink)",
    ),
    [
      'http://www.xdsearch.fr/',
      'http://www.skypage.fr/',
      'http://www.forumjeu.fr/',
      'http://www.flashzone.fr/',
      'http://www.videotube.fr/',
      'http://www.wiki.fr/',
      'http://www.hoplahotel.fr/',
    ],
  );
  await capture('xd-search-sites.png');
  await click('.xd-sites [data-browser-link="http://www.skypage.fr/"]');
  await ready();
  assert.ok((await page()).includes('Bienvenue sur SkyPage !'));
  assert.deepEqual(
    await evaluate("[...document.querySelectorAll('.sky-friends a')].map(link=>link.textContent)"),
    ['xX_PixelGirl_Xx', '°•.LuNa.°•', 'Sk8er_du_93', 'Oo_bubble-princess_oO'],
  );
  assert.equal(await evaluate("document.querySelectorAll('.sky-discovery').length"), 0);
  assert.ok((await page()).includes('Aucun blog visité récemment.'));
  assert.equal(await evaluate("document.querySelector('.sky-nav').textContent"), 'Accueil');
  await capture('skypage-home.png');
  await openLink('http://www.skypage.fr/pixelgirl');
  assert.equal(await evaluate("document.querySelectorAll('.sky-post').length"), 6);
  assert.ok((await page()).includes('Bring Me to Life'));
  assert.ok(await evaluate("document.querySelectorAll('.sky-comment').length>0"));
  await evaluate(
    "Promise.all([...document.querySelectorAll('.skypage img')].map(image=>image.decode()))",
  );
  await capture('skypage-pixelgirl.png');
  await openLink('http://www.skypage.fr/pixelgirl?article=paint');
  assert.equal(await evaluate("document.querySelectorAll('.sky-post').length"), 1);
  await evaluate("document.querySelector('.sky-illustration').decode()");
  assert.equal(await evaluate("document.querySelectorAll('.sky-comment').length"), 2);
  await capture('skypage-pixelgirl-paint.png');
  await click('[data-browser-action=back]');
  await ready();
  assert.equal(await evaluate("document.querySelectorAll('.sky-post').length"), 6);
  await click('[data-browser-action=forward]');
  await ready();
  assert.equal(await evaluate("document.querySelectorAll('.sky-post').length"), 1);
  await openLink('http://www.skypage.fr/');
  await go('skypage.fr/luna');
  assert.equal(await evaluate("document.querySelectorAll('.sky-post').length"), 5);
  assert.ok((await page()).includes('somewhere only we know'));
  await evaluate(
    "Promise.all([...document.querySelectorAll('.skypage img')].map(image=>image.decode()))",
  );
  await capture('skypage-luna.png');
  await openLink('http://www.skypage.fr/luna?article=photos');
  await evaluate("document.querySelector('.sky-illustration').decode()");
  await capture('skypage-luna-night.png');
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.skypage input,.skypage textarea,.skypage button').length",
    ),
    0,
  );
  for (const [query, address] of [
    ['pixelgirl', 'http://www.skypage.fr/pixelgirl'],
    ['luna', 'http://www.skypage.fr/luna'],
    ['evanescence', 'http://www.skypage.fr/pixelgirl'],
    ['kickflip', 'http://www.skypage.fr/sk8er_du_93'],
    ['coque téléphone', 'http://www.skypage.fr/oo_bubble-princess_oo'],
  ]) {
    await go('xdsearch.fr');
    await evaluate(
      `document.querySelector('.xd-search-form input').value=${JSON.stringify(query)};document.querySelector('.xd-search-form').requestSubmit()`,
    );
    await ready();
    assert.ok(
      await evaluate(
        `!!document.querySelector('.xd-search-result [data-browser-link="${address}"]')`,
      ),
    );
    await click(`.xd-search-result [data-browser-link="${address}"]`);
    await ready();
    assert.ok(await evaluate("!!document.querySelector('.sky-blog-layout')"));
  }
  for (const [id, nickname, count] of [
    ['sk8er_du_93', 'Sk8er_du_93', 4],
    ['oo_bubble-princess_oo', 'Oo_bubble-princess_oO', 6],
    ['cartouchegrise', 'CartoucheGrise', 5],
    ['grillepain_92', 'GrillePain_92', 4],
    ['disquette44', 'Disquette44', 6],
    ['padsansfil', 'PadSansFil', 4],
  ]) {
    await go(`skypage.fr/${id}`);
    assert.equal(
      await evaluate("document.querySelector('.sky-blog-title h2').textContent"),
      nickname,
    );
    assert.equal(await evaluate("document.querySelectorAll('.sky-post').length"), count);
    await evaluate(
      "Promise.all([...document.querySelectorAll('.skypage img')].map(image=>image.decode()))",
    );
    await evaluate("document.querySelector('.sky-illustration')?.scrollIntoView({block:'center'})");
    await capture(`skypage-${id}.png`);
    await go('skypage.fr');
    assert.equal(
      await evaluate("document.querySelector('.sky-discovery a').textContent"),
      nickname,
    );
  }
  await click('[data-browser-action=new]');
  await ready();
  await go('skypage.fr/luna');
  assert.equal(await evaluate("document.querySelectorAll('.browser-tab').length"), 2);
  await go('skypage.fr/turbo');
  assert.ok((await page()).includes('Erreur 404'));
  await go('skypage.fr/luna');
  await evaluate(
    "document.querySelector('.internet-adventurer').style.width='440px';document.querySelector('.internet-adventurer').style.height='380px'",
  );
  await wait(100);
  const fits = await evaluate(
    "(()=>{const page=document.querySelector('.browser-page');return {width:page.clientWidth,content:page.scrollWidth};})()",
  );
  assert.equal(fits.width, fits.content);
  await capture('skypage-luna-small.png');
  assert.equal(
    await evaluate(
      "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues)",
    ),
    narrative,
  );
  const tabs = await evaluate(
    "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).browser.tabs)",
  );
  await command('Page.reload');
  await until(() => evaluate("window.chaosDebug?.snapshot().phase==='menu'"), 'SkyPage restart');
  await click('#menu-play');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'resumed game');
  await click('#windows-start');
  await click('#menu-browser');
  await ready();
  assert.ok((await page()).includes('°•.LuNa.°•'));
  assert.equal(
    await evaluate(
      "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).browser.tabs)",
    ),
    tabs,
  );
  await click('#windows-start');
  await click('#start-menu-main');
  await click('#menu-new-game');
  await click('#menu-confirm-yes');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='rules'"), 'SkyPage New Game');
  await click('.rules-confirm');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'fresh game');
  await click('#windows-start');
  await click('#menu-browser');
  await ready();
  await go('skypage.fr');
  assert.equal(await evaluate("document.querySelectorAll('.sky-discovery').length"), 0);
  await go('skypage.fr/pixelgirl');
  assert.equal(await evaluate("document.querySelectorAll('.sky-post').length"), 6);
  assert.ok(
    requests.every(
      (address) => !/^https?:/.test(address) || new URL(address).origin === new URL(gameUrl).origin,
    ),
    JSON.stringify(requests),
  );
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    'OK: nine SkyPage routes from fresh game, forty posts/comments, local photos/decorations, recent visits, article links, back/forward, XD Search, tabs, small window, restart/New Game, unchanged dialogues and no external requests; no Electron.',
  );
}

async function verifyBrowser() {
  await command('Page.enable');
  await command('Network.enable');
  const requests = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
  });
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.ok(
    await evaluate("!!document.querySelector('#desktop > .desktop-icons [data-shortcut=browser]')"),
  );
  await click('#menu-play');
  await until(() => evaluate("!!document.querySelector('.rules-confirm')"), 'first rules');
  await click('.rules-confirm');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'first level');
  await doubleClick('#desktop > .desktop-icons [data-shortcut=browser]');
  const ready = () =>
    until(
      () =>
        evaluate(
          "document.querySelector('.internet-adventurer .browser-page')?.getAttribute('aria-busy')==='false'",
        ),
      'browser page ready',
    );
  const url = () => evaluate("document.querySelector('.browser-address input').value");
  const save = () =>
    evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1')).browser");
  const go = async (address) => {
    await evaluate(
      `document.querySelector('.browser-address input').value=${JSON.stringify(address)};document.querySelector('.browser-address').requestSubmit()`,
    );
    await ready();
  };
  await ready();
  assert.equal(await url(), 'http://www.xdsearch.fr/');
  assert.equal(await evaluate("document.querySelectorAll('.internet-adventurer').length"), 1);
  await capture('internet-adventurer-xd-search.png');
  await evaluate(
    "document.querySelector('.browser-address input').value='inconnu.fr';document.querySelector('.browser-address').requestSubmit();document.querySelector('.browser-address input').value='xdsearch.fr';document.querySelector('.browser-address').requestSubmit()",
  );
  await ready();
  assert.ok(await evaluate("!!document.querySelector('.xd-search-logo')"));
  for (const address of ['www.xdsearch.fr', 'xdsearch.fr', 'http://www.xdsearch.fr']) {
    await go(address);
    assert.equal(await url(), 'http://www.xdsearch.fr/');
  }
  await evaluate(
    "document.querySelector('.xd-search-form input').value='zebragalactique';document.querySelector('.xd-search-form').requestSubmit()",
  );
  await ready();
  assert.ok(
    await evaluate(
      "document.querySelector('.browser-page').textContent.includes('Aucun résultat trouvé pour « zebragalactique ».')",
    ),
  );
  assert.equal(await evaluate("document.querySelectorAll('.xd-search-result').length"), 0);
  await evaluate(
    "document.querySelector('.xd-search-form input').value='INTERNET';document.querySelector('.xd-search-form').requestSubmit()",
  );
  await ready();
  assert.ok((await evaluate("document.querySelectorAll('.xd-search-result').length")) >= 1);
  const searchHome = '.xd-search-result a[data-browser-link="http://www.xdsearch.fr/"]';
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(searchHome)}).getAttribute('href')`),
    '#',
  );
  await click(searchHome);
  await ready();
  assert.equal(await url(), 'http://www.xdsearch.fr/');
  await click('[data-browser-action=back]');
  await ready();
  assert.ok((await url()).includes('?q=INTERNET'));
  await click('[data-browser-action=forward]');
  await ready();
  assert.equal(await url(), 'http://www.xdsearch.fr/');
  await go('forumjeu.fr');
  assert.ok((await evaluate("document.querySelectorAll('.forum-categories tbody tr').length")) > 0);
  await click('.forum-categories tbody tr:first-child td:first-child a');
  await ready();
  assert.ok((await evaluate("document.querySelectorAll('.forum-topics tbody tr').length")) > 0);
  await click('.forum-topics tbody tr:first-child a');
  await ready();
  assert.ok((await evaluate("document.querySelectorAll('.forum-message').length")) > 0);
  await click('.forum-breadcrumb a');
  await ready();
  assert.equal(await url(), 'http://www.forumjeu.fr/');
  console.log(
    'OK: ForumJeu home, category, discussion messages and return link through internal navigation.',
  );
  await go('xdsearch.fr/page-inexistante');
  assert.ok(
    await evaluate("document.querySelector('.browser-error').textContent.includes('Erreur 404')"),
  );
  await go('site-inconnu.fr');
  assert.ok(
    await evaluate(
      "document.querySelector('.browser-error').textContent.includes('ne peut pas afficher cette page Web')",
    ),
  );
  const count = (await save()).tabs[0].history.length;
  await click('[data-browser-action=reload]');
  await ready();
  assert.equal((await save()).tabs[0].history.length, count);
  await click('[data-browser-action=home]');
  await ready();
  assert.equal(await url(), 'http://www.xdsearch.fr/');
  const first = (await save()).active;
  await click('[data-browser-action=new]');
  await ready();
  await go('xdsearch.fr/autre');
  assert.equal((await save()).tabs.length, 2);
  await click(`[data-browser-action=select][data-tab-id="${first}"]`);
  await ready();
  assert.equal(await url(), 'http://www.xdsearch.fr/');
  await evaluate(
    "document.dispatchEvent(new CustomEvent('windows-xd:open-url',{detail:{url:'http://www.flashzone.fr/jeux/mon-jeu'}}))",
  );
  await ready();
  assert.equal((await save()).tabs.length, 3);
  assert.equal(await evaluate("document.querySelectorAll('.internet-adventurer').length"), 1);
  assert.equal(await url(), 'http://www.flashzone.fr/jeux/mon-jeu');
  await go('javascript:window.__browserAttack=true');
  assert.equal(await evaluate('window.__browserAttack'), undefined);
  await go('file:///C:/Windows/system.ini');
  assert.ok(await evaluate("!!document.querySelector('.browser-error')"));
  // Exercise the actual form and DOM, rather than merely testing URL parsing.
  await evaluate('window.__inputExecuted=0;window.alert=()=>window.__inputExecuted++');
  const attacks = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///C:/Windows/',
    '../../../../',
    'devtools://devtools/',
  ];
  for (const attack of attacks) {
    await go(attack);
    assert.ok(await evaluate("!!document.querySelector('.browser-error')"));
    await go('xdsearch.fr');
    await evaluate(
      `document.querySelector('.xd-search-form input').value=${JSON.stringify(attack)};document.querySelector('.xd-search-form').requestSubmit()`,
    );
    await ready();
    assert.equal(await evaluate("document.querySelector('.xd-search-form input').value"), attack);
    assert.equal(
      await evaluate(
        "document.querySelectorAll('.browser-page script,.browser-page iframe,.browser-page webview,.browser-page [onerror]').length",
      ),
      0,
    );
    assert.equal(await evaluate('window.__inputExecuted'), 0);
  }
  if (browserSecurityElectron) {
    assert.equal(await evaluate('typeof require'), 'undefined');
    assert.equal(await evaluate('typeof process'), 'undefined');
    assert.deepEqual(await evaluate('Object.keys(window.chaosWindow).sort()'), [
      'getFullscreen',
      'onFullscreenChanged',
      'setFullscreen',
    ]);
    assert.equal(await evaluate('window.chaosWindow.getFullscreen()'), false);
    assert.equal(await evaluate('window.chaosWindow.setFullscreen(false)'), false);
    await evaluate(
      "const script=document.createElement('script');script.textContent='window.__inputExecuted++';document.body.append(script);script.remove()",
    );
    assert.equal(await evaluate('window.__inputExecuted'), 0);
    console.log(
      'OK: Electron production CSP blocks inline scripts, no renderer Node.js, restricted fullscreen preload works, hostile address/search inputs stay inert.',
    );
  }
  const active = (await save()).active;
  await click(`[data-browser-action=close][data-tab-id="${active}"]`);
  await ready();
  assert.equal((await save()).tabs.length, 2);
  await go('xdsearch.fr/?q=<script>alert(1)</script>');
  assert.equal(
    await evaluate("document.querySelectorAll('.browser-page script,.browser-page iframe').length"),
    0,
  );
  await capture('internet-adventurer-tabs.png');
  await physicalDrag('.internet-adventurer .titlebar', 0, 20);
  await evaluate(
    "const w=document.querySelector('.internet-adventurer');w.style.width='560px';w.style.height='340px'",
  );
  await wait(100);
  const geometry = await evaluate(
    "(()=>{const w=document.querySelector('.internet-adventurer'),r=w.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height,bottom:r.bottom,taskbar:document.querySelector('.taskbar').getBoundingClientRect().top,resize:getComputedStyle(w).resize};})()",
  );
  assert.ok(geometry.left >= 0 && geometry.top >= 0 && geometry.bottom <= geometry.taskbar);
  assert.equal(geometry.width, 560);
  assert.equal(geometry.height, 340);
  assert.equal(geometry.resize, 'both');
  await click('.internet-adventurer .msn-minimize');
  assert.equal(await evaluate("document.querySelector('.internet-adventurer').hidden"), true);
  await click('[data-app=browser]');
  assert.equal(await evaluate("document.querySelector('.internet-adventurer').hidden"), false);
  const retained = await save();
  await click('.internet-adventurer .close-button');
  assert.equal(await evaluate("!!document.querySelector('[data-app=browser]')"), false);
  await click('#windows-start');
  await click('#menu-browser');
  await ready();
  assert.deepEqual(await save(), retained);
  await command('Page.reload');
  await until(() => evaluate("window.chaosDebug?.snapshot().phase==='menu'"), 'browser restart');
  await click('#menu-play');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'resume level');
  await click('#windows-start');
  await click('#menu-browser');
  await ready();
  assert.deepEqual(await save(), retained);
  // Closing the final tab closes the same Windows XD application.
  for (const tab of (await save()).tabs) {
    await click(`[data-browser-action=close][data-tab-id="${tab.id}"]`);
    if (await evaluate("!!document.querySelector('.internet-adventurer')")) await ready();
  }
  assert.equal(await evaluate("!!document.querySelector('.internet-adventurer')"), false);
  await click('#windows-start');
  await click('#menu-browser');
  await ready();
  assert.equal((await save()).tabs.length, 1);
  assert.equal(await url(), 'http://www.xdsearch.fr/');
  await click('#windows-start');
  await click('#start-menu-main');
  await click('#menu-new-game');
  await click('#menu-confirm-yes');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='rules'"),
    'browser New Game reset',
  );
  assert.equal(
    await evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1')).browser"),
    undefined,
  );
  await click('.rules-confirm');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'new level');
  await click('#windows-start');
  await click('#menu-browser');
  await ready();
  assert.equal((await save()).tabs.length, 1);
  assert.equal((await save()).tabs[0].history.length, 1);
  assert.equal(await url(), 'http://www.xdsearch.fr/');
  assert.ok(
    requests.every(
      (address) => !/^https?:/.test(address) || new URL(address).origin === new URL(gameUrl).origin,
    ),
    JSON.stringify(requests),
  );
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    `OK: local browser launch, XD Search/results/errors, URL aliases, independent tab histories, link API, reload/home, window drag/resize/taskbar, session persistence, last-tab closure, New Game and zero external requests; ${browserSecurityElectron ? 'Electron production document' : 'no Electron'}.`,
  );
}

async function verifyBuddy() {
  const definition = JSON.parse(await readFile(path.join(root, 'src/config/buddy.json')));
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  assert.equal(await evaluate("document.querySelector('.buddy').hidden"), true);
  await click('#menu-play');
  await until(() => evaluate("!!document.querySelector('.rules-confirm')"), 'initial rules');
  await click('.rules-confirm');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'rhythm playing');
  assert.equal(await evaluate("document.querySelector('.buddy').hidden"), true);
  const openBuddy = async () => {
    await click('#windows-start');
    await click('#menu-buddy');
  };
  const text = () => evaluate("document.querySelector('.buddy-bubble p').textContent");
  await openBuddy();
  assert.equal(await text(), definition.introduction[0].text);
  assert.equal(
    await evaluate("document.querySelectorAll('.buddy input,.buddy textarea').length"),
    0,
  );
  await capture('buddy-introduction.png');
  await evaluate(
    'window.__buddyNow=Date.now;window.__buddyOffset=0;Date.now=()=>window.__buddyNow()+window.__buddyOffset;',
  );
  for (let index = 1; index < definition.introduction.length; index++) {
    await evaluate(`window.__buddyOffset+=${definition.introduction[index - 1].durationMs + 200}`);
    await until(
      async () => (await text()) === definition.introduction[index].text,
      `Buddy bubble ${index + 1}`,
    );
  }
  assert.equal(await evaluate('window.chaosDebug.snapshot().phase'), 'playing');
  for (const [width, height] of [
    [1280, 800],
    [800, 600],
  ]) {
    await command('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const geometry =
      await evaluate(`(()=>{const buddy=document.querySelector('.buddy'),r=buddy.getBoundingClientRect(),b=buddy.querySelector('.buddy-bubble').getBoundingClientRect();return {
      left:r.left,top:r.top,right:r.right,bottom:r.bottom,taskbar:document.querySelector('.taskbar').getBoundingClientRect().top,
      pointer:getComputedStyle(buddy).pointerEvents,bubblePointer:getComputedStyle(buddy.querySelector('.buddy-bubble')).pointerEvents,
      animation:getComputedStyle(buddy.querySelector('.buddy-character')).animationName,bubbleLeft:b.left,bubbleRight:b.right};})()`);
    assert.ok(
      geometry.left >= 0 &&
        geometry.top >= 0 &&
        geometry.right <= width &&
        geometry.bottom < geometry.taskbar,
    );
    assert.ok(geometry.bubbleLeft >= 0 && geometry.bubbleRight <= width);
    assert.equal(geometry.pointer, 'none');
    assert.equal(geometry.bubblePointer, 'none');
    assert.equal(geometry.animation, 'buddy-celebrate');
  }
  await evaluate(`window.__buddyOffset+=${definition.introduction.at(-1).durationMs + 200}`);
  await until(() => evaluate("document.querySelector('.buddy-bubble').hidden"), 'Buddy discreet');
  await evaluate('Date.now=window.__buddyNow;');
  const empty = await evaluate(
    "(()=>{const r=document.querySelector('.buddy').getBoundingClientRect();return {x:r.left+6,y:r.top+6};})()",
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: empty.x,
    y: empty.y,
    button: 'left',
    clickCount: 1,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: empty.x + 18,
    y: empty.y + 18,
    button: 'left',
    buttons: 1,
  });
  assert.equal(await evaluate("!!document.querySelector('.desktop-selection')"), true);
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: empty.x + 18,
    y: empty.y + 18,
    button: 'left',
    clickCount: 1,
  });
  await physicalDrag('#desktop > .desktop-icons [data-shortcut=computer]', 260, 124);
  assert.equal(
    await evaluate(
      "document.querySelector('#desktop > .desktop-icons [data-shortcut=computer]').style.left",
    ),
    '260px',
  );
  await doubleClick('#desktop > .desktop-icons [data-shortcut=folder]');
  await until(() => evaluate("!!document.querySelector('.explorer-item')"), 'Explorer with Buddy');
  await command('Page.reload');
  await until(() => evaluate("window.chaosDebug?.snapshot().phase==='menu'"), 'Buddy restart');
  assert.equal(await evaluate("document.querySelector('.buddy').hidden"), true);
  await click('#menu-play');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='playing'"),
    'resumed rhythm ready',
  );
  assert.equal(await evaluate("document.querySelector('.buddy').hidden"), false);
  assert.equal(await evaluate("document.querySelector('.buddy-bubble').hidden"), true);
  await click('.buddy-hide');
  await until(() => evaluate("document.querySelector('.buddy').hidden"), 'mask Buddy');
  await openBuddy();
  assert.equal(await text(), definition.tips[0]);
  await click('.buddy-close');
  assert.equal(await evaluate("document.querySelector('.buddy-bubble').hidden"), true);
  await click('#windows-start');
  await click('#start-menu-main');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='menu'"), 'return menu');
  await click('#menu-new-game');
  await click('#menu-confirm-yes');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='rules'"),
    'New Game Buddy reset',
  );
  assert.equal(
    await evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1')).buddy"),
    undefined,
  );
  assert.equal(await evaluate("document.querySelector('.buddy').hidden"), true);
  assert.ok(await evaluate("!!document.querySelector('#start-menu [data-start-app=buddy]')"));
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    'OK: Buddy manual activation, three timed bubbles, local animations, responsive bounds above taskbar, desktop selection/drag/clicks, restart, hide/relaunch and New Game; no Electron.',
  );
}

async function verifyMiniGameLaunch() {
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const story = JSON.parse(await readFile(path.join(root, 'src/config/story.json')));
  const intro = JSON.parse(await readFile(path.join(root, 'src/dialogues/pixelgirl-intro.json')));
  const progression = new Progression(story);
  progression.begin();
  progression.complete('arcade-1');
  const session = new DialogueSession(intro, progression);
  function drain() {
    for (let i = 0; i < 150; i++) {
      if (session.nextMessage()) session.deliver();
      else if (!session.advance()) return;
    }
    assert.fail('Dialogue loop');
  }
  for (const choice of ['greeting-1', 'nickname-1', 'table-1', 'game-1']) {
    drain();
    session.choose(choice);
  }
  drain();
  // Before transfer completion, the desktop must not offer the game.
  async function loadSave() {
    await evaluate(
      `localStorage.setItem('chaos-survival-story-v1',${JSON.stringify(JSON.stringify(progression.data))});window.__uiReload=true`,
    );
    await command('Page.reload');
    await until(
      () =>
        evaluate("window.__uiReload!==true&&window.chaosDebug?.snapshot().phase==='menu'").catch(
          () => false,
        ),
      'save reload',
    );
    await click('#menu-play');
    await until(() => evaluate("window.chaosDebug.snapshot().phase==='desktop'"), 'desktop');
  }
  await loadSave();
  assert.equal(await evaluate("document.querySelectorAll('.desktop-file').length"), 0);
  const file = progression.finishTransfer(session.activeTransfer.key);
  drain();
  progression.complete('pixelgirl-hello');
  new ConversationThread('pixelgirl', progression, () => [intro]).sync();
  await loadSave();
  const shortcut = `[data-file-id="${file.id}"]`;
  assert.deepEqual(
    await evaluate(`(() => {
    const button = document.querySelector(${JSON.stringify(shortcut)});
    return {left: button.style.left, top: button.style.top};
  })()`),
    { left: '20px', top: '540px' },
  );
  await physicalDrag(shortcut, 260, 20);
  assert.equal(await evaluate("document.querySelectorAll('.popup-minigame').length"), 0);
  assert.deepEqual(
    await evaluate(
      `JSON.parse(localStorage.getItem('chaos-survival-story-v1')).desktopIcons[${JSON.stringify(`file:${file.id}`)}]`,
    ),
    { col: 2, row: 0 },
  );
  await physicalDrag(shortcut, 20, 20);
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(shortcut)}).style.left`),
    '260px',
  );
  await command('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(50);
  const cells = await evaluate(
    `Array.from(document.querySelectorAll('#desktop .desktop-icons button, #desktop .desktop-file'), button => button.style.left + ':' + button.style.top)`,
  );
  assert.equal(new Set(cells).size, cells.length);
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await wait(50);
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(shortcut)}).style.left`),
    '260px',
  );
  await physicalClick(shortcut);
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(shortcut)}).getAttribute('aria-pressed')`,
    ),
    'true',
  );
  assert.equal(await evaluate("document.querySelectorAll('.popup-minigame').length"), 0);
  await physicalClick(shortcut, true);
  await until(() => evaluate("!!document.querySelector('.rules-confirm')"), 'Smiley first rules');
  assert.equal(
    await evaluate("document.querySelector('#rules-title').textContent"),
    'Smiley Catcher 2009',
  );
  assert.equal(await evaluate("document.querySelectorAll('.popup-minigame').length"), 0);
  await physicalClick('.rules-confirm');
  await until(
    () => evaluate("document.querySelectorAll('.popup-minigame .catch-smiley').length>0"),
    'smiley game started',
  );
  await physicalClick('[data-shortcut=bin]');
  await physicalDrag('[data-shortcut=bin]', 500, 644);
  assert.deepEqual(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).desktopIcons['shortcut:bin']",
    ),
    { col: 4, row: 6 },
    'Smiley must leave visible icons draggable',
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 490,
    y: 634,
    button: 'left',
    clickCount: 1,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 612,
    y: 740,
    button: 'left',
    buttons: 1,
  });
  assert.equal(
    await evaluate(
      "!!document.querySelector('.desktop-selection')&&document.querySelector('[data-shortcut=bin]').getAttribute('aria-pressed')==='true'",
    ),
    true,
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 612,
    y: 740,
    button: 'left',
    clickCount: 1,
  });
  const artwork = [0, 1, 2, 3].map(smileyIcon);
  const centered = await evaluate(`(() => {
    const original = document.querySelector('.catch-smiley');
    const artwork = ${JSON.stringify(artwork)};
    return [42, 58, 76].flatMap(size => artwork.map((markup, variant) => {
      const target = original.cloneNode(true);
      target.innerHTML = markup;
      Object.assign(target.style, { width: size + 'px', height: size + 'px', animation: 'none' });
      original.parentElement.append(target);
      const svg = target.querySelector('svg');
      const bounds = svg.getBBox();
      const point = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        .matrixTransform(svg.getScreenCTM());
      const circle = target.getBoundingClientRect();
      const dx = point.x - circle.left - circle.width / 2;
      const dy = point.y - circle.top - circle.height / 2;
      const valid = Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1;
      target.remove();
      return {size, variant, valid, dx, dy};
    }));
  })()`);
  assert.ok(
    centered.every((item) => item.valid),
    JSON.stringify(centered),
  );
  await evaluate(`(() => {
    const arena = document.querySelector('.smiley-arena');
    const gallery = document.createElement('div');
    gallery.id = 'qa-smiley-gallery';
    Object.assign(gallery.style, { position: 'absolute', inset: '0', zIndex: '100', background: '#fab5ec' });
    ${JSON.stringify(artwork)}.forEach((markup, index) => {
      const target = document.createElement('button');
      target.className = 'catch-smiley';
      target.innerHTML = markup;
      Object.assign(target.style, { left: (12 + index * 70) + 'px', top: '24px', animation: 'none' });
      gallery.append(target);
    });
    arena.append(gallery);
  })()`);
  await capture('smiley-centering.png');
  await evaluate("document.querySelector('#qa-smiley-gallery').remove()");
  await wait(300);
  await physicalClick('.flash-rules');
  const pausedTime = await evaluate("document.querySelector('.flash-time').textContent");
  await wait(300);
  assert.equal(await evaluate("document.querySelector('.flash-time').textContent"), pausedTime);
  await physicalClick('.rules-confirm');
  await physicalClick('.catch-smiley');
  assert.ok(await evaluate("document.querySelector('.flash-score').textContent !== 'SCORE 0'"));
  await physicalClick('.popup-minigame .close-button');
  assert.equal(await evaluate("document.querySelector('[data-shortcut=bin]').style.left"), '500px');
  assert.equal(await evaluate("document.querySelectorAll('.popup-minigame').length"), 0);
  await physicalClick(shortcut, true);
  await until(
    () => evaluate("document.querySelectorAll('.popup-minigame').length===1"),
    'relaunch',
  );
  assert.equal(await evaluate("document.querySelector('.flash-score').textContent"), 'SCORE 0');
  await physicalClick('.popup-minigame .close-button');
  await command('Page.reload');
  await until(
    () => evaluate("window.chaosDebug?.snapshot().phase==='menu'").catch(() => false),
    'restart',
  );
  await click('#menu-play');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='desktop'"), 'restored desktop');
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(shortcut)}).style.left`),
    '260px',
  );
  await physicalClick(shortcut, true);
  await until(
    () => evaluate("document.querySelectorAll('.popup-minigame .catch-smiley').length>0"),
    'restored game launch',
  );
  assert.deepEqual(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).desktopIcons['shortcut:bin']",
    ),
    { col: 4, row: 6 },
    'icon moved while Smiley was active survives an app restart',
  );
  await physicalClick('.popup-minigame .close-button');
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 5,
    y: 115,
    button: 'left',
    clickCount: 1,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 125,
    y: 320,
    button: 'left',
    buttons: 1,
  });
  assert.equal(await evaluate("document.querySelectorAll('.desktop-selection').length"), 1);
  assert.equal(
    await evaluate(
      "document.querySelectorAll('#desktop .desktop-icons [aria-pressed=true]').length",
    ),
    2,
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 125,
    y: 320,
    button: 'left',
    clickCount: 1,
  });
  assert.equal(await evaluate("document.querySelectorAll('.desktop-selection').length"), 0);
  await physicalDrag('[data-shortcut=computer]', 140, 20);
  assert.equal(
    await evaluate("document.querySelector('[data-shortcut=computer]').style.left"),
    '140px',
  );
  assert.equal(
    await evaluate("document.querySelector('[data-shortcut=folder]').style.left"),
    '140px',
  );
  await physicalDrag('[data-shortcut=computer]', 260, 20); // The unlocked game occupies this cell.
  assert.equal(
    await evaluate("document.querySelector('[data-shortcut=computer]').style.left"),
    '140px',
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 900,
    y: 50,
    button: 'left',
    clickCount: 1,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 900,
    y: 50,
    button: 'left',
    clickCount: 1,
  });
  assert.equal(
    await evaluate(
      "document.querySelectorAll('#desktop .desktop-icons [aria-pressed=true]').length",
    ),
    0,
  );
  await physicalDrag('[data-shortcut=computer]', 380, 20);
  await physicalClick('[data-shortcut=computer]', true);
  await until(
    () => evaluate("document.querySelectorAll('.popup-desktopapp').length===1"),
    'computer after drag',
  );
  assert.equal(await evaluate("document.querySelectorAll('.desktop-app-task').length"), 1);
  await verifyWindowOverIcons('.popup-desktopapp');
  await evaluate(`(() => {
    const enter = name => [...document.querySelectorAll('.popup-desktopapp .explorer-item')]
      .find(row => row.querySelector('strong').textContent === name)
      .dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));
    enter('Disque local (C:)'); enter('WINDOWS'); enter('win.ini');
  })()`);
  await verifyWindowOverIcons('.file-generic');
  await physicalClick('.file-generic .close-button');
  await physicalClick('.popup-desktopapp .close-button');
  await physicalClick('[data-shortcut=msn]', true);
  await until(
    () => evaluate("document.querySelectorAll('.popup-narrative').length===1"),
    'Messenger double click',
  );
  await verifyWindowOverIcons('[data-messenger-view=contacts]');
  const narrative = await evaluate(
    "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues)",
  );
  await physicalClick('[data-contact-id=skater]', true);
  assert.equal(
    await evaluate("document.querySelector('.contact-name').textContent"),
    'Sk8er_du_93',
  );
  assert.ok(
    await evaluate(
      "document.querySelector('.contact-status').textContent.startsWith('Hors ligne')",
    ),
  );
  assert.equal(
    await evaluate("document.querySelectorAll('.conversation-log .conversation-message').length"),
    0,
  );
  assert.equal(await evaluate("document.querySelectorAll('.dialogue-choice').length"), 0);
  assert.ok(
    await evaluate(
      "document.querySelector('.dialogue-typing').textContent.includes('indisponible')",
    ),
  );
  assert.equal(await evaluate("document.querySelectorAll('.popup-narrative').length"), 2);
  await verifyWindowOverIcons('[data-messenger-contact=skater]');
  await physicalClick('[data-messenger-contact=skater] .msn-minimize');
  await physicalClick('[data-app=\"messenger:conversation:skater\"]');
  assert.equal(
    await evaluate("document.querySelector('.contact-name').textContent"),
    'Sk8er_du_93',
  );
  assert.equal(
    await evaluate(
      "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues)",
    ),
    narrative,
  );
  await physicalClick('[data-app=\"messenger:contacts\"]');
  await physicalClick('[data-contact-id=pixelgirl]', true);
  assert.ok(await evaluate("document.querySelectorAll('.conversation-message').length>0"));
  await physicalClick('[data-messenger-contact=pixelgirl] .close-button');
  await click('[data-messenger-contact=skater] .close-button');
  await click('[data-messenger-view=contacts] .close-button');
  await physicalClick('#windows-start');
  await physicalClick('#start-menu-main');
  await assertMenuDesktopMatches();
  await click('#menu-play');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='desktop'"), 'desktop again');
  assert.equal(
    await evaluate("document.querySelector('[data-shortcut=arcade] span').textContent"),
    'ChaosSurvival.exe',
  );
  assert.equal(await evaluate("!!document.querySelector('[data-shortcut=music]')"), false);
  const launches = await evaluate(
    "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).level1Launches",
  );
  await physicalClick('[data-shortcut=arcade]', true);
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='playing'"),
    'rhythmic EXE double click',
  );
  assert.equal(
    await evaluate("getComputedStyle(document.querySelector('#desktop-files')).display"),
    'block',
    'received file icons stay available during rhythm gameplay',
  );
  await until(
    () => evaluate('window.chaosDebug.snapshot().audioTime > 0'),
    'level music advancing',
  );
  assert.equal(
    await evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1')).level1Launches"),
    launches + 1,
  );
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    'OK: desktop grid, icon selection/dragging, windows covering icons and releasing their clicks, taskbar access, saved positions, Smiley, applications, Messenger, Start/menu and rhythmic EXE; no Electron.',
  );
}

async function verifyArcadeMovement() {
  const story = JSON.parse(await readFile(path.join(root, 'src/config/story.json')));
  const progression = new Progression(story);
  progression.begin();
  progression.complete('arcade-1');
  progression.complete('pixelgirl-hello');
  await command('Page.enable');
  const injected = await command('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('chaos-survival-story-v1',${JSON.stringify(JSON.stringify(progression.data))});window.__movementFixture=true`,
  });
  await command('Page.reload');
  await until(
    () =>
      evaluate("window.__movementFixture&&window.chaosDebug?.snapshot().phase==='menu'").catch(
        () => false,
      ),
    'movement fixture',
  );
  await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
  await click('#menu-play');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='desktop'"), 'desktop');
  const stableMenu = stabilityOnly ? await verifyStartMenuOrder() : null;
  // The menu test deliberately leaves Explorer open; close it before a real icon click.
  if (stabilityOnly) await click('.popup-desktopapp .close-button');
  const iconPositions = () =>
    evaluate(
      "[...document.querySelectorAll('#desktop > .desktop-icons button')].map(b=>({id:b.dataset.shortcut,left:b.style.left,top:b.style.top,x:b.getBoundingClientRect().left,y:b.getBoundingClientRect().top}))",
    );
  let stableIcons = await iconPositions();
  await verifyDesktopSelection();
  await physicalClick('[data-shortcut=arcade]', true);
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'arcade EXE');
  assert.deepEqual(
    await iconPositions(),
    stableIcons,
    'rhythmic start must preserve the desktop grid',
  );
  await verifyDesktopSelection();
  await until(
    () => evaluate("!!document.querySelector('#playfield > .popup:not(.preview-window)')"),
    'rhythmic window',
  );
  await physicalClick('[data-shortcut=folder]');
  await physicalDrag('[data-shortcut=folder]', 500, 228);
  assert.deepEqual(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).desktopIcons['shortcut:folder']",
    ),
    { col: 4, row: 2 },
    'visible icon must drag and persist while rhythm gameplay runs',
  );
  stableIcons = await iconPositions();
  const selector = await evaluate(
    "'[data-window-id=\"'+document.querySelector('#playfield > .popup:not(.preview-window)').dataset.windowId+'\"]'",
  );
  const dimensions = await evaluate(
    `({width:document.querySelector(${JSON.stringify(selector)}).offsetWidth,height:document.querySelector(${JSON.stringify(selector)}).offsetHeight})`,
  );
  await verifyWindowOverIcons(selector, true);
  assert.deepEqual(
    await evaluate(
      `({width:document.querySelector(${JSON.stringify(selector)}).offsetWidth,height:document.querySelector(${JSON.stringify(selector)}).offsetHeight})`,
    ),
    dimensions,
  );
  assert.equal(await evaluate('window.chaosDebug.snapshot().phase'), 'playing');
  const score = await evaluate("Number(document.querySelector('#score').textContent)");
  await physicalClick(selector + ' .close-button');
  assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), false);
  assert.ok((await evaluate("Number(document.querySelector('#score').textContent)")) > score);
  assert.ok(await evaluate('window.chaosDebug.snapshot().audioTime > 0'));
  await until(
    () => evaluate("!!document.querySelector('#playfield > .popup:not(.preview-window)')"),
    'next playable window',
  );
  // The same manager also handles real desktop applications during a controlled pause.
  await physicalClick('#windows-start');
  await physicalClick('[data-system-app=computer]');
  await until(() => evaluate("!!document.querySelector('.popup-desktopapp')"), 'explorer');
  await verifyWindowOverIcons('.popup-desktopapp', true);
  for (const kind of ['computer', 'computer', 'msn', 'computer']) {
    if (!(await evaluate("window.chaosDebug.snapshot().phase==='paused'"))) {
      await until(
        () => evaluate("!!document.querySelector('#playfield > .popup:not(.preview-window)')"),
        'next cycle window',
      );
      await click('#windows-start');
      await click(kind === 'msn' ? '#menu-messenger' : '[data-system-app=computer]');
    }
    await until(
      () => evaluate("window.chaosDebug.snapshot().phase==='paused'"),
      'application pause',
    );
    const frozen = await evaluate('window.chaosDebug.snapshot().audioTime');
    const chaos = await evaluate("document.querySelector('#chaos-text').textContent");
    await wait(150);
    assert.equal(await evaluate('window.chaosDebug.snapshot().audioTime'), frozen);
    assert.equal(await evaluate("document.querySelector('#chaos-text').textContent"), chaos);
    await evaluate(
      "document.querySelectorAll('#playfield > .popup:not(.preview-window) .close-button').forEach(b=>b.click())",
    );
    assert.equal(
      await evaluate('window.chaosDebug.snapshot().open'),
      0,
      'closing arcade windows during application pause must retire their pressure/count',
    );
    await click(
      kind === 'msn'
        ? '[data-messenger-view=contacts] .close-button'
        : '.popup-desktopapp .close-button',
    );
    await until(
      () => evaluate("!document.querySelector('#modal-layer').hidden"),
      'pause controls after application closes',
    );
    await click('#dialog-action');
    await until(
      () => evaluate("window.chaosDebug.snapshot().phase==='playing'"),
      'resume after application',
    );
    await until(
      () => evaluate("!!document.querySelector('#playfield > .popup:not(.preview-window)')"),
      'spawn after resume',
    );
    assert.equal(
      await evaluate(
        "window.chaosDebug.snapshot().open===document.querySelectorAll('#playfield > .popup:not(.preview-window)').length",
      ),
      true,
    );
  }
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    'OK: EXE launch, real arcade/explorer dragging across all desktop edges, icon/HUD coverage, taskbar hit testing, normal closing/score/audio; no Electron.',
  );
  if (stabilityOnly) {
    await until(
      async () => {
        const phase = await evaluate('window.chaosDebug.snapshot().phase');
        if (phase === 'playing')
          await evaluate(
            "document.querySelectorAll('#playfield > .popup:not(.preview-window) .close-button').forEach(b=>b.click())",
          );
        return phase === 'ended';
      },
      'complete rhythmic level with normal window closures',
      100000,
    );
    await until(() => evaluate("!!document.querySelector('#victory-continue')"), 'normal victory');
    await click('#victory-continue');
    await until(
      () => evaluate("window.chaosDebug.snapshot().phase==='desktop'"),
      'desktop after victory',
    );
    assert.deepEqual(await iconPositions(), stableIcons, 'victory must preserve desktop positions');
    assert.deepEqual(
      await evaluate(
        "[...document.querySelectorAll('#start-menu > [data-start-app]')].map(b=>b.dataset.startApp)",
      ),
      stableMenu,
    );
  }
  await physicalClick('#windows-start');
  await physicalClick('#start-menu-main');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='menu'"), 'quit rhythmic level');
  await click('#menu-play');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='desktop'"),
    'desktop after quitting level',
  );
  await verifyDesktopSelection();
  assert.deepEqual(await iconPositions(), stableIcons);
  if (stabilityOnly)
    assert.deepEqual(
      await evaluate(
        "[...document.querySelectorAll('#start-menu > [data-start-app]')].map(b=>b.dataset.startApp)",
      ),
      stableMenu,
    );
  if (stabilityOnly)
    console.log(
      'OK: personalized Start order and desktop cells remain unchanged through a full rhythmic victory and return to the menu.',
    );
}

async function verifyDesktopGrid() {
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const story = JSON.parse(await readFile(path.join(root, 'src/config/story.json')));
  const progression = new Progression(story);
  progression.begin();
  progression.complete('arcade-1');
  progression.complete('pixelgirl-hello');
  await command('Page.enable');
  const injected = await command('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('chaos-survival-story-v1',${JSON.stringify(JSON.stringify(progression.data))});window.__gridFixture=true`,
  });
  await command('Page.reload');
  await until(
    () =>
      evaluate("window.__gridFixture&&window.chaosDebug?.snapshot().phase==='menu'").catch(
        () => false,
      ),
    'fresh grid fixture',
  );
  await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
  async function desktop() {
    await click('#menu-play');
    await until(() => evaluate("window.chaosDebug.snapshot().phase==='desktop'"), 'grid desktop');
    await evaluate(
      'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
    );
  }
  await desktop();
  const bin = '[data-shortcut=bin]';
  assert.deepEqual(
    await evaluate(
      `({left:document.querySelector('${bin}').style.left,top:document.querySelector('${bin}').style.top})`,
    ),
    { left: '20px', top: '20px' },
  );
  const lastRow = await evaluate(
    "(() => {const icons=[...document.querySelectorAll('.desktop-icons button')];const h=Math.max(...icons.map(b=>b.offsetHeight));return Math.floor((document.querySelector('.taskbar').getBoundingClientRect().top-20-h)/104);})()",
  );
  assert.equal(lastRow, 6);
  await physicalDrag(bin, 140, 20 + lastRow * 104);
  assert.deepEqual(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).desktopIcons['shortcut:bin']",
    ),
    { col: 1, row: lastRow },
  );
  async function bounded() {
    assert.equal(
      await evaluate(
        "(() => {const buttons=[...document.querySelectorAll('#desktop > .desktop-icons button')];const task=document.querySelector('.taskbar').getBoundingClientRect();return buttons.every(b=>{const r=b.getBoundingClientRect();return r.top>=0&&r.bottom<=task.top;})&&new Set(buttons.map(b=>b.style.left+':'+b.style.top)).size===buttons.length;})()",
      ),
      true,
    );
  }
  await bounded();
  // The last row also participates in the existing blue selection rectangle.
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 130,
    y: 20 + lastRow * 104 - 8,
    button: 'left',
    clickCount: 1,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: 250,
    y: 790,
    button: 'left',
    buttons: 1,
  });
  assert.equal(
    await evaluate("document.querySelector('[data-shortcut=bin]').getAttribute('aria-pressed')"),
    'true',
  );
  assert.equal(
    await evaluate(
      "document.querySelector('.desktop-selection').getBoundingClientRect().bottom<=document.querySelector('.taskbar').getBoundingClientRect().top",
    ),
    true,
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 250,
    y: 790,
    button: 'left',
    clickCount: 1,
  });
  await capture('desktop-grid-bottom-row.png');
  await evaluate('window.__gridRestart=true');
  await command('Page.reload');
  await until(
    () =>
      evaluate("!window.__gridRestart&&window.chaosDebug?.snapshot().phase==='menu'").catch(
        () => false,
      ),
    'saved grid restart',
  );
  await desktop();
  assert.equal(
    await evaluate("document.querySelector('[data-shortcut=bin]').style.top"),
    `${20 + lastRow * 104}px`,
  );
  await command('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await bounded();
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await bounded();
  assert.equal(
    await evaluate("document.querySelector('[data-shortcut=bin]').style.top"),
    `${20 + lastRow * 104}px`,
  );
  await physicalClick(bin, true);
  await until(
    () => evaluate("!!document.querySelector('.taskbar [data-app=bin]')"),
    'bin opening after move',
  );
  console.log(
    'OK: bin default/movement, final row, selection, persisted positions, resize bounds and bin double-click; no Electron.',
  );
}

async function verifyDesktopSelection() {
  // Let a just-restored desktop settle before starting a native pointer gesture.
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const rect = await evaluate(`(() => {
    const icons=['computer','folder'].map(id=>document.querySelector('[data-shortcut="'+id+'"]').getBoundingClientRect());
    return {left:Math.max(0,Math.min(...icons.map(r=>r.left))-8),top:Math.max(0,Math.min(...icons.map(r=>r.top))-8),right:Math.max(...icons.map(r=>r.right))+8,bottom:Math.max(...icons.map(r=>r.bottom))+8};
  })()`);
  await command('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: rect.left,
    y: rect.top,
    button: 'left',
    clickCount: 1,
  });
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: rect.right,
    y: rect.bottom,
    button: 'left',
    buttons: 1,
  });
  assert.equal(await evaluate("!!document.querySelector('.desktop-selection')"), true);
  assert.equal(
    await evaluate(
      "['computer','folder'].every(id=>document.querySelector('[data-shortcut=\"'+id+'\"]').getAttribute('aria-pressed')==='true')",
    ),
    true,
  );
  assert.equal(
    await evaluate("getComputedStyle(document.querySelector('.desktop-selection')).pointerEvents"),
    'none',
  );
  if (await evaluate("window.chaosDebug.snapshot().phase==='playing'"))
    await capture('desktop-selection-rhythm.png');
  const task = await evaluate("document.querySelector('.taskbar').getBoundingClientRect().top");
  await command('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: rect.right,
    y: task + 100,
    button: 'left',
    buttons: 1,
  });
  assert.equal(
    await evaluate("document.querySelector('.desktop-selection').getBoundingClientRect().bottom"),
    task,
  );
  assert.equal(
    await evaluate(
      "(() => {const r=document.querySelector('#windows-start').getBoundingClientRect();return !!document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('#windows-start');})()",
    ),
    true,
  );
  await command('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: rect.right,
    y: task + 100,
    button: 'left',
    clickCount: 1,
  });
  assert.equal(await evaluate("!!document.querySelector('.desktop-selection')"), false);
}

async function verifyWindowOverIcons(selector, allEdges = false) {
  await until(
    () =>
      evaluate(
        `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).transform === 'none'`,
      ),
    'window opening animation',
  );
  const saved = await evaluate(
    "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).desktopIcons)",
  );
  const drag = async (left, top) => {
    const start = await evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const rect = element.getBoundingClientRect();
      const bar = element.querySelector('.titlebar').getBoundingClientRect();
      return { x: bar.left + 60, y: bar.top + bar.height/2, left: rect.left, top: rect.top };
    })()`);
    await command('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: start.x,
      y: start.y,
      button: 'left',
      clickCount: 1,
    });
    for (let step = 1; step <= 6; step++)
      await command('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: start.x + ((left - start.left) * step) / 6,
        y: start.y + ((top - start.top) * step) / 6,
        button: 'left',
        buttons: 1,
      });
    assert.equal(
      await evaluate("!!document.querySelector('.desktop-selection')"),
      false,
      'window dragging must not create a desktop selection rectangle',
    );
    await command('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: start.x + left - start.left,
      y: start.y + top - start.top,
      button: 'left',
      clickCount: 1,
    });
  };
  const covered = () =>
    evaluate(`(() => {
    const icon = document.querySelector('[data-shortcut=${allEdges ? 'computer' : 'msn'}]');
    const rect = icon.getBoundingClientRect();
    return document.querySelector(${JSON.stringify(selector)}).contains(document.elementFromPoint(rect.left + rect.width/2, rect.top + rect.height/2));
  })()`);
  await drag(-20, -20);
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().left`,
    ),
    0,
  );
  assert.equal(await covered(), true, `${selector} covers desktop icons`);
  assert.equal(
    await evaluate(
      `(() => { const start = document.querySelector('#windows-start'); const rect=start.getBoundingClientRect(); return start.contains(document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)); })()`,
    ),
    true,
  );
  if (allEdges) {
    const edges = () =>
      evaluate(`(() => {
      const rect=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      const desktop=document.querySelector('.desktop').getBoundingClientRect();
      const task=document.querySelector('.taskbar').getBoundingClientRect();
      const start=document.querySelector('#windows-start');const s=start.getBoundingClientRect();
      return {left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,desktopRight:desktop.right,taskTop:task.top,startClickable:start.contains(document.elementFromPoint(s.left+s.width/2,s.top+s.height/2)),taskClickable:!!document.elementFromPoint(task.right-20,task.top+task.height/2)?.closest('.taskbar')};
    })()`);
    assert.equal((await edges()).top, 0);
    await drag(10000, -20);
    let state = await edges();
    assert.equal(state.right, state.desktopRight);
    assert.equal(state.top, 0);
    await drag(10000, 10000);
    state = await edges();
    assert.equal(state.bottom, state.taskTop);
    assert.equal(state.startClickable, true);
    assert.equal(state.taskClickable, true);
    await drag(-10000, 10000);
    state = await edges();
    assert.equal(state.left, 0);
    assert.equal(state.bottom, state.taskTop);
    await drag(0, 0);
    // The titlebar must really be hit-testable in the former HUD exclusion zone.
    assert.equal(
      await evaluate(
        `(() => {const bar=document.querySelector(${JSON.stringify(selector + ' .titlebar')});const r=bar.getBoundingClientRect();return bar.contains(document.elementFromPoint(r.left+60,r.top+r.height/2));})()`,
      ),
      true,
    );
    return;
  }
  await drag(640, 0);
  assert.equal(await covered(), false);
  await physicalClick('[data-shortcut=msn]');
  assert.equal(
    await evaluate("document.querySelector('[data-shortcut=msn]').getAttribute('aria-pressed')"),
    'true',
  );
  assert.equal(
    await evaluate(
      "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).desktopIcons)",
    ),
    saved,
  );
}

async function verifyVisibleK7Delivery() {
  qaStep('K7 : préparer une sauvegarde de test isolée après la fin des deux conversations privées');
  const story = JSON.parse(await readFile(path.join(root, 'src/config/story.json')));
  const files = await readdir(path.join(root, 'src/dialogues'));
  const definitions = Object.fromEntries(await Promise.all(files
    .filter((name) => name.endsWith('.json'))
    .map(async (name) => {
      const definition = JSON.parse(await readFile(path.join(root, 'src/dialogues', name), 'utf8'));
      return [definition.id, definition];
    })));
  const values = new Map();
  const progression = new Progression(story, {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  });
  progression.begin();
  progression.data.current = null;
  progression.data.completed = story.sequences.map(({ id }) => id);
  progression.data.flags.superPlombierPostStarted = true;
  for (const [id, nodeId, text] of [
    ['turbo-super-plombier', 'last-goodbye', 'allez a+'],
    ['pixelgirl-smiley-victory', 's8-common-1', 'bon jreviens :3'],
    ['pixelgirl-super-plombier-wizz', 'ending', 'allez bisousss :3'],
  ]) {
    const dialogue = definitions[id];
    const node = dialogue.nodes[nodeId];
    progression.data.dialogues[id] = {
      node: nodeId,
      cursor: node.messages.length,
      finished: true,
      revision: dialogue.revision ?? 1,
      transcript: [{ speaker: 'contact', text, receivedAt: Date.now() - 1_000 }],
    };
  }
  progression.save();
  const fixture = JSON.stringify(progression.data);
  await command('Page.enable');
  const injection = await command('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('chaos-survival-story-v1',${JSON.stringify(fixture)});window.__k7DeliveryFixture=true`,
  });
  qaLog('Un rechargement renderer installe la sauvegarde temporaire; aucune donnée du profil utilisateur n’est utilisée.');
  await command('Page.reload');
  await until(
    () => evaluate("window.__k7DeliveryFixture&&window.chaosDebug?.snapshot().phase==='menu'").catch(() => false),
    'K7 delivery fixture reload',
  );
  await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
  await click('#menu-play');
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='desktop'"), 'desktop with K7 fixture');
  await click('#windows-start');
  await click('#menu-messenger');
  await until(() => evaluate("!!document.querySelector('.messenger-contact-list')"), 'Messenger roster');
  qaStep('K7 : attendre sa connexion, puis ouvrir sa conversation privée');
  await until(
    () => evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1')).contactConnections.k7?.status==='online'"),
    'K7 online',
    20_000,
  );
  await until(() => evaluate("!!document.querySelector('[data-contact-id=k7]')"), 'K7 contact row');
  await doubleClick('[data-contact-id=k7]');
  await until(() => evaluate("!!document.querySelector('[data-messenger-contact=k7] .conversation-log')"), 'K7 private conversation');

  const firstFive = [];
  let seen = 0;
  let scheduledDueAt = null;
  let typingObserved = false;
  qaStep('K7 : mesurer les échéances sauvegardées et les cinq premières réceptions réelles');
  while (seen < 5) {
    const sample = await evaluate(`(() => {
      const save=JSON.parse(localStorage.getItem('chaos-survival-story-v1'));
      const dialogue=save.dialogues['k7-intro'];
      const rows=[...document.querySelectorAll('[data-messenger-contact=k7] .conversation-message.from-contact')].map(row=>row.textContent.trim());
      return {now:Date.now(),dialogue:dialogue&&{receiveDueAt:dialogue.receiveDueAt,transcript:dialogue.transcript.filter(message=>message.speaker==='contact').map(message=>({text:message.text,receivedAt:message.receivedAt}))},rows,typing:!!document.querySelector('[data-messenger-contact=k7] .contact-typing.is-typing')};
    })()`);
    if (Number.isFinite(sample.dialogue?.receiveDueAt) && scheduledDueAt === null)
      scheduledDueAt = sample.dialogue.receiveDueAt;
    typingObserved ||= sample.typing;
    const transcript = sample.dialogue?.transcript ?? [];
    if (transcript.length > seen) {
      assert.equal(transcript.length, seen + 1, 'the renderer must not deliver a message burst');
      const message = transcript[seen];
      firstFive.push({
        text: message.text,
        scheduledDueAt,
        receivedAt: message.receivedAt,
        observedAt: sample.now,
        displayed: sample.rows.includes(message.text),
      });
      scheduledDueAt = sample.dialogue.receiveDueAt;
      seen = transcript.length;
    }
    await wait(50);
  }
  const expected = definitions['k7-intro'].nodes['first-contact'].messages.slice(0, 5);
  assert.deepEqual(firstFive.map(({ text }) => text), expected.map(({ text }) => text));
  assert.equal(firstFive.every(({ displayed }) => displayed), true, JSON.stringify(firstFive));
  assert.equal(typingObserved, true, 'the shared Messenger typing indicator appears during the scheduled waits');
  for (let index = 1; index < firstFive.length; index++) {
    const minimumGap = expected[index].delayMs + expected[index].typingMs + (expected[index].typingPauseMs ?? 0);
    assert.ok(firstFive[index].receivedAt - firstFive[index - 1].receivedAt >= minimumGap,
      `message ${index + 1} respects its authored ${minimumGap} ms delay`);
  }
  await capture('k7-first-five-messages-electron.png');
  qaLog(`Horodatages de réception K7 : ${JSON.stringify(firstFive)}`);
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log('OK : Electron réel, fenêtre K7 visible, indicateur de saisie observé, cinq messages affichés progressivement et chronologie JSON respectée.');
}

async function verifyTypingIndicator() {
  qaStep('Messenger : indicateur de saisie, WIZZ et reprise de conversation');
  const story = JSON.parse(await readFile(path.join(root, 'src/config/story.json')));
  const intro = JSON.parse(await readFile(path.join(root, 'src/dialogues/pixelgirl-intro.json')));
  const progression = new Progression(story);
  progression.begin();
  progression.complete('arcade-1');
  const session = new DialogueSession(intro, progression);
  session.deliver();
  session.deliver(); // Start with the next existing message, whose typing window lasts 900 ms.
  const fixture = JSON.stringify(progression.data);
  let typingFixtureReloads = 0;
  async function start() {
    // Inject before the new app starts; a live conversation must not overwrite this fixture.
    const marker = String(Date.now());
    await command('Page.enable');
    const injected = await command('Page.addScriptToEvaluateOnNewDocument', {
      source: `localStorage.setItem('chaos-survival-story-v1',${JSON.stringify(fixture)});window.__typingFixture=${JSON.stringify(marker)}`,
    });
    typingFixtureReloads += 1;
    qaLog(`Rechargement renderer ${typingFixtureReloads}/2 pour le test de reprise de sauvegarde Messenger (même processus)`);
    await command('Page.reload');
    await until(
      () =>
        evaluate(
          `window.__typingFixture===${JSON.stringify(marker)}&&window.chaosDebug?.snapshot().phase==='menu'`,
        ).catch(() => false),
      'typing fixture reload',
    ).catch(async (error) => {
      throw new Error(
        error.message +
          JSON.stringify(
            await evaluate(
              `({marker: window.__typingFixture, phase: window.chaosDebug?.snapshot().phase, expected: ${JSON.stringify(marker)}})`,
            ),
          ) +
          JSON.stringify(exceptions),
      );
    });
    await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier });
    await click('#menu-play');
    await until(
      () => evaluate("!!document.querySelector('.contact-typing.is-typing')"),
      'NPC is typing',
    ).catch(async (error) => {
      const state = await evaluate(
        `({phase: window.chaosDebug?.snapshot().phase, log: !!document.querySelector('.conversation-log'), indicator: document.querySelector('.contact-typing')?.outerHTML, saved: JSON.parse(localStorage.getItem('chaos-survival-story-v1'))?.dialogues['pixelgirl-intro'], exceptions: ${JSON.stringify(exceptions)}})`,
      );
      throw new Error(error.message + JSON.stringify(state));
    });
    assert.equal(
      await evaluate("document.querySelector('.contact-typing').textContent"),
      "xX_PixelGirl_Xx est en train d'\u00e9crire...",
    );
    assert.ok(
      await evaluate(
        "document.querySelector('.conversation-history') === document.querySelector('.contact-typing').parentElement",
      ),
    );
    assert.equal(
      await evaluate("!!document.querySelector('.conversation-log .contact-typing')"),
      false,
    );
    assert.equal(await evaluate("document.querySelectorAll('.dialogue-choice').length"), 0);
    await evaluate(
      'window.__typingOriginalNow=Date.now;window.__typingNow=Date.now();Date.now=()=>window.__typingNow',
    );
    const anchored = await evaluate(`(() => {
      const flow = document.querySelector('.conversation-flow');
      flow.closest('.popup').style.animation = 'none';
      const log = document.querySelector('.conversation-log');
      const indicator = document.querySelector('.contact-typing');
      const history = document.querySelector('.conversation-history');
      const anchor=()=>{const a=indicator.getBoundingClientRect(),b=history.getBoundingClientRect();return {left:a.left-b.left,bottom:b.bottom-a.bottom};};
      const before=anchor();
      const spacer = document.createElement('div');
      spacer.style.height = '2000px';
      flow.prepend(spacer);
      log.scrollTop = 0;
      log.dispatchEvent(new Event('scroll'));
      const wizzButton=document.querySelector('[data-msn-action=wizz]');
      wizzButton.click();wizzButton.click();
      const after=anchor();
      const readingPreserved=log.scrollTop===0;
      log.scrollTop = 40;
      const scrolled=anchor();
      const frame=flow.closest('.popup');
      const width=frame.style.width,height=frame.style.height;
      frame.style.width='470px';frame.style.height='390px';
      const resized=anchor();
      frame.style.width=width;frame.style.height=height;
      spacer.remove();
      log.scrollTop=log.scrollHeight;
      const last=flow.lastElementChild.getBoundingClientRect();
      return {before,after,scrolled,resized,readingPreserved,wizzDisabled:wizzButton.disabled,
        hidden:indicator.hidden, indicators:history.querySelectorAll('.contact-typing').length,
        noOverlap:last.bottom<=indicator.getBoundingClientRect().top,
        wizz:[...flow.querySelectorAll('.conversation-system')].map(row=>row.textContent)};
    })()`);
    assert.deepEqual(anchored.before, { left: 11, bottom: 7 });
    for (const key of ['after', 'scrolled', 'resized'])
      assert.deepEqual(anchored[key], anchored.before);
    assert.equal(anchored.readingPreserved, true);
    assert.equal(anchored.hidden, false);
    assert.equal(anchored.indicators, 1);
    assert.equal(anchored.noOverlap, true);
    assert.equal(anchored.wizzDisabled, true, 'rapid repeat clicks leave Wizz disabled during cooldown');
    assert.deepEqual(
      anchored.wizz,
      ['JustMe vous a envoyé un wizz !'],
      'two rapid clicks during cooldown send exactly one Wizz',
    );
    await capture('messenger-fixed-typing-wizz.png');
    await evaluate('Date.now=window.__typingOriginalNow;delete window.__typingOriginalNow');
    await wait(5200);
    assert.equal(
      await evaluate("document.querySelector('[data-msn-action=wizz]').disabled"),
      false,
      'Wizz becomes available after the five-second cooldown',
    );
    await physicalClick('[data-msn-action=wizz]');
    await until(
      () => evaluate("document.querySelectorAll('.conversation-system').length===2"),
      'Wizz accepted after cooldown expiry',
    );
    assert.deepEqual(
      await evaluate(
        "[...document.querySelectorAll('.conversation-system')].map(row=>row.textContent)",
      ),
      Array(2).fill('JustMe vous a envoyé un wizz !'),
      'a new Wizz is accepted after the cooldown expires',
    );
    await capture('messenger-wizz-cooldown-expired.png');
  }
  async function received() {
    await until(
      () =>
        evaluate(
          "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues['pixelgirl-intro'].cursor===4",
        ),
      'messages continue in background',
    );
  }
  qaStep('Messenger : première réception en arrière-plan et WIZZ avec cooldown');
  await start();
  await click('.popup-narrative .msn-minimize');
  await received();
  await click('[data-app=\"messenger:conversation:pixelgirl\"]');
  assert.equal(await evaluate("document.querySelector('.contact-typing').hidden"), true);
  assert.equal(await evaluate("document.querySelectorAll('.dialogue-choice').length"), 3);
  await command('Emulation.setDeviceMetricsOverride', {
    width: 800,
    height: 600,
    deviceScaleFactor: 1,
    mobile: false,
  });
  qaStep('Messenger : seconde reprise isolée et choix persistants');
  await start();
  await click('.popup-narrative .close-button');
  await received();
  await click('#windows-start');
  await click('#menu-messenger');
  await evaluate(
    "document.querySelector('[data-contact-id=pixelgirl]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))",
  );
  assert.equal(await evaluate("document.querySelector('.contact-typing').hidden"), true);
  assert.equal(await evaluate("document.querySelectorAll('.dialogue-choice').length"), 3);
  assert.equal(
    await evaluate("document.querySelectorAll('.conversation-log .from-contact').length"),
    4,
  );
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
      `OK: ${visibleMessengerOnly ? 'Electron visible' : 'Chromium'} Messenger typing, two rapid Wizz clicks limited to one during cooldown, second Wizz accepted after 5.2 s, scrolling/resize, background reception and persistent choices.`,
  );
}

async function verifyVisiblePortraitLayout() {
  qaStep('Portraits Messenger : regles du premier lancement et fixture PixelGirl isolee');
  await physicalClick('#menu-play');
  await until(() => evaluate("!!document.querySelector('.rules-confirm')"), 'first-run rules');
  await physicalClick('.rules-confirm');
  await until(
    () => evaluate("['desktop','playing'].includes(window.chaosDebug.snapshot().phase)"),
    'desktop after first-run rules',
  );

  const story = JSON.parse(await readFile(path.join(root, 'src/config/story.json')));
  const progression = new Progression(story);
  progression.begin();
  progression.complete('arcade-1');
  progression.complete('pixelgirl-hello');
  await command('Page.enable');
  const injection = await command('Page.addScriptToEvaluateOnNewDocument', {
    source: `localStorage.setItem('chaos-survival-story-v1',${JSON.stringify(JSON.stringify(progression.data))});window.__portraitFixture=true`,
  });
  qaLog('Un seul reload du renderer pour installer la sauvegarde temporaire PixelGirl');
  await command('Page.reload');
  await until(
    () => evaluate("window.__portraitFixture&&window.chaosDebug?.snapshot().phase==='menu'").catch(() => false),
    'isolated PixelGirl portrait fixture',
  );
  await command('Page.removeScriptToEvaluateOnNewDocument', { identifier: injection.identifier });
  await physicalClick('#menu-play');
  await until(() => evaluate("['desktop','playing'].includes(window.chaosDebug.snapshot().phase)"), 'desktop with PixelGirl unlocked');
  await physicalClick('#windows-start');
  await physicalClick('#menu-messenger');
  await until(() => evaluate("!!document.querySelector('[data-contact-id=pixelgirl]')"), 'PixelGirl contact');
  await evaluate("document.querySelector('[data-contact-id=pixelgirl]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
  const conversation = '[data-messenger-contact="pixelgirl"]';
  await until(() => evaluate(`!!document.querySelector('${conversation} .conversation-content')`), 'PixelGirl private conversation');

  const inspectLayout = async (label) => {
    const layout = await evaluate(`(()=>{
      const w=document.querySelector('${conversation}'),p=w.querySelector('.conversation-portraits'),
        pr=p.getBoundingClientRect(),webcam=p.querySelector('.msn-webcam-placeholder'),wr=webcam.getBoundingClientRect(),
        icon=webcam.querySelector('.msn-webcam-icon'),style=getComputedStyle(p);
      const verticalStart=p.scrollTop;p.scrollTop=p.scrollHeight;const verticalScroll=p.scrollTop>verticalStart;p.scrollTop=verticalStart;
      return {portrait:[pr.width,pr.height],client:[p.clientWidth,p.clientHeight],scroll:[p.scrollWidth,p.scrollHeight],
        overflowY:style.overflowY,webcam:[wr.x,wr.y,wr.width,wr.height],clientLeft:pr.x+p.clientLeft,
        clientRight:pr.x+p.clientLeft+p.clientWidth,icon:!!icon,text:webcam.textContent.trim()};
    })()`);
    assert.ok(layout.scroll[0] <= layout.client[0], `${label}: horizontal overflow ${JSON.stringify(layout)}`);
    assert.ok(layout.scroll[1] >= layout.client[1] && layout.overflowY === 'auto', `${label}: vertical scrolling unavailable ${JSON.stringify(layout)}`);
    assert.ok(layout.webcam[0] >= layout.clientLeft && layout.webcam[0] + layout.webcam[2] <= layout.clientRight,
      `${label}: webcam block exceeds the visible content width ${JSON.stringify(layout)}`);
    assert.ok(layout.icon && layout.text.includes('Webcam') && layout.text.includes('indisponible'),
      `${label}: webcam icon or label is missing ${JSON.stringify(layout)}`);
    qaLog(`${label}: p=${layout.portrait.join('x')} client=${layout.client.join('x')} scroll=${layout.scroll.join('x')} webcam=${layout.webcam[2]}px`);
    return layout;
  };

  qaStep('Portraits Messenger : verifier la fenetre normale');
  await inspectLayout('Fenetre normale');
  await capture('messenger-portraits-fixed-normal.png');
  await physicalClick(`${conversation} .maximize-button`);
  await until(() => evaluate(`document.querySelector('${conversation}').classList.contains('window-maximized')`), 'maximized PixelGirl conversation');
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  qaStep('Portraits Messenger : verifier la fenetre maximisee');
  await inspectLayout('Fenetre maximisee');
  await capture('messenger-portraits-fixed-maximized.png');
  await physicalClick(`${conversation} .maximize-button`);
  await until(() => evaluate(`!document.querySelector('${conversation}').classList.contains('window-maximized')`), 'restored PixelGirl conversation');
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  qaStep('Portraits Messenger : fenetre restauree et scenario termine');
}

async function verifyMessengerWindows() {
  qaStep('Messenger : menus, fenêtres indépendantes et géométrie des portraits');
  await command('Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const roster = '[data-messenger-view="contacts"]';
  const pixel = '[data-messenger-contact="pixelgirl"]';
  const skater = '[data-messenger-contact="skater"]';
  const bubble = '[data-messenger-contact="princess"]';
  let rosterMenuStyle;
  const verifyBlueMenus = async (windowSelector, name) => {
    for (let index = 1; index <= 5; index++) {
      const opener = `${windowSelector} .messenger-menu-group:nth-child(${index}) > button`;
      const panel = `${windowSelector} .messenger-menu-group:nth-child(${index}) .messenger-dropdown`;
      await click(opener);
      await until(
        () => evaluate(`!document.querySelector('${panel}').hidden`),
        `${name} Messenger menu ${index} opens`,
      );
      const state = await evaluate(`(()=>{
        const p=document.querySelector('${panel}'),w=document.querySelector('${windowSelector}'),
          b=document.querySelector('${opener}'),s=getComputedStyle(p),r=p.getBoundingClientRect(),wr=w.getBoundingClientRect(),
          items=[...p.querySelectorAll('button')],center=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
        return {hidden:p.hidden,background:s.backgroundImage,border:s.borderTopColor,opacity:s.opacity,
          visible:p.contains(center),bounded:r.left>=wr.left&&r.right<=wr.right&&r.top>=wr.top&&r.bottom<=wr.bottom,
          expanded:b.getAttribute('aria-expanded'),buttonDisabled:b.disabled,windowHidden:w.hidden,
          disabled:items.filter(b=>b.disabled).every(b=>getComputedStyle(b).color==='rgb(105, 126, 145)'),
          separators:items.slice(1).every(b=>getComputedStyle(b).borderTopColor==='rgb(167, 199, 226)')};
      })()`);
      assert.equal(
        state.hidden,
        false,
        `${name} Messenger menu ${index} (${await evaluate(`document.querySelector(${JSON.stringify(opener)}).textContent`)}) should open: ${JSON.stringify(state)}`,
      );
      assert.ok(
        state.background.includes('rgb(225, 242, 255)') &&
          state.background.includes('rgb(198, 226, 248)'),
        'blue gradient covers the open panel',
      );
      assert.equal(state.border, 'rgb(102, 153, 195)');
      assert.equal(state.opacity, '1');
      assert.ok(state.visible && state.bounded && state.disabled && state.separators);
      const shared = [state.background, state.border];
      if (!rosterMenuStyle) rosterMenuStyle = shared;
      assert.deepEqual(
        shared,
        rosterMenuStyle,
        'roster and conversation use the same dropdown skin',
      );
      const option = await evaluate(
        `(()=>{const r=document.querySelector('${panel} button:not(:disabled)').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`,
      );
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', x: option.x, y: option.y });
      assert.ok(
        await evaluate(
          `getComputedStyle(document.querySelector('${panel} button:not(:disabled)')).backgroundImage.includes('rgb(54, 137, 206)')`,
        ),
        'physical hover highlights the actual option',
      );
      await capture(`messenger-menu-${name}-${index}.png`);
      await physicalClick(opener);
      assert.equal(await evaluate(`document.querySelector('${panel}').hidden`), true);
    }
  };
  await click('#windows-start');
  await click('#menu-messenger');
  assert.ok(await evaluate(`!!document.querySelector('${roster} .messenger-contact-list')`));
  const rosterState = await evaluate(
    "JSON.parse(localStorage.getItem('chaos-survival-story-v1'))",
  );
  const order = (await visibleRosterFor(rosterState)).map((contact) => contact.id);
  const assertOrder = async () => {
    for (const online of ['true', 'false']) {
      const ids = await evaluate(
        `[...document.querySelectorAll('${roster} details[data-group="${online}"] [data-contact-id]')].map(row=>row.dataset.contactId)`,
      );
      assert.deepEqual(
        ids,
        order.filter((id) => ids.includes(id)),
      );
    }
    assert.equal(
      await evaluate(`document.querySelectorAll('${roster} [data-contact-id]').length`),
      order.length,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('${roster} .messenger-contact-list').textContent.includes('☺')`,
      ),
      false,
    );
  };
  await assertOrder();
  await verifyBlueMenus(roster, 'roster');
  await capture('messenger-contacts-list.png');
  const saved = await evaluate(
    "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues)",
  );
  const openContact = async (id) =>
    evaluate(
      `document.querySelector('[data-contact-id=${id}]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`,
    );
  for (const id of ['luna', 'turbo']) {
    await openContact(id);
    const selector = `[data-messenger-contact="${id}"]`;
    assert.ok(
      await evaluate(`(()=>{
      const w=document.querySelector('${selector}'),slot=w.querySelector('.msn-webcam-placeholder'),
        portrait=w.querySelector('.conversation-contact-portrait'),img=portrait.querySelector('img');
      return slot && slot.parentElement===portrait && slot.getBoundingClientRect().top>=img.getBoundingClientRect().bottom
        && !slot.matches('button,a,input,video') && !slot.querySelector('button,a,input,video')
        && slot.tabIndex===-1 && !slot.onclick && !w.querySelector('.conversation-return');
    })()`),
      'inactive webcam below unchanged contact avatar',
    );
    await capture(`messenger-refresh-${id}.png`);
    await click(`${selector} .msn-minimize`);
    assert.equal(await evaluate(`document.querySelector('${selector}').hidden`), true);
    await click(`[data-app="messenger:conversation:${id}"]`);
    await click(`${selector} .close-button`);
  }
  await openContact('skater');
  await openContact('princess');
  await openContact('pixelgirl');
  await verifyBlueMenus(pixel, 'pixelgirl');
  assert.equal(await evaluate("document.querySelectorAll('[data-messenger-contact]').length"), 3);
  assert.equal(await evaluate(`document.querySelector('${roster}').hidden`), false);
  assert.equal(await evaluate("!!document.querySelector('#messenger-contacts')"), false);
  assert.equal(
    await evaluate(
      `document.querySelectorAll('${skater} .conversation-message, ${bubble} .conversation-message').length`,
    ),
    0,
  );
  assert.equal(
    await evaluate(
      `document.querySelectorAll('${skater} .dialogue-choice, ${bubble} .dialogue-choice').length`,
    ),
    0,
  );
  assert.equal(await evaluate(`document.querySelectorAll('${pixel} .dialogue-choice').length`), 3);
  assert.equal(
    await evaluate(
      "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).dialogues)",
    ),
    saved,
  );
  await openContact('skater');
  assert.equal(await evaluate("document.querySelectorAll('[data-messenger-contact]').length"), 3);
  await click(`${skater} .msn-minimize`);
  assert.equal(await evaluate(`document.querySelector('${skater}').hidden`), true);
  assert.equal(await evaluate(`document.querySelector('${bubble}').hidden`), false);
  await click('[data-app="messenger:conversation:skater"]');
  assert.equal(await evaluate(`document.querySelector('${skater}').hidden`), false);
  await click(`${skater} .close-button`);
  assert.equal(
    await evaluate('!!document.querySelector(\'[data-app="messenger:conversation:skater"]\')'),
    false,
  );
  await openContact('skater');
  const menuAction = async (windowSelector, group, action) => {
    await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(windowSelector)});
      [...element.querySelectorAll('.messenger-menu-group > button')].find(button => button.textContent === ${JSON.stringify(group)}).click();
      [...element.querySelectorAll('.messenger-dropdown:not([hidden]) button')].find(button => button.textContent === ${JSON.stringify(action)}).click(); })()`);
  };
  assert.equal(
    await evaluate(
      "document.querySelectorAll('[data-msn-action=emoticons], #read-latest, .conversation-reader').length",
    ),
    0,
  );
  assert.equal(
    await evaluate(`document.querySelector('${pixel}').textContent.includes('Dernier message')`),
    false,
  );
  assert.equal(
    await evaluate(
      `document.querySelector('${pixel}').textContent.includes('Choisis une réponse ci-dessous')`,
    ),
    false,
  );
  assert.equal(
    await evaluate(
      `([...document.querySelectorAll('${pixel} .messenger-menu-group > button')].find(button=>button.textContent==='Actions')).hidden`,
    ),
    false,
  );
  await menuAction(pixel, 'Contacts', 'Consulter le profil');
  assert.equal(
    await evaluate('document.querySelector(\'[data-messenger-view^="profile:"] h3\').textContent'),
    'xX_PixelGirl_Xx',
  );
  await click('[data-messenger-view^="profile:"] .close-button');
  const profileContacts = await visibleRosterFor(rosterState);
  for (const id of order) {
    const contact = profileContacts.find((entry) => entry.id === id);
    const { nickname, personalMessage: message, avatar } = contact;
    await click(`[data-contact-id="${id}"]`);
    await menuAction(roster, 'Contacts', 'Consulter le profil');
    const selector = `[data-messenger-view="profile:${id}"]`;
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).querySelector('.messenger-profile img').decode()`,
    );
    const profile =
      await evaluate(`(() => {const panel=document.querySelector(${JSON.stringify(selector)}), image=panel.querySelector('.messenger-profile img'), row=document.querySelector('[data-contact-id="${id}"]');return {
      nickname:panel.querySelector('h3').textContent,status:panel.querySelector('.profile-status').textContent,
      message:panel.querySelector('.profile-message').textContent, hidden:panel.querySelector('.profile-message').hidden,
      avatar:image.getAttribute('src'), loaded:image.naturalWidth>0, rowAvatar:row.querySelector('img').getAttribute('src'), rowText:row.textContent,
      imagePerso:panel.textContent.includes('Image perso'),
      gradient:getComputedStyle(panel.querySelector('.profile-header')).backgroundImage,
      frame:getComputedStyle(panel.querySelector('.profile-avatar-frame')).borderStyle,
      width:panel.offsetWidth,height:panel.offsetHeight,
      overflow:panel.querySelector('.messenger-profile').scrollWidth>panel.querySelector('.messenger-profile').clientWidth,
      fields:panel.querySelector('.messenger-profile').querySelectorAll('img,h3,p').length};})()`);
    assert.equal(profile.nickname, nickname);
    assert.equal(profile.status, contact.status);
    assert.equal(profile.message, message);
    assert.equal(profile.hidden, !message);
    assert.equal(profile.avatar, avatar);
    assert.equal(profile.rowAvatar, profile.avatar);
    assert.equal(profile.loaded, true);
    assert.ok(profile.rowText.includes(message));
    assert.equal(profile.imagePerso, false);
    assert.ok(profile.gradient.includes('linear-gradient'));
    assert.equal(profile.frame, 'solid');
    assert.equal(profile.fields, 4);
    assert.equal(profile.overflow, false);
    assert.ok(profile.height < 260 && profile.width <= 430);
    await menuAction(roster, 'Contacts', 'Consulter le profil');
    assert.equal(
      await evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`),
      1,
    );
    await capture(`messenger-profile-${id}.png`);
    await physicalDrag(`${selector} .titlebar`, 500, 180);
    assert.ok(
      Math.abs(
        (await evaluate(
          `parseFloat(document.querySelector(${JSON.stringify(selector)}).style.left)`,
        )) - 500,
      ) < 6,
    );
    await click(`${selector} .close-button`);
  }
  await assertOrder();
  await menuAction(pixel, 'Actions', 'Émoticônes');
  assert.ok(
    await evaluate(`(()=>{
    const buttons=[...document.querySelectorAll('[data-messenger-view=emoticons] .messenger-emoticons button')];
    const cat=buttons.find(b=>b.textContent===':3');
    return cat && !cat.querySelector('.msn-emoticon');
  })()`),
    ':3 remains a textual shortcut in the emoticon palette',
  );
  await click('[data-messenger-view=emoticons] .messenger-emoticons button');
  assert.equal(await evaluate("document.querySelector('.emoticon-preview').textContent"), ':)');
  await click('[data-messenger-view=emoticons] .close-button');
  const existingWizz = await evaluate(
    `document.querySelectorAll('${pixel} .conversation-system').length`,
  );
  await menuAction(pixel, 'Actions', 'Wizz !');
  assert.equal(
    await evaluate(`document.querySelector('${pixel}').classList.contains('messenger-wizz')`),
    true,
  );
  const playerNickname = JSON.parse(
    await readFile(path.join(root, 'src/config/player.json')),
  ).nickname;
  const wizzText = `${playerNickname} vous a envoyé un wizz !`;
  async function wizzCount() {
    return evaluate(
      `([...document.querySelectorAll('${pixel} .conversation-system')]).filter(row=>row.textContent===${JSON.stringify(wizzText)}).length`,
    );
  }
  assert.equal(await wizzCount(), existingWizz + 1);
  await click(`${pixel} [data-msn-action=wizz]`);
  await menuAction(pixel, 'Actions', 'Wizz !');
  assert.equal(
    await wizzCount(),
    existingWizz + 1,
    'the button and Actions menu cannot send another Wizz during cooldown',
  );
  assert.equal(await evaluate(`document.querySelector('${pixel} [data-msn-action=wizz]').disabled`), true);
  await wait(5200);
  assert.equal(await evaluate(`document.querySelector('${pixel} [data-msn-action=wizz]').disabled`), false);
  await menuAction(pixel, 'Actions', 'Wizz !');
  assert.equal(await wizzCount(), existingWizz + 2);
  const systemStyle = await evaluate(
    `(() => {const style=getComputedStyle(document.querySelector('${pixel} .conversation-system'));return {align:style.textAlign,color:style.color};})()`,
  );
  assert.equal(systemStyle.align, 'center');
  await click(`${pixel} .close-button`);
  await openContact('pixelgirl');
  assert.equal(await wizzCount(), existingWizz + 2);
  assert.equal(
    await evaluate(`document.querySelector('${skater} [data-msn-action=wizz]').disabled`),
    true,
  );
  await menuAction(pixel, 'Outils', 'Options de Messenger');
  await evaluate(
    "const input = document.querySelector('.messenger-volume'); input.value = 37; input.dispatchEvent(new Event('input')); ",
  );
  await click('[data-messenger-view=options] .close-button');
  await menuAction(pixel, 'Outils', 'Options de Messenger');
  assert.equal(await evaluate("document.querySelector('.messenger-volume').value"), '37');
  await click('[data-messenger-view=options] .close-button');
  await menuAction(pixel, 'Aide', 'À propos');
  assert.ok(
    await evaluate(
      "document.querySelector('[data-messenger-view=about]').textContent.includes('2009')",
    ),
  );
  await click('[data-messenger-view=about] .close-button');
  await evaluate(`document.querySelector('${pixel} .messenger-menu-group > button').focus();`);
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown' });
  assert.equal(
    await evaluate(
      `document.querySelectorAll('${pixel} .messenger-dropdown:not([hidden])').length`,
    ),
    1,
  );
  await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  assert.equal(
    await evaluate(
      `document.querySelectorAll('${pixel} .messenger-dropdown:not([hidden])').length`,
    ),
    0,
  );
  await click(`${pixel} .messenger-menu-group > button`);
  await evaluate(
    `document.querySelector('${pixel} .contact-name').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));`,
  );
  assert.equal(
    await evaluate(
      `document.querySelectorAll('${pixel} .messenger-dropdown:not([hidden])').length`,
    ),
    0,
  );
  await menuAction(roster, 'Fichier', 'Fermer la fenêtre');
  assert.equal(await evaluate(`!!document.querySelector('${roster}')`), false);
  assert.equal(await evaluate(`!!document.querySelector('${pixel}')`), true);
  await click(`${pixel} .close-button`);
  await click(`${skater} .close-button`);
  await click(`${bubble} .close-button`);
  const historyBefore = await evaluate(
    "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).conversations.pixelgirl.history.length",
  );
  await evaluate(
    "document.querySelector('[data-shortcut=arcade]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))",
  );
  await until(() => evaluate("window.chaosDebug.snapshot().phase==='playing'"), 'replay started');
  await until(
    () =>
      evaluate(
        "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).replayReactions.at(-1)?.ready===true",
      ),
    'closed-window replay becomes ready during gameplay',
    10000,
  );
  assert.equal(
    await evaluate(
      `JSON.parse(localStorage.getItem('chaos-survival-story-v1')).conversations.pixelgirl.history.length > ${historyBefore}`,
    ),
    false,
    'replay messages wait until the game returns to the desktop',
  );
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='ended'"),
    'replay level finishes',
    60000,
  );
  await click('#dialog-secondary');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='desktop'"),
    'desktop after replay',
  );
  await until(
    () =>
      evaluate(
        `JSON.parse(localStorage.getItem('chaos-survival-story-v1')).conversations.pixelgirl.history.length > ${historyBefore}`,
      ),
    'replay received with Messenger closed',
    10000,
  );
  await click('#windows-start');
  await click('#menu-messenger');
  await openContact('pixelgirl');
  await until(
    () =>
      evaluate(
        `document.querySelector('${pixel} .conversation-log').textContent.includes('et bah !!!')`,
      ),
    'replay in unique history',
  );
  // The replay was delivered while Messenger was closed, then read when the
  // conversation was opened. Minimizing that already-read conversation must
  // not recreate an unread indication.
  await physicalClick(`${pixel} .msn-minimize`);
  assert.equal(
    await evaluate(`document.querySelector('${pixel}').hidden`),
    true,
    'the PixelGirl conversation is minimized after its replay has been read',
  );
  await click('#windows-start');
  await click('#menu-messenger');
  await evaluate("window.__contactRow = document.querySelector('[data-contact-id=pixelgirl]')");
  const readReplayState = await evaluate(`(()=>{
    const app=document.querySelector('[data-app="messenger:conversation:pixelgirl"]');
    return {unread:app.classList.contains('messenger-unread'),title:app.title,
      unreadKeys:JSON.parse(localStorage.getItem('chaos-survival-story-v1')).conversations.pixelgirl.unread};
  })()`);
  assert.deepEqual(
    readReplayState,
    { unread: false, title: 'xX_PixelGirl_Xx', unreadKeys: [] },
    'the already-read replay does not become unread again when its window is minimized',
  );
  assert.equal(
    await evaluate("window.__contactRow === document.querySelector('[data-contact-id=pixelgirl]')"),
    true,
  );
  await click('[data-app="messenger:conversation:pixelgirl"]');
  assert.equal(
    await evaluate(`document.querySelector('${pixel}').hidden`),
    false,
    'the task button restores the minimized conversation',
  );
  await until(
    () => evaluate(`document.querySelectorAll('${pixel} .dialogue-choice').length===3`),
    'original unanswered choices preserved after message-only replay',
  );
  await capture('messenger-independent-windows.png');
  const portraitLayout = await evaluate(`(()=>{
    const w=document.querySelector('${pixel}'),p=w.querySelector('.conversation-portraits'),
      r=p.getBoundingClientRect(),imgs=[...p.querySelectorAll('img')];
    return {viewport:[innerWidth,innerHeight],portrait:[r.x,r.y,r.width,r.height],images:imgs.map(img=>{
      const a=img.getBoundingClientRect();return [a.x,a.y,a.width,a.height];}),
      scroll:[p.scrollWidth,p.clientWidth,p.scrollHeight,p.clientHeight,getComputedStyle(p).overflowY],
      returnControl:!!w.querySelector('.conversation-return'),webcamTabIndex:w.querySelector('.msn-webcam-placeholder').tabIndex};
  })()`);
  assert.ok(
    portraitLayout.images.length===2&&portraitLayout.images.every(([, ,width,height])=>
      width>0&&height>0&&Math.abs(width-height)<1)
      &&portraitLayout.images.every(([x, ,width])=>
        x>=portraitLayout.portrait[0]&&x+width<=portraitLayout.portrait[0]+portraitLayout.portrait[2])
      &&portraitLayout.scroll[0]<=portraitLayout.scroll[1]
      &&portraitLayout.scroll[1]>0
      &&portraitLayout.scroll[2]>=portraitLayout.scroll[3]
      &&portraitLayout.scroll[4]==='auto'
      && !portraitLayout.returnControl && portraitLayout.webcamTabIndex===-1,
    `both avatars remain square and accessible in the scrollable portrait column: ${JSON.stringify(portraitLayout)}`,
  );
  const conversationSize = await evaluate(
    `(()=>{const w=document.querySelector('${pixel}');const size=[w.style.width,w.style.height];w.style.width='500px';w.style.height='460px';return size;})()`,
  );
  await wait(100);
  assert.ok(
    await evaluate(`(()=>{const w=document.querySelector('${pixel}'),p=w.querySelector('.conversation-portraits'),h=w.querySelector('.conversation-history');
    return p.getBoundingClientRect().bottom<=w.querySelector('.msn-tools').getBoundingClientRect().top
      && h.clientWidth>200 && w.querySelector('.window-body').scrollWidth<=w.querySelector('.window-body').clientWidth;
  })()`),
    'resized conversation keeps messages and portrait column inside the window',
  );
  await capture('messenger-refresh-small.png');
  await evaluate(
    `(()=>{const w=document.querySelector('${pixel}');[w.style.width,w.style.height]=${JSON.stringify(conversationSize)};})()`,
  );
  await wait(100);
  const history = await evaluate(
    "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).conversations.pixelgirl.history)",
  );
  await click(`${pixel} .close-button`);
  await openContact('pixelgirl');
  assert.equal(
    await evaluate(
      "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).conversations.pixelgirl.history)",
    ),
    history,
  );
  const launches = await evaluate(
    "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).level1Launches",
  );
  await command('Page.reload');
  await until(() => evaluate("window.chaosDebug?.snapshot().phase==='menu'"), 'restart menu');
  await click('#menu-play');
  await until(
    () => evaluate(`!!document.querySelector('${pixel} .conversation-log')`),
    'restored narrative chat',
  );
  assert.equal(
    await evaluate(
      "JSON.stringify(JSON.parse(localStorage.getItem('chaos-survival-story-v1')).conversations.pixelgirl.history)",
    ),
    history,
  );
  assert.equal(
    await evaluate("JSON.parse(localStorage.getItem('chaos-survival-story-v1')).level1Launches"),
    launches,
  );
  assert.equal(await evaluate(`document.querySelectorAll('${pixel} .dialogue-choice').length`), 3);
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  console.log(
    `OK: ${visibleMessengerOnly ? 'Electron visible' : 'Chromium'} independent roster/conversations, taskbar restore/close, profiles, menus, options, emoticons, Wizz and closed-window replay reception with preserved history/choices.`,
  );
  assert.equal(
    await evaluate(
      "document.querySelectorAll('.session-info,.session-dot,#session-label,#window-count').length",
    ),
    0,
  );
  assert.equal(
    await evaluate(
      "(() => {const clock=document.querySelector('.tray #clock');return !!clock?.textContent&&clock.getBoundingClientRect().width>0;})()",
    ),
    true,
  );
}

async function verifyRulesFlow() {
  await click('#menu-play');
  await until(() => evaluate("!!document.querySelector('.rules-confirm')"), 'arcade first rules');
  assert.equal(await evaluate('window.chaosDebug.snapshot().phase'), 'rules');
  assert.equal(await evaluate('window.chaosDebug.snapshot().audioTime'), 0);
  assert.equal(await evaluate('window.chaosDebug.snapshot().launches'), 0);
  assert.equal(await evaluate("document.querySelectorAll('#playfield .popup').length"), 0);
  await wait(300);
  assert.equal(await evaluate('window.chaosDebug.snapshot().audioTime'), 0);
  await click('.rules-confirm');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='playing'"),
    'arcade starts after confirmation',
  );
  assert.equal(
    await evaluate(
      "JSON.parse(localStorage.getItem('chaos-survival-story-v1')).tutorials['arcade-1']",
    ),
    true,
  );
  await click('#help-button');
  await until(
    () =>
      evaluate(
        "!!document.querySelector('.rules-confirm')&&window.chaosDebug.snapshot().phase==='paused'",
      ),
    'voluntary rules pause',
  );
  const time = await evaluate('window.chaosDebug.snapshot().audioTime');
  await wait(300);
  assert.equal(await evaluate('window.chaosDebug.snapshot().audioTime'), time);
  await click('.rules-confirm');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='playing'"),
    'controlled resume',
  );
  await click('#windows-start');
  assert.equal(await evaluate("!!document.querySelector('#menu-help')"), false);
  await click('#start-menu-main');
  await click('#menu-play');
  await until(
    () => evaluate("window.chaosDebug.snapshot().phase==='playing'"),
    'continue without mandatory rules',
  );
  assert.equal(await evaluate("!!document.querySelector('.rules-layer')"), false);
  await click('#windows-start');
  await click('#start-menu-main');
  await verifyMiniGameLaunch();
  console.log(
    'OK: first arcade rules before audio, persisted approval, direct replay, paused voluntary review, Smiley tutorial and Start menu cleanup.',
  );
}
