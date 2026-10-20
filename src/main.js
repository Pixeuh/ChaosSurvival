import './styles.css';
import './styles-story.css';
import './styles-menu.css';
import './styles-buddy.css';
import './styles-browser.css';
import './styles-media-player.css';
import './styles-toolbar-installer.css';
import './styles-smiley-pack-installer.css';
import './browser/sites/skypage/styles.css';
import './browser/sites/forumjeu/styles.css';
import './browser/sites/flashzone/styles.css';
import './browser/sites/videotube/styles.css';
import './browser/sites/wiki/styles.css';
import './browser/sites/hopla-hotel/styles.css';
import { InternetAdventurer } from './ui/browser.js';
import { HoplaHotelClient } from './browser/sites/hopla-hotel/client.js';
import { Buddy } from './ui/buddy.js';
import chart from './config/chart.json';
import music from './config/music-lvl1.analysis.json';
import { AudioEngine } from './audio/engine.js';
import { Timeline, compileChart, isOnBeat } from './game/timeline.js';
import { musicAt } from './game/music.js';
import { BeginnerDirector } from './game/director.js';
import { WINDOW_TYPES } from './config/popups.js';
import { GameState } from './game/state.js';
import { WindowManager } from './ui/windows.js';
import { bindFileActivation } from './utils/activation.js';
import { icon } from './ui/icons.js';
import { mountDesktop, updateRhythmHud } from './ui/desktop.js';
import { GameRules } from './ui/game-rules.js';
import { DesktopFiles } from './ui/desktop-files.js';
import { MiniGameLauncher } from './ui/minigame-launcher.js';
import { DesktopIcons } from './ui/desktop-icons.js';
import { WindowsXdContextMenus } from './ui/windows-xd-context-menu.js';
import { StartMenuOrder } from './ui/start-menu-order.js';
import { quitFromStartMenu, returnFromStartMenu } from './ui/start-menu-actions.js';
import { TaskbarOrder } from './ui/taskbar-order.js';
import { DesktopApplications } from './ui/desktop-apps.js';
import { setHideKnownExtensions } from './ui/file-names.js';
import { createExecutableLauncher } from './ui/executable-launcher.js';
import { WindowsMediaPlay } from './ui/media-player.js';
import { ToolbarInstaller } from './ui/toolbar-installer.js';
import { SmileyPackInstaller } from './ui/smiley-pack-installer.js';
import { arcadeLauncher } from './ui/arcade-launcher.js';
import { createMusicToggle } from './ui/music-toggle.js';
import story from './config/story.json';
import pixelgirlDialogue from './dialogues/pixelgirl-intro.json';
import { Progression } from './story/progression.js';
import { VirtualTextFiles } from './story/text-files.js';
import { VirtualFilesystem, virtualFileId } from './story/virtual-filesystem.js';
import { ConversationWindow } from './ui/conversation.js';
import { Messenger, identifyMessageSender, wizzNotificationContent } from './ui/messenger.js';
import { ConversationThread } from './story/conversation-thread.js';
import { celebrateVictory } from './ui/victory.js';
import { DesktopSounds } from './audio/sounds.js';
import { dialogues } from './story/catalog.js';
import { miniGames } from './ui/minigame.js';
import { MainMenu } from './ui/main-menu.js';
import { MenuMusic } from './audio/menu-music.js';
import { UserSettings, deleteUserData } from './settings.js';
import {
  queueArcadeVictory,
  pendingArcadeVictory,
  acknowledgeArcadeVictory,
} from './story/arcade.js';
import replayConfig from './config/replay-reactions.json';
import connectionMessageConfig from './config/connection-messages.json';
import { ReplayReactions } from './story/replays.js';
import { ConnectionMessages } from './story/connection-messages.js';
import { DialogueEvents } from './story/dialogue-events.js';
import { OptionalConversations } from './story/optional-conversations.js';
import {
  NarrativeOrchestrator,
  DEFERRED_CONNECTION_DIALOGUES,
} from './story/narrative-orchestrator.js';
import { bombArenaHandoffPending, createBombArenaHandoffRetrier } from './story/bomb-arena-handoff.js';
import { resetGameToInitialState as resetSession, recoverGameReset } from './story/reset-game.js';
import { applicationName, trackIdentity } from './ui/identity.js';
import {
  NotificationCenter,
  ENTER_ANIMATION_MS,
  NOTIFICATION_DURATION_MS,
} from './ui/notifications.js';

const BEST_SCORE_KEY = 'chaos-survival-best';
const DEFAULT_VOLUME = 0.55;
const MIN_CONNECTION_TOAST_VISIBLE_MS = 3000;
const SYNC_OFFSET_KEY = `chaos-sync-${music.source.sha256}`;
let storyStorage;
try {
  storyStorage = localStorage;
  recoverGameReset(storyStorage);
} catch {
  storyStorage = undefined;
}
let syncOffset = 0;
try {
  syncOffset = Math.max(-0.5, Math.min(0.5, Number(storyStorage?.getItem(SYNC_OFFSET_KEY)) || 0));
} catch {
  /* Calibration is optional. */
}

let best = 0;
try {
  best = Number(storyStorage?.getItem(BEST_SCORE_KEY)) || 0;
} catch {
  /* Storage can be unavailable in private browsing. */
}

const ui = mountDesktop(document.getElementById('app'), best);

const state = new GameState(chart.gameplay);
const audio = new AudioEngine(chart.volume);
const notifications = new NotificationCenter({
  root: ui.toast,
  contact: ui.toastContact,
  message: ui.toastMessage,
  dismissButton: ui.dismissToast,
  messageRoot: ui.messageToastStack,
  messageTemplate: ui.messageToastTemplate,
  getTime: (clock) => (clock === 'game' ? audio.time * 1000 : Date.now()),
});
const progression = new Progression(story, storyStorage);
setHideKnownExtensions(progression.data.explorerPreferences?.hideKnownExtensions !== false);
const optionalConversations = new OptionalConversations(progression, dialogues);
const virtualFilesystem = new VirtualFilesystem(progression);
const buddy = new Buddy(ui.desktop, progression);
const replayReactions = new ReplayReactions(progression, dialogues, replayConfig);
const settings = new UserSettings(storyStorage, chart.volume);
const menuMusic = new MenuMusic(() => settings.data.musicVolume);
audio.setVolume(settings.data.musicVolume);
let arcadeSequenceId = 'arcade-1';
let arcadeReplay = false;
const sounds = new DesktopSounds(
  () => settings.data.effectsVolume,
  () => (menuMusic.active || phase === 'paused' ? menuMusic.context : audio.context),
);
let cancelVictory = () => {};
let timeline;
let configurationError;
let director;
try {
  timeline = new Timeline(compileChart(chart, music));
  director = new BeginnerDirector(chart.gameplay);
} catch (error) {
  configurationError = error;
}
let phase = 'idle';
function setPhase(next) {
  phase = next;
  updateRhythmHud(ui, phase);
  buddy.setActive(next !== 'menu');
}
let duration = chart.durationSeconds;
let lastTime = 0;
let frame = 0;
let wizzUntil = 0;
let sparkleUntil = -Infinity;
let lastLateness = null;
let maxLateness = 0;
let pauseGeneration = 0;
let action = () => {};
let secondaryAction = () => {};
let previousVolume = chart.volume;
const manager = new WindowManager(ui.playfield, ({ preview, x, y, openedAt }) => {
  // System applications leave arcade windows interactive during their controlled pause.
  // Retire every actual closure, including the asynchronous resume transition.
  if (preview || !['playing', 'paused', 'resuming'].includes(phase)) return;
  const onBeat = isOnBeat(audio.time - syncOffset, chart, music);
  director.closed(audio.time, openedAt);
  const points = state.close(onBeat);
  feedback(x, y, points, onBeat);
  renderStats();
});
let activeDialogue = pixelgirlDialogue;
let conversation = createConversation(activeDialogue);
let plumberGroupThread;
let mediaPlayer;
let k7ConversationThread;
const launchExecutable = createExecutableLauncher({
  'windows-love-messenger': () => openMessenger(),
  'internet-adventurer': () => openBrowser(),
  'windows-media-play': (file, fileId) => launchMediaPlay(file, fileId),
  'toolbar-installer': (_file, fileId) => toolbarInstaller.open(fileId),
  'smiley-pack-installer': (_file, fileId) => smileyPackInstaller.open(fileId),
});
let bombArenaHandoffRetrier;
const desktopApplications = new DesktopApplications(
  manager,
  ui.desktop.querySelector('.taskbar'),
  syncSystemWindows,
  replayLevelOne,
  new VirtualTextFiles(progression, virtualFilesystem),
  virtualFilesystem,
  renderDesktopFiles,
  openDesktopFile,
  launchExecutable,
  (event) => narrativeOrchestrator?.onBombArenaEvent(event),
  (instance) => {
    manager.close(instance.id);
    return tryOpenBombArenaGroupConversation();
  },
  () => tryOpenBombArenaGroupConversation(),
);
mediaPlayer = new WindowsMediaPlay(manager, desktopApplications, virtualFilesystem);
const toolbarInstaller = new ToolbarInstaller(manager, desktopApplications);
let narrativeOrchestrator;
let turboConversationThread;
const turboEvents = () =>
  Object.values(dialogues)
    .filter(
      (event) =>
        event.contact.name === dialogues['turbo-smiley-catcher'].contact.name &&
        narrativeOrchestrator?.isEventAvailable(event),
    )
    .sort((a, b) => narrativeOrchestrator?.compareEvents(a, b) ?? 0);
const getTurboThread = () =>
  (turboConversationThread ??= new ConversationThread('turbo', progression, turboEvents));
const getK7Thread = () =>
  (k7ConversationThread ??= new ConversationThread(
    'k7',
    progression,
    () => optionalConversations.entries
      .filter((entry) => entry.contactId === 'k7')
      .map((entry) => dialogues[entry.id]
        ? { ...dialogues[entry.id], deliveryPolicy: entry.deliveryPolicy }
        : null)
      .filter(Boolean),
    (event) => optionalConversations.isAvailable(event.id),
  ));
const connectionMessages = new ConnectionMessages(
  progression,
  dialogues,
  connectionMessageConfig,
  (threadId) => threadId === 'pixelgirl'
    ? replayReactions.thread
    : threadId === 'turbo'
      ? getTurboThread()
      : threadId === 'k7'
        ? getK7Thread()
      : null,
);
const plumberGroupEvents = () => {
  const postMatchAvailable = narrativeOrchestrator?.bombArenaPostMatchAvailable() ?? false;
  const postMatchState = progression.data.dialogues['bomb-arena-postmatch'];
  const postMatchActive = postMatchAvailable && !postMatchState?.finished;
  return [
    dialogues['pixelgirl-super-plombier-group'],
    ...(postMatchAvailable ? [dialogues['bomb-arena-postmatch']] : []),
    ...(postMatchActive ? [] : narrativeOrchestrator?.bombArenaRedownloadEvents() ?? []),
    ...(narrativeOrchestrator?.bombArenaReminderEvents() ?? []),
  ];
};
const hoplaHotel = new HoplaHotelClient(manager, desktopApplications, () =>
  openBrowser('http://www.hoplahotel.fr/'),
  () => settings.data.musicVolume,
);
const browser = new InternetAdventurer(
  manager,
  desktopApplications,
  progression,
  undefined,
  () => hoplaHotel.open(),
  () => hoplaHotel.stopMusic(),
  (address) => {
    try {
      if (new URL(address).hostname !== 'www.hoplahotel.fr') hoplaHotel.stopMusic();
    } catch {
      hoplaHotel.stopMusic();
    }
  },
);
const messenger = new Messenger({
  manager,
  applications: desktopApplications,
  progression,
  sounds,
  definitions: () => dialogues,
  primary: () => conversation,
  settings,
  onWindowState: syncSystemWindows,
  onMessage: (contact, incoming, messages, view, state) =>
    handleMessengerMessage(contact, incoming, messages, view, state),
  onContactOpened: (contact) => {
    notifications.cancelContact(contact.id, 'message');
    notifications.cancel(`connection:${contact.id}`);
    narrativeOrchestrator?.onContactOpened(contact);
  },
  createConversation: (contact) => {
    const definition = dialogues[contact.dialogue] ?? pixelgirlDialogue;
    const thread =
      contact.id === 'plumber-group'
        ? (plumberGroupThread ??= new ConversationThread('plumber-group', progression, () => [
            ...plumberGroupEvents(),
          ]))
        : contact.id === 'turbo'
          ? getTurboThread()
          : contact.kind === 'decorative' || !dialogues[contact.dialogue]
          ? replayReactions.thread
          : new ConversationThread(contact.id, progression, () =>
              Object.values(dialogues)
                .filter(
                  (event) =>
                    event.contact.name === definition.contact.name &&
                    narrativeOrchestrator?.isEventAvailable(event),
                )
                .sort((a, b) => narrativeOrchestrator?.compareEvents(a, b) ?? 0),
            );
    return createConversation(definition, contact.id, thread);
  },
});
const smileyPackInstaller = new SmileyPackInstaller(manager, desktopApplications);
function handleMessengerMessage(contact, incoming = [], messages = [], view, state = {}) {
  if (!contact) return;
  narrativeOrchestrator?.onMessage(contact, incoming);
  if (state.active ?? (view && messenger.isConversationActive(view))) return;
  const wizz = messages.find((message) => message.type === 'wizz' && message.speaker === 'contact');
  if (wizz) {
    const { sender, preview } = wizzNotificationContent(contact);
    notifications.showMessage({
      conversationId: contact.id,
      senderId: contact.id,
      sender,
      preview,
      durationMs: NOTIFICATION_DURATION_MS,
      action: () => {
        const target = messenger.contacts().find((item) => item.id === contact.id);
        if (target) messenger.openContact(target);
      },
    });
    return;
  }
  if (!messages.length) {
    if (incoming.length) sounds.unlock().then(() => sounds.play('message'));
    showMessageNotification(contact, messageNotificationId(contact));
    return;
  }
  for (const message of messages) {
    if (message.speaker !== 'contact') continue;
    const { id: senderId, name: sender } = identifyMessageSender(contact, message);
    if (!senderId || !sender) continue;
    notifications.showMessage({
      conversationId: contact.id,
      senderId,
      sender,
      preview: message.text,
      durationMs: NOTIFICATION_DURATION_MS,
      action: () => {
        const target = messenger.contacts().find((entry) => entry.id === contact.id);
        if (target) messenger.openContact(target);
      },
      playSound: () => sounds.unlock().then(() => sounds.play('message')),
    });
  }
}
const rules = new GameRules(ui.desktop, progression);
function prepareMiniGameLaunch() {
  if (progression.current?.dialogue !== pixelgirlDialogue.id) return;
  progression.complete(progression.current.id, { dialogue: activeDialogue.id });
  if (conversation.element?.isConnected)
    manager.close(Number(conversation.element.dataset.windowId));
}
const miniGameLauncher = new MiniGameLauncher(
  miniGames,
  progression,
  manager,
  sounds,
  prepareMiniGameLaunch,
  rules,
  () => {
    if (progression.current?.type === 'conversation')
      activeDialogue = dialogues[progression.current.dialogue];
  },
  undefined,
  (file) => virtualFilesystem.exists(virtualFileId('downloads', file.name)),
  (game) => {
    const windowId = Number(game.element?.dataset.windowId);
    if (!Number.isInteger(windowId)) return;
    desktopApplications.attachExistingWindow(
      `mini-game:${game.definition.id}`,
      windowId,
      game.element.querySelector('.window-title > span').textContent,
      'music',
    );
  },
);
const dialogueEvents = new DialogueEvents(
  progression,
  dialogues,
  (contactId, connectedAt) => narrativeOrchestrator?.onContactConnected(contactId, connectedAt),
  { deferredConnectionDialogues: DEFERRED_CONNECTION_DIALOGUES },
);
narrativeOrchestrator = new NarrativeOrchestrator({
  progression,
  definitions: dialogues,
  dialogueEvents,
  getContact: (contactId) => messenger.contacts().find((entry) => entry.id === contactId),
  prepareContact: (contact) => messenger.prepareContact(contact),
  ensureBackground: (contact) => messenger.ensureBackground(contact),
  connectionMessages,
  optionalConversations,
  showConnectionNotification: (contactId, options) => {
    const contact = messenger.contacts().find((entry) => entry.id === contactId);
    if (!contact) return;
    showContactConnectionNotification(contact, options);
    sounds.unlock().then(() => sounds.play('online'));
  },
  sendWizz: (contactId, eventId, speaker, now) =>
    messenger.sendWizz(contactId, { eventId, speaker, now }),
  getGroupThread: () => {
    plumberGroupThread ??= new ConversationThread('plumber-group', progression, plumberGroupEvents);
    return plumberGroupThread;
  },
  getTurboThread,
  getK7Thread,
  onTurboMessage: (contact, incoming, messages) => {
    if (!contact) return;
    messenger.receiveIncoming(contact, incoming, messages ?? []);
  },
  onK7Message: (contact, incoming, messages) => {
    if (!contact) return;
    messenger.receiveIncoming(contact, incoming, messages ?? []);
  },
  onGroupMessage: (contact, incoming, messages) => {
    if (!contact) return;
    messenger.receiveIncoming(contact, incoming, messages ?? []);
  },
  virtualFilesystem,
  showGroupNotification: (contact) => {
    if (!contact) return false;
    messenger.ensureBackground(contact);
    const id = 'group:super-plombier';
    const shown = notifications.show({
      id,
      type: 'message',
      contactId: 'plumber-group',
      contact: 'Windows Love Messenger',
      message: 'PixelGirl vous a ajouté à une conversation de groupe',
      durationMs: NOTIFICATION_DURATION_MS,
      clock: 'game',
      policy: 'queue',
      priority: 'important',
      action: () => {
        const group = messenger.contacts().find((entry) => entry.id === 'plumber-group');
        if (group) openConversation(false, group);
      },
    });
    return shown || notifications.has(id);
  },
});
bombArenaHandoffRetrier = createBombArenaHandoffRetrier({
  progression,
  onBombArenaEvent: (event) => narrativeOrchestrator.onBombArenaEvent(event),
  activateGroup: () => phase === 'desktop' && tryOpenBombArenaGroupConversation(),
});
virtualFilesystem.onDelete = (change) => {
  narrativeOrchestrator?.onVirtualFilesDeleted(change);
  mediaPlayer?.onFilesDeleted(change);
};
browser.onSuperPlombierStart = () => narrativeOrchestrator.onSuperPlombierStart();
browser.onSuperPlombierVictory = () => narrativeOrchestrator.onSuperPlombierVictory();
let restoringStory = false;
function createConversation(dialogue, contactId = 'pixelgirl', thread = replayReactions.thread) {
  return new ConversationWindow(
    manager,
    dialogue,
    progression,
    sounds,
    (id) => {
      if (progression.current?.type === 'conversation' && progression.current.dialogue === id) {
        progression.complete(progression.current.id, { dialogue: id });
        if (progression.current) progression.enterCurrent().catch(showStoryError);
      }
    },
    () => {
      renderDesktopFiles();
      mediaPlayer?.syncTracks();
    },
    (id) => {
      if (progression.current?.type === 'conversation' && progression.current.dialogue === id) {
        progression.complete(progression.current.id, { dialogue: id });
      }
    },
    {
      thread,
      manageWindow: (view) => messenger.attachConversation(view, contactId),
      onDispose: (view, dismissal) => messenger.disposeConversation(view, dismissal),
      onContactsRequested: () => messenger.open(),
      onChoiceValidated: (definition, details) =>
        narrativeOrchestrator.onChoiceValidated(definition, details),
      onTransferDeclined: ({ file, dialogueId }) =>
        narrativeOrchestrator.onBombArenaTransferDeclined(file, dialogueId),
      onLink: (url) => {
        narrativeOrchestrator.onLink(url);
        openBrowser(url);
      },
      isUnlocked: () => narrativeOrchestrator.isConversationUnlocked(dialogue.id),
      onWindowState: syncSystemWindows,
    },
  );
}

function openBombArenaGroupConversation() {
  const group = messenger.contacts().find((contact) => contact.id === 'plumber-group');
  if (!group) return false;
  const view = messenger.openContact(group);
  return Boolean(view?.element?.isConnected);
}

function tryOpenBombArenaGroupConversation() {
  try {
    const opened = openBombArenaGroupConversation();
    if (!opened) bombArenaHandoffRetrier?.schedule();
    return opened;
  } catch (error) {
    console.error('[BombArena] Messenger could not open the saved group; retrying.', error);
    bombArenaHandoffRetrier?.schedule();
    return false;
  }
}

function messageNotificationId(contact) {
  const unread = progression.data.conversations?.[contact.id]?.unread;
  const key = Array.isArray(unread) ? unread.filter((item) => typeof item === 'string').join('|') : '';
  return `message:${contact.id}:${key || 'unread'}`;
}

function showMessageNotification(contact, id = messageNotificationId(contact), onShow, delayMs = 0) {
  if (!messenger.contacts().some((item) => item.id === contact.id)) return;
  notifications.show({
    id,
    type: 'message',
    contactId: contact.id,
    contact: contact.nickname,
    message: contact.id === 'turbo' ? ' vous a envoy\u00e9 un message' : 't\u2019a envoy\u00e9 un nouveau message.',
    durationMs: NOTIFICATION_DURATION_MS,
    clock: 'real',
    policy: 'queue',
    priority: 'important',
    delayMs,
    delayClock: delayMs > 0 ? 'real' : 'game',
    action: () => {
      const target = messenger.contacts().find((item) => item.id === contact.id);
      if (target) openConversation(false, target);
    },
    onShow,
  });
}

function showContactConnectionNotification(contact, options = {}) {
  const contactId = contact.id;
  const displayDurationMs = Math.max(
    options.durationMs ?? (contactId === 'turbo' ? 700 : 6000),
    ENTER_ANIMATION_MS + MIN_CONNECTION_TOAST_VISIBLE_MS,
  );
  notifications.show({
    id: `connection:${contactId}`,
    type: 'connection',
    contactId,
    contact: contact.nickname,
    message: ' vient de se connecter',
    durationMs: displayDurationMs,
    clock: 'real',
    policy: 'queue',
    priority: 'important',
    action: () => {
      const target = messenger.contacts().find((entry) => entry.id === contactId);
      if (target) openConversation(false, target);
    },
    onDismiss: (reason, timing) => {
      options.onDismiss?.(reason, timing);
    },
  });
}
progression.register('arcade', async (sequence) => {
  if (sequence.level !== chart.level)
    throw new Error(`Le niveau ${sequence.level} n’est pas disponible.`);
  arcadeSequenceId = sequence.id;
  setPhase('idle');
  await startGame();
});
progression.register('conversation', (sequence) => {
  const dialogue = dialogues[sequence.dialogue];
  if (!dialogue) throw new Error(`Conversation introuvable : ${sequence.dialogue}`);
  activeDialogue = dialogue;
  conversation = createConversation(dialogue);
  showStoryDesktop(!restoringStory);
});
progression.register('minigame', () => {
  showStoryDesktop(false);
});

function previewWindows() {
  manager.spawn('msn', { preview: true, x: 0.96, y: 0.15 });
  manager.spawn('virus', { preview: true, x: 0.91, y: 0.87 });
  manager.spawn('ad', { preview: true, x: 0.06, y: 0.8 });
}
previewWindows();
ui.bpmLabel.textContent = `≈ ${Math.round(music.bpm)} BPM`;
ui.launcherBpm.textContent = `NIVEAU 1 · ≈ ${Math.round(music.bpm)} BPM`;
ui.volume.value = settings.data.musicVolume * 100;
ui.durationLabel.textContent = `${Math.round(chart.durationSeconds)} secondes · MEDIUM`;
ui.trackTitle.firstChild.textContent = `${trackIdentity.displayName} `;
ui.trackTitle.title = `${trackIdentity.artist} — ${trackIdentity.title} (${trackIdentity.source})`;
ui.windowsStart.title = applicationName('system');

function musicalTime() {
  return audio.time - chart.offsetSeconds - syncOffset;
}
function debugSnapshot() {
  const time = musicalTime();
  return {
    ...musicAt(time, music),
    time,
    audioTime: audio.time,
    offset: syncOffset,
    phase,
    level: chart.level,
    open: state.open,
    maxWindows: chart.gameplay.peakWindows ?? chart.gameplay.maxWindows,
    launches: progression.data.level1Launches,
    skipped: director?.skipped ?? 0,
    closeSeconds: director?.closeSeconds ?? 1.8,
    lastLateness,
    maxLateness,
    sourceHash: music.source.sha256,
    beatCount: music.beats.length,
    next:
      timeline?.events
        .slice(timeline.cursor)
        .filter((event) => WINDOW_TYPES.includes(event.type))
        .slice(0, 4) ?? [],
  };
}
const musicToggle = createMusicToggle(ui.desktop, audio);
let deletingUserData = false;
let resettingGame = false;
const menu = new MainMenu(document.getElementById('app'), progression, settings, sounds, {
  play: continueFromMenu,
  newGame: resetGameToInitialState,
  settingsChanged: () => setVolume(settings.data.musicVolume),
  fullscreen: setFullscreen,
  deleteData: async () => {
    deletingUserData = true;
    try {
      await setFullscreen(false);
      deleteUserData(storyStorage);
      window.location.reload();
    } catch (error) {
      deletingUserData = false;
      throw error;
    }
  },
});
const desktopIcons = new DesktopIcons(ui.desktop, progression, virtualFilesystem);
const desktopFiles = new DesktopFiles(ui.desktop, progression, openDesktopFile, () =>
  desktopIcons.refresh(),
  virtualFilesystem,
);
desktopApplications.onExplorerPreferencesChanged = () => {
  desktopIcons.refresh();
  desktopFiles.render();
};
desktopIcons.onShortcutsChanged = renderDesktopFiles;
desktopApplications.onOpenDesktopShortcut = (file, location) =>
  openDesktopFile({ ...file, shortcutTarget: true }, location);
desktopApplications.onDesktopShortcutDrag = (action, fileId, x, y) => {
  if (action === 'cancel') return desktopIcons.clearShortcutDropPreview();
  if (action === 'preview') return desktopIcons.updateShortcutDropPreview(fileId, x, y);
  return desktopIcons.createFileShortcut(fileId, x, y);
};
const desktopContextMenus = new WindowsXdContextMenus({
  desktop: ui.desktop,
  manager,
  desktopIcons,
  virtualFilesystem,
  desktopApplications,
  onFilesystemChange: renderDesktopFiles,
});
const startMenuOrder = new StartMenuOrder(ui.startMenu, settings);
const taskbarOrder = new TaskbarOrder(ui.desktop.querySelector('.taskbar'));
async function resetGameToInitialState() {
  if (resettingGame) return;
  resettingGame = true;
  try {
    await resetSession({
      progression,
      stop: () => {
        buddy.setActive(false);
        pauseGeneration++;
        cancelAnimationFrame(frame);
        audio.stop(true);
        menuMusic.stop();
        cancelVictory();
        rules.hide();
        setStartMenuOpen(false);
        desktopIcons.cancel();
        taskbarOrder.cancel();
        manager.clear();
        miniGameLauncher.reset();
        notifications.clear({ resetHandled: true });
        action = secondaryAction = () => {};
        clearEffects();
      },
      rebuild: async () => {
        const fullscreen = window.chaosWindow
          ? await window.chaosWindow.getFullscreen()
          : Boolean(document.fullscreenElement);
        buddy.restore();
        browser.reset();
        settings.reset();
        settings.update({ fullscreen });
        messenger.conversations.clear();
        messenger.views.clear();
        messenger.roster = null;
        activeDialogue = pixelgirlDialogue;
        conversation = createConversation(activeDialogue);
        state.reset();
        timeline?.reset();
        director?.reset();
        best = syncOffset = lastTime = maxLateness = 0;
        lastLateness = null;
        duration = chart.durationSeconds;
        arcadeSequenceId = story.start;
        arcadeReplay = false;
        ui.best.textContent = '000000';
        manager.sequence = 0;
        manager.z = 10;
        desktopApplications.instances.clear();
        taskbarOrder.reset();
        startMenuOrder.reset();
        renderDesktopFiles();
        desktopIcons.reset();
        ui.desktop.style.backgroundImage = '';
        ui.desktop.classList.remove('story-desktop', 'is-playing', 'on-beat');
        previousVolume = settings.defaults.musicVolume;
        setVolume(settings.defaults.musicVolume);
        audio.setMuted(false);
        musicToggle.render();
        menu.syncSettings();
        renderStats();
      },
      restart: continueFromMenu,
    });
  } finally {
    resettingGame = false;
    if (phase === 'menu') menuMusic.start();
  }
}
async function setFullscreen(value) {
  try {
    if (window.chaosWindow) await window.chaosWindow.setFullscreen(value);
    else if (value && !document.fullscreenElement)
      await document.documentElement.requestFullscreen();
    else if (!value && document.fullscreenElement) await document.exitFullscreen();
    settings.update({ fullscreen: value });
    menu.syncSettings();
  } catch (error) {
    menu.syncSettings();
    throw error;
  }
}
window.chaosWindow?.onFullscreenChanged(async () => {
  if (deletingUserData || resettingGame) return;
  const runId = progression.data.runId;
  const value = await window.chaosWindow.getFullscreen();
  if (deletingUserData || resettingGame || runId !== progression.data.runId) return;
  settings.update({ fullscreen: value });
  menu.syncSettings();
});
document.addEventListener('fullscreenchange', () => {
  if (!window.chaosWindow && !deletingUserData && !resettingGame) {
    settings.update({ fullscreen: Boolean(document.fullscreenElement) });
    menu.syncSettings();
  }
});
async function continueFromMenu() {
  ui.desktop.inert = false;
  menu.hide();
  menuMusic.stop();
  progression.begin();
  if (bombArenaHandoffPending(progression)) {
    showStoryDesktop(false, { connectPixelGirl: false });
    bombArenaHandoffRetrier?.attempt();
    return;
  }
  const pendingVictory = pendingArcadeVictory(progression);
  if (pendingVictory) {
    showArcadeVictory(pendingVictory);
    return;
  }
  if (progression.current?.type === 'arcade') {
    setPhase('idle');
    await startGame();
    return;
  }
  restoringStory = true;
  try {
    const last = [...story.sequences]
      .reverse()
      .find(
        (item) =>
          item.type === 'conversation' &&
          (item.id === progression.data.current || progression.data.completed.includes(item.id)),
      );
    activeDialogue = dialogues[last?.dialogue] ?? pixelgirlDialogue;
    conversation = createConversation(activeDialogue);
    if (progression.current) await progression.enterCurrent();
    else showStoryDesktop(false);
    if (progression.current?.type === 'conversation') openConversation();
  } catch (error) {
    showStoryError(error);
  } finally {
    restoringStory = false;
  }
}
function returnToMenu() {
  if (['loading', 'resuming'].includes(phase)) return false;
  let completedAndSaved = false;
  if (
    progression.current?.type === 'conversation' &&
    conversation.dialogue.id === progression.current.dialogue &&
    conversation.session?.state.finished
  )
    completedAndSaved = progression.complete(progression.current.id, {
      dialogue: activeDialogue.id,
    });
  if (progression.hasSave && (!completedAndSaved || progression.persistenceError) && !progression.save())
    return false;
  cancelVictory();
  pauseGeneration++;
  cancelAnimationFrame(frame);
  audio.stop(true);
  clearEffects();
  manager.clear();
  miniGameLauncher.reset();
  setPhase('menu');
  ui.desktop.inert = true;
  ui.modalLayer.hidden = true;
  ui.introLayer.hidden = true;
  ui.playfield.inert = true;
  ui.pauseButton.disabled = true;
  ui.desktop.classList.remove('is-playing', 'on-beat');
  setStartMenuOpen(false);
  menu.show();
  menuMusic.start();
  return true;
}
document.addEventListener('pointerdown', () => {
  if (phase === 'menu' && !menuMusic.active) menuMusic.start();
});
// Diagnostic data remains available for development inspection.
Object.defineProperty(window, 'chaosDebug', { value: Object.freeze({ snapshot: debugSnapshot }) });

async function startGame() {
  if (!['idle', 'ended', 'desktop'].includes(phase)) return;
  if (!rules.hasSeen(chart)) {
    manager.clear();
    cancelVictory();
    ui.introLayer.hidden = true;
    setPhase('rules');
    rules.beforeStart(
      chart,
      () => {
        setPhase('idle');
        startGame();
      },
      returnToMenu,
    );
    return;
  }
  cancelVictory();
  arcadeReplay = progression.data.completed.includes('arcade-1');
  if (progression.current?.type === 'arcade') arcadeSequenceId = progression.current.id;
  ui.desktop.classList.remove('story-desktop');
  setPhase('loading');
  if (!progression.hasSave) progression.begin();
  ui.startButton.disabled = true;
  ui.closeLauncher.disabled = true;
  ui.dialogAction.disabled = true;
  ui.loadStatus.textContent = 'Chargement de la musique… connexion à 56k (presque).';
  try {
    if (configurationError) throw configurationError;
    const trackDuration = await audio.start();
    replayReactions.launch();
    duration = Math.min(chart.durationSeconds, trackDuration);
    manager.clear();
    clearEffects();
    state.reset();
    timeline.reset();
    director.reset();
    pauseGeneration++;
    lastLateness = null;
    maxLateness = 0;
    lastTime = 0;
    ui.introLayer.hidden = true;
    ui.modalLayer.hidden = true;
    ui.playfield.inert = false;
    setPhase('playing');
    ui.pauseButton.disabled = false;
    ui.desktop.classList.add('is-playing');
    renderStats();
    frame = requestAnimationFrame(tick);
    if (document.hidden) await pauseGame();
  } catch (error) {
    audio.stop();
    setPhase('idle');
    ui.loadStatus.textContent = `Impossible de démarrer : ${error.message}`;
    showDialog(
      'Connexion interrompue',
      `<p>La musique ou la configuration n’a pas pu être chargée.</p><p class="dialog-detail"></p>`,
      'Réessayer',
      () => {
        ui.modalLayer.hidden = true;
        startGame();
      },
    );
    ui.dialogCopy.querySelector('.dialog-detail').textContent = error.message;
  } finally {
    ui.startButton.disabled = false;
    ui.closeLauncher.disabled = false;
    ui.dialogAction.disabled = false;
  }
}

function tick() {
  if (phase !== 'playing') return;
  const now = Math.min(audio.time, duration);
  // The audio clock drives pressure and scheduling, even after missed frames.
  const lost = state.update(Math.max(0, now - lastTime));
  lastTime = now;
  const time = now - chart.offsetSeconds - syncOffset;
  if (!lost) timeline.advance(time, (event) => emitEvent(event, time));
  const { beat, intensity } = musicAt(time, music);
  ui.desktop.style.setProperty('--music-intensity', intensity);
  ui.desktop.classList.toggle('on-beat', Boolean(beat && time - beat.time < 0.12));
  ui.desktop.classList.toggle('music-accent', Boolean(beat?.accent && time - beat.time < 0.1));
  ui.desktop.classList.toggle('music-sparkle', time < sparkleUntil);
  if (now >= wizzUntil) {
    ui.desktop.classList.remove('wizz');
    ui.wizzLabel.hidden = true;
  }
  renderStats();
  ui.trackFill.style.width = `${(now / duration) * 100}%`;
  ui.trackTime.textContent = `${formatTime(now)} / ${formatTime(duration)}`;
  if (lost || state.chaos >= 100) return finishGame(false);
  if (now >= duration) return finishGame(true);
  frame = requestAnimationFrame(tick);
}

function emitEvent(event, time) {
  if (event.type === 'pulse') return;
  if (time - event.time > chart.gameplay.maxEventLatenessSeconds) {
    if (WINDOW_TYPES.includes(event.type)) director.allow(event, time, state);
    return;
  }
  if (event.type === 'sparkle') {
    sparkleUntil = event.time + 0.08;
    return;
  }
  if (event.type === 'notify') return notify(event.contact, event.message);
  if (event.type === 'wizz') return wizz();
  if (!director.allow(event, time, state)) return;
  manager.spawn(event.type, { openedAt: audio.time });
  state.spawn();
  lastLateness = Math.max(0, time - event.time);
  maxLateness = Math.max(maxLateness, lastLateness);
}

function renderStats() {
  ui.score.textContent = String(state.score).padStart(6, '0');
  ui.chaosText.textContent = `${Math.floor(state.chaos)} %`;
  ui.chaosFill.style.width = `${state.chaos}%`;
  ui.chaosMeter.setAttribute('aria-valuenow', Math.floor(state.chaos));
  ui.desktop.classList.toggle('danger', state.chaos >= 70);
  ui.chaosCaption.textContent =
    state.chaos >= 70
      ? 'ALERTE : ferme ces fenêtres !'
      : state.chaos >= 35
        ? 'Ça commence à faire beaucoup…'
        : 'Tout va bien. Pour l’instant.';
}

async function pauseGame() {
  if (phase !== 'playing') return;
  setPhase('paused');
  cancelAnimationFrame(frame);
  ui.playfield.inert = true;
  ui.desktop.classList.remove('is-playing');
  const generation = ++pauseGeneration;
  await audio.pause();
  if (phase !== 'paused' || generation !== pauseGeneration) return;
  showDialog(
    'Une petite pause ?',
    '<p>Ton bureau et la musique t’attendent.</p><p class="dialog-hint">Respire. Détends ta souris. Tu gères.</p>',
    '▶ REPRENDRE',
    resumeGame,
    'help',
    { label: 'Recommencer', callback: restartGame },
  );
}
async function resumeGame() {
  if (phase !== 'paused') return;
  setPhase('resuming');
  const generation = ++pauseGeneration;
  ui.dialogAction.disabled = true;
  try {
    await audio.resume();
    if (phase !== 'resuming' || generation !== pauseGeneration) return;
    ui.modalLayer.hidden = true;
    ui.playfield.inert = false;
    setPhase('playing');
    ui.desktop.classList.add('is-playing');
    manager.reposition();
    frame = requestAnimationFrame(tick);
    if (document.hidden) await pauseGame();
  } catch (error) {
    if (generation !== pauseGeneration) return;
    setPhase('paused');
    ui.dialogCopy.textContent = `La reprise a échoué : ${error.message}`;
  } finally {
    ui.dialogAction.disabled = false;
  }
}
function finishGame(won) {
  if (!['playing', 'paused'].includes(phase)) return;
  pauseGeneration++;
  setPhase('ended');
  cancelAnimationFrame(frame);
  audio.stop();
  clearEffects();
  ui.pauseButton.disabled = true;
  ui.playfield.inert = true;
  ui.desktop.classList.remove('is-playing', 'on-beat');
  const newRecord = state.score > best;
  best = Math.max(best, state.score);
  try {
    storyStorage?.setItem(BEST_SCORE_KEY, String(best));
  } catch {
    /* Best score is optional. */
  }
  ui.best.textContent = String(best).padStart(6, '0');
  if (won) {
    const result = queueArcadeVictory(progression, arcadeSequenceId, {
      score: state.score,
      closed: state.closed,
      newRecord,
    });
    showArcadeVictory(result);
    return;
  }
  showDialog(
    'Ton PC a rendu l’âme.',
    `<p>Trop de fenêtres. Pas assez de clics. On remet ça ?</p><div class="result-score"><span>${newRecord ? '★ NOUVEAU RECORD' : 'SCORE FINAL'}</span><strong>${String(state.score).padStart(6, '0')}</strong></div><div class="result-details"><span>${state.closed} fenêtres fermées</span><span>${formatTime(lastTime)} de survie</span></div>`,
    '↻ REJOUER',
    startGame,
    'error',
    {
      label: 'Retour au bureau',
      callback: arcadeReplay ? () => showStoryDesktop(false) : restartDesktop,
    },
  );
}
function showArcadeVictory(result) {
  setPhase('ended');
  ui.playfield.inert = true;
  ui.pauseButton.disabled = true;
  ui.modalLayer.hidden = true;
  ui.dialogTitle.textContent = 'Tu as survécu !';
  state.score = result.score;
  state.closed = result.closed;
  renderStats();
  cancelVictory = celebrateVictory(ui.desktop, result, sounds, () => {
    try {
      const acknowledged = acknowledgeArcadeVictory(progression);
      if (acknowledged?.firstCompletion && progression.current)
        progression.enterCurrent().catch(showStoryError);
      else showStoryDesktop(false);
    } catch (error) {
      showStoryError(error);
    }
  });
}
function restartDesktop() {
  returnToMenu();
}
function restartGame() {
  pauseGeneration++;
  setPhase('ended');
  startGame();
}
function showDialog(title, copy, button, callback, type = 'help', secondary) {
  ui.dialogTitle.textContent = title;
  ui.dialogCopy.innerHTML = copy;
  ui.dialogIcon.innerHTML = icon(type);
  ui.dialogAction.textContent = button;
  action = callback;
  secondaryAction = secondary?.callback ?? (() => {});
  ui.dialogSecondary.hidden = !secondary;
  if (secondary) ui.dialogSecondary.textContent = secondary.label;
  ui.modalLayer.hidden = false;
  ui.dialogAction.focus();
}
function showSaveFailure() {
  showDialog(
    'Sauvegarde impossible',
    '<p>La progression n’a pas pu être enregistrée. La partie reste ouverte.</p>',
    'Continuer',
    () => {
      ui.modalLayer.hidden = true;
    },
    'error',
  );
}
async function help() {
  if (!['playing', 'paused', 'ended'].includes(phase) || rules.active) return;
  const resume = phase === 'playing';
  if (resume) await pauseGame();
  if (resume && phase !== 'paused') return;
  rules.review(chart, () => {
    if (resume) resumeGame();
  });
}
function feedback(x, y, points, onBeat) {
  const label = document.createElement('div');
  label.className = `score-feedback${onBeat ? ' perfect' : ''}`;
  label.textContent = `${onBeat ? 'ON BEAT! ' : ''}+${points}`;
  label.style.left = `${Math.min(window.innerWidth - 140, Math.max(20, x || window.innerWidth / 2))}px`;
  label.style.top = `${Math.max(30, (y || window.innerHeight / 2) - 20)}px`;
  ui.feedbackLayer.append(label);
  label.addEventListener('animationend', () => label.remove(), { once: true });
}
let gameplayNotificationSequence = 0;
function notify(contact, message) {
  notifications.show({
    id: `gameplay:${++gameplayNotificationSequence}`,
    type: 'gameplay',
    contact,
    message,
    durationMs: 4500,
    clock: 'game',
    policy: 'replace',
    priority: 'transient',
  });
}
function wizz() {
  ui.desktop.classList.remove('wizz');
  void ui.desktop.offsetWidth;
  ui.desktop.classList.add('wizz');
  ui.wizzLabel.hidden = false;
  wizzUntil = audio.time + 0.65;
}
function clearEffects() {
  notifications.clear();
  wizzUntil = 0;
  sparkleUntil = -Infinity;
  ui.wizzLabel.hidden = true;
  ui.desktop.classList.remove('wizz', 'on-beat', 'music-accent', 'music-sparkle');
  ui.desktop.style.setProperty('--music-intensity', 0);
  ui.feedbackLayer.replaceChildren();
}
function showStoryError(error) {
  showDialog(applicationName('messenger'), '<p class="story-error"></p>', 'Retour au bureau', () =>
    showStoryDesktop(false),
  );
  ui.dialogCopy.querySelector('.story-error').textContent = error.message;
}
function showStoryDesktop(announce, { connectPixelGirl = true } = {}) {
  cancelVictory();
  cancelAnimationFrame(frame);
  audio.stop();
  clearEffects();
  manager.clear();
  setPhase('desktop');
  ui.desktop.classList.add('story-desktop');
  ui.desktop.classList.remove('is-playing', 'on-beat');
  ui.introLayer.hidden = true;
  ui.modalLayer.hidden = true;
  ui.playfield.inert = false;
  ui.pauseButton.disabled = true;
  state.open = 0;
  state.chaos = 0;
  renderStats();
  ui.chaosCaption.textContent = 'Le bureau est calme. Place aux amis.';
  renderDesktopFiles();
  if (connectPixelGirl) {
    requestAnimationFrame(() => {
      narrativeOrchestrator.onContactConnected('pixelgirl', announce ? Date.now() : undefined, {
        notify: announce,
        notificationOptions: announce
          ? { durationMs: ENTER_ANIMATION_MS + MIN_CONNECTION_TOAST_VISIBLE_MS }
          : undefined,
      });
    });
  }
}
async function openConversation(restore = false, contact = null) {
  if (['menu', 'loading', 'resuming'].includes(phase)) return;
  if (phase === 'playing') await pauseGame();
  if (phase === 'paused' || phase === 'ended') {
    ui.modalLayer.hidden = true;
    ui.playfield.inert = false;
  }
  sounds.unlock();
  if (contact) messenger.openContact(contact);
  else if (restore === true) conversation.restore();
  else conversation.open();
}
async function openMessenger() {
  if (['menu', 'loading', 'resuming'].includes(phase)) return;
  if (phase === 'playing') await pauseGame();
  ui.playfield.inert = false;
  messenger.open();
}
async function openBrowser(url) {
  if (['menu', 'loading', 'resuming'].includes(phase)) return;
  if (phase === 'playing') await pauseGame();
  ui.playfield.inert = false;
  return browser.open(url);
}
async function launchMediaPlay(file = null, fileId = file?.fileId) {
  if (['menu', 'loading', 'resuming'].includes(phase)) return;
  if (phase === 'playing') await pauseGame();
  ui.playfield.inert = false;
  return mediaPlayer.open(file, fileId);
}
function openMediaPlayExecutable() {
  const location = virtualFilesystem.getLocation('media-files');
  const executable = location.items.find((item) => item.name.toLowerCase() === 'media-play.exe');
  if (executable) return desktopApplications.openFile(location, executable);
}
document.addEventListener('windows-xd:open-url', (event) => {
  if (typeof event.detail?.url === 'string') openBrowser(event.detail.url);
});
function replayLevelOne() {
  if (!['desktop', 'idle', 'ended', 'playing', 'paused'].includes(phase)) return;
  cancelAnimationFrame(frame);
  pauseGeneration++;
  setPhase('ended');
  startGame();
}
function renderDesktopFiles() {
  desktopFiles.render();
}
function openDesktopFile(file, location = null) {
  if (phase !== 'desktop') return;
  if (file.shortcutTarget) {
    if (!virtualFilesystem.exists(file.fileId)) return desktopApplications.openMissingFileShortcut(file);
    if (location) return desktopApplications.openFile(location, file);
    return;
  }
  if (file.virtualApp === 'bomb-arena') {
    if (virtualFilesystem.exists(file.fileId)) desktopApplications.openBombArena(file, file.fileId);
    return;
  }
  if (!virtualFilesystem.exists(virtualFileId('downloads', file.name))) return;
  try {
    miniGameLauncher.open(file);
  } catch (error) {
    showStoryError(error);
  }
}
function formatTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
}

function setStartMenuOpen(open) {
  if (!open) startMenuOrder.cancel();
  ui.startMenu.hidden = !open;
  ui.windowsStart.setAttribute('aria-expanded', String(open));
}

function setVolume(value) {
  audio.setVolume(value);
  settings.update({ musicVolume: value });
  menuMusic.setVolume(value);
  hoplaHotel.setMusicVolume(value);
  ui.volume.value = value * 100;
  ui.muteButton.textContent = value === 0 ? '♪̸' : '♫';
  ui.muteButton.setAttribute('aria-label', value === 0 ? 'Réactiver le son' : 'Couper le son');
}

ui.startButton.addEventListener('click', startGame);
ui.closeLauncher.addEventListener('click', () => {
  ui.introLayer.hidden = true;
  ui.windowsStart.focus();
});
ui.pauseButton.addEventListener('click', pauseGame);
ui.helpButton.addEventListener('click', help);
ui.dialogAction.addEventListener('click', () => action());
ui.dialogSecondary.addEventListener('click', () => secondaryAction());
ui.menuMessenger.addEventListener('click', () => {
  setStartMenuOpen(false);
  openMessenger();
});
ui.desktop.querySelector('#menu-browser').addEventListener('click', () => {
  setStartMenuOpen(false);
  openBrowser();
});
ui.volume.addEventListener('input', (event) => {
  setVolume(Number(event.target.value) / 100);
});
ui.muteButton.addEventListener('click', () => {
  if (audio.volume > 0) {
    previousVolume = audio.volume;
    setVolume(0);
  } else {
    setVolume(previousVolume || DEFAULT_VOLUME);
  }
});
ui.windowsStart.addEventListener('click', () => {
  setStartMenuOpen(ui.startMenu.hidden);
});
ui.desktop.querySelector('#menu-buddy').addEventListener('click', () => {
  setStartMenuOpen(false);
  buddy.open();
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.start-menu, .windows-start')) setStartMenuOpen(false);
});
ui.menuMain.addEventListener('click', () => {
  returnFromStartMenu({
    closeMenu: () => setStartMenuOpen(false),
    returnToMenu,
    onSaveFailure: showSaveFailure,
  });
});
ui.menuQuit.addEventListener('click', () => {
  void quitFromStartMenu({
    closeMenu: () => setStartMenuOpen(false),
    hasSave: progression.hasSave,
    save: () => progression.save(),
    quitApp: window.chaosApp?.quit,
    closeWindow: () => window.close(),
    onSaveFailure: showSaveFailure,
    onQuitFailure: (error) => {
      console.error('Impossible de quitter Chaos Survival.', error);
      showSaveFailure();
    },
  });
});
function syncSystemWindows() {
  if (phase !== 'paused' && phase !== 'ended') return;
  const visible = [...manager.windows.values()].some(
    ({ element }) =>
      element.isConnected &&
      !element.hidden &&
      (element.classList.contains('popup-narrative') ||
        element.classList.contains('popup-desktopapp')),
  );
  ui.modalLayer.hidden = visible;
  ui.playfield.inert = !visible;
}
async function openSystemApplication(kind) {
  if (['menu', 'loading', 'resuming'].includes(phase)) return;
  if (phase === 'playing') await pauseGame();
  ui.playfield.inert = false;
  desktopApplications.open(kind);
}
ui.desktop.querySelectorAll('[data-system-app]').forEach((button) =>
  button.addEventListener('click', () => {
    setStartMenuOpen(false);
    openSystemApplication(button.dataset.systemApp);
  }),
);
const shortcutActions = {
  msn: () => openMessenger(),
  browser: () => openBrowser(),
  computer: () => openSystemApplication('computer'),
  folder: () => openSystemApplication('folder'),
  bin: () => openSystemApplication('bin'),
  'windows-media-play': openMediaPlayExecutable,
  arcade: replayLevelOne,
};
ui.shortcuts.forEach((button) => {
  const activate = shortcutActions[button.dataset.shortcut];
  if (activate) bindFileActivation(button, activate);
});
const arcadeShortcut = ui.desktop.querySelector('[data-shortcut="arcade"]');
arcadeShortcut.title = `${arcadeLauncher.name}\nDouble-cliquer pour jouer / rejouer le niveau 1\nMusique : ${trackIdentity.displayName}`;
// Vite removes this entire import and handler from production builds.
if (import.meta.env.DEV) {
  import('./dev/finish-shortcut.js').then((shortcuts) => {
    const {
      installDevelopmentVictoryShortcut,
      installDevelopmentConversationShortcut,
      installDevelopmentBombArenaShortcut,
      createDevelopmentProgressionSandbox,
      prepareBombArenaForDevelopment,
    } = shortcuts;
    const foregroundGroupConversation = () => {
      if (phase !== 'desktop') return null;
      const topWindow = [...manager.windows.values()]
        .filter(({ element }) => element.isConnected && !element.hidden)
        .sort((a, b) => Number(b.element.style.zIndex) - Number(a.element.style.zIndex))[0];
      if (topWindow?.element.dataset.messengerContact !== 'plumber-group') return null;
      return messenger.conversations.get('plumber-group') ?? null;
    };
    installDevelopmentVictoryShortcut(document, () => {
      if (rules.active) return null;
      if (foregroundGroupConversation()) return null;
      if (['playing', 'paused'].includes(phase)) return { finish: () => finishGame(true) };
      const game = miniGameLauncher.active;
      if (phase === 'desktop' && game?.element?.isConnected && !game.finished) return game;
      const flashGame = browser.currentPage?.node;
      if (phase === 'desktop' && flashGame?.running && !flashGame.finished) return flashGame;
      return null;
    });
    installDevelopmentConversationShortcut(document, () => {
      const topWindow = [...manager.windows.values()]
        .filter(({ element }) => element.isConnected && !element.hidden)
        .sort((a, b) => Number(b.element.style.zIndex) - Number(a.element.style.zIndex))[0];
      const contactId = topWindow?.element.dataset.messengerContact;
      if (!contactId || topWindow.element.classList.contains('contact-offline')) return null;
      return [conversation, ...messenger.conversations.values()].find(
        (view) =>
          view.element === topWindow.element &&
          view.element?.isConnected &&
          !view.element.hidden &&
          !view.offlineContact,
      );
    });
    installDevelopmentConversationShortcut(
      document,
      foregroundGroupConversation,
      () => {
        if (
          prepareBombArenaForDevelopment(
            progression,
            virtualFilesystem,
            dialogues['pixelgirl-super-plombier-group'],
          )
        ) {
          renderDesktopFiles();
          desktopApplications.refreshExplorers();
        }
      },
      'd',
    );
    const bombArenaSandbox = createDevelopmentProgressionSandbox(progression);
    installDevelopmentBombArenaShortcut(document, () => {
      const dialogue = dialogues['pixelgirl-super-plombier-group'];
      if (!bombArenaSandbox.enter(dialogue)) return;
      notifications.clear({ resetHandled: true });
      menu.hide();
      menuMusic.stop();
      ui.desktop.inert = false;
      // Dispose existing windows while the isolated in-memory save is active.
      showStoryDesktop(false, { connectPixelGirl: false });
      if (!bombArenaSandbox.enter(dialogue)) return;
      desktopIcons.refresh();
      renderDesktopFiles();
      const contact = messenger.contacts().find((item) => item.id === 'plumber-group');
      if (contact?.available) messenger.openContact(contact);
    });
  });
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || event.repeat || rules.active) return;
  if (phase === 'playing') pauseGame();
  else if (phase === 'paused') resumeGame();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'playing') pauseGame();
});
function updateClock() {
  ui.clock.textContent = new Date().toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  menu.clock.textContent = ui.clock.textContent;
}
updateClock();
function receiveReplayReactions() {
  if (resettingGame) {
    requestAnimationFrame(receiveReplayReactions);
    return;
  }
  const incoming = replayReactions.flush(Date.now(), { canReceive: phase === 'desktop' });
  narrativeOrchestrator.update(Date.now(), phase !== 'menu');
  messenger.update();
  narrativeOrchestrator.afterMessengerUpdate(Date.now());
  buddy.update();
  if (incoming.length) {
    const pixelGirl = messenger.contacts().find((entry) => entry.id === 'pixelgirl');
    if (pixelGirl)
      messenger.receiveIncoming(
        pixelGirl,
        incoming,
        replayReactions.thread.lastIncomingMessages ?? [],
        conversation,
      );
  }
  const visible = !conversation.offlineContact && messenger.isVisible(conversation);
  const unread = replayReactions.thread.state.unread;
  if (!incoming.length && visible && !unread.length)
    notifications.cancelContact('pixelgirl', 'message');
  notifications.update();
  requestAnimationFrame(receiveReplayReactions);
}
receiveReplayReactions();
setInterval(updateClock, 10000);
ui.trackTime.textContent = `00:00 / ${formatTime(chart.durationSeconds)}`;
returnToMenu();
if (bombArenaHandoffPending(progression))
  queueMicrotask(() => continueFromMenu());
if (window.chaosWindow) {
  window.chaosWindow.getFullscreen().then((fullscreen) => {
    settings.update({ fullscreen });
    menu.syncSettings();
  }).catch(() => {});
} else if (settings.data.fullscreen) setFullscreen(true).catch(() => {});
