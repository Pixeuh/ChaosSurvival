import { DialogueSession } from '../story/dialogue.js';
import { ConversationThread } from '../story/conversation-thread.js';
import { applicationName } from './identity.js';
import { applyPlayerIdentity, playerIdentity, subscribePlayerIdentity } from './player-identity.js';
import { webcamPlaceholder } from './webcam-placeholder.js';
import { createContactAvatar } from './contact-avatar.js';

import { appendMessageText } from './message-text.js';
export { appendMessageText } from './message-text.js';

const GROUP_AUTHOR_IDS = Object.freeze({
  xX_PixelGirl_Xx: 'pixelgirl',
  Turb0: 'turbo',
  '°•.LuNa.°•': 'luna',
});

export class ConversationWindow {
  constructor(
    manager,
    dialogue,
    progression,
    sounds,
    onComplete,
    onFilesChanged = () => {},
    onCheckpoint = () => {},
    {
      isUnlocked = () => true,
      onWindowState = () => {},
      thread,
      onContactsRequested,
      onChoiceValidated = () => {},
      onTransferDeclined = () => {},
      onLink = () => {},
      manageWindow,
      onDispose,
      player = playerIdentity,
      inputValidators = {},
      inputActions = {},
    } = {},
  ) {
    this.onContactsRequested = onContactsRequested;
    this.onChoiceValidated = onChoiceValidated;
    this.onTransferDeclined = onTransferDeclined;
    this.onLink = onLink;
    this.manageWindow = manageWindow;
    this.onDispose = onDispose;
    this.player = player;
    this.inputValidators = inputValidators;
    this.inputActions = inputActions;
    this.manager = manager;
    this.dialogue = dialogue;
    this.progression = progression;
    this.sounds = sounds;
    this.onComplete = onComplete;
    this.onFilesChanged = onFilesChanged;
    this.onCheckpoint = onCheckpoint;
    this.isUnlocked = isUnlocked;
    this.onWindowState = onWindowState;
    this.thread =
      thread ??
      new ConversationThread(dialogue.contact.name.toLowerCase(), progression, () => [dialogue]);
    this.sessions = new Map();
  }
  sessionFor(definition) {
    const existing = this.sessions.get(definition.id);
    if (existing && existing.state === this.progression.data.dialogues[definition.id])
      return existing;
    const session = new DialogueSession(definition, this.progression);
    this.sessions.set(definition.id, session);
    return session;
  }
  contactStatus(definition) {
    const profile = `${definition.contact.status} · ${definition.contact.personalMessage ?? ''}`;
    if (!Array.isArray(definition.participants)) return profile;
    const participants = definition.participants.map((name) =>
      name === definition.player.nickname ? this.player.nickname : name,
    );
    return `Participants : ${participants.join(', ')} · ${profile}`;
  }
  chooseResponse(definition, session, choiceId) {
    const nodeId = session.state.node;
    const choice = session.choose(choiceId);
    applyPlayerIdentity(this.progression.data.playerIdentity);
    this.onChoiceValidated?.(definition, { nodeId, choice });
    return choice;
  }
  playChoiceSound(choice) {
    if (choice?.action === 'wizz') return;
    this.sounds.play('send');
  }
  openOffline(contact) {
    if (this.element?.isConnected && this.offlineContact?.id === contact.id) return this.restore();
    this.closeForViewSwitch();
    this.offlineContact = contact;
    this.open(true);
  }
  open(keepOffline = false) {
    if (!keepOffline && this.offlineContact) {
      this.closeForViewSwitch();
      this.offlineContact = null;
    }
    if (this.element?.isConnected) {
      this.refresh();
      if (this.manager.activate) this.manager.activate(this.element);
      else this.element.hidden = false;
      this.lastFrame = null;
      if (!this.manager.activate) this.element.style.zIndex = ++this.manager.z;
      this.element.querySelector('.dialogue-choices button')?.focus();
      this.onWindowState({ open: true, minimized: false });
      return;
    }
    if (!this.offlineContact && !this.isUnlocked()) return this.openContacts();
    this.dialogue = this.offlineContact
      ? { contact: this.offlineContact, player: this.player }
      : this.thread.activeDefinition;
    this.session = this.offlineContact ? null : this.sessionFor(this.dialogue);
    const id = this.manager.spawn('narrative', {
      preview: true,
      resizable: true,
      maximizable: true,
      minWidth: 480,
      minHeight: 400,
      x: 0.35,
      y: 0.15,
      content: {
        title: 'Conversation MSN',
        iconName: 'msn',
        body: /* HTML */ `
          <div class="msn-menu"></div>
          <div class="msn-contact">
            <img class="story-avatar contact-avatar" alt="Avatar du contact" />
            <div>
              <strong class="contact-name"></strong
              ><small><i class="online-dot"></i><span class="contact-status"></span></small>
            </div>
          </div>
          <div class="conversation-content">
            <div class="conversation-history">
              <div
                class="conversation-log"
                role="log"
                aria-label="Messages de la conversation"
                aria-live="polite"
                aria-relevant="additions"
              >
                <div class="conversation-flow"></div>
              </div>
              <div class="contact-typing" role="status" aria-live="polite" hidden></div>
            </div>
            <div class="conversation-portraits">
              <div class="conversation-contact-portrait">
                <img class="story-avatar contact-avatar" alt="Avatar du contact" />
                ${webcamPlaceholder()}
              </div>
              <img class="story-avatar player-avatar" alt="Votre avatar" />
            </div>
          </div>
          <div class="msn-tools">
            <button class="text-button" data-msn-action="wizz">Wizz !</button>
          </div>
          <form class="dialogue-composer" hidden>
            <input class="dialogue-input" type="text" autocomplete="off" aria-label="Votre réponse" />
            <button class="xp-button dialogue-send" type="submit">Envoyer</button>
          </form>
          <small class="dialogue-input-status" role="status" aria-live="polite"></small>
          <div class="dialogue-choices" aria-label="Réponses possibles"></div>
          <div class="window-status dialogue-typing" role="status"></div>
        `,
      },
      onDismiss: ({ reason }) => {
        const complete =
          reason === 'close' &&
          !this.switchingView &&
          !this.offlineContact &&
          this.session?.state.finished;
        this.dispose({ reason });
        if (complete) this.onComplete(this.dialogue.id);
      },
    });
    this.element = this.manager.windows.get(id).element;
    this.element.classList.toggle(
      'contact-offline',
      Boolean(this.offlineContact && !this.offlineContact.online),
    );
    this.element.classList.toggle('group-conversation', this.dialogue.contact.id === 'plumber-group');
    if (this.manageWindow) this.manageWindow(this);
    else {
      const minimize = document.createElement('button');
      minimize.className = 'msn-minimize';
      minimize.textContent = '−';
      minimize.setAttribute('aria-label', 'Réduire MSN');
      minimize.addEventListener('click', () => {
        if (this.manager.minimize) this.manager.minimize(this.element);
        else this.element.hidden = true;
        this.lastFrame = null;
        this.onWindowState({ open: true, minimized: true });
        if (this.ghost) {
          this.ghost.remove();
          this.ghost = null;
          this.pump();
        }
      });
      this.element
        .querySelector('.titlebar')
        .insertBefore(
          minimize,
          this.element.querySelector('.maximize-button') ?? this.element.querySelector('.close-button'),
        );
    }
    this.element.querySelector('.window-title > span').textContent =
      `${this.dialogue.contact.nickname} — Conversation`;
    this.element
      .querySelector('.close-button')
      .setAttribute('aria-label', `Fermer ${applicationName('messenger')}`);
    this.element.querySelector('.contact-name').textContent = this.dialogue.contact.nickname;
    this.element.querySelector('.contact-status').textContent = this.contactStatus(this.dialogue);
    this.element.querySelectorAll('.contact-avatar').forEach((container) => {
      if (this.dialogue.contact.id !== 'plumber-group') {
        if (!/^\.\/avatars\/[a-z0-9-]+\.svg$/i.test(this.dialogue.contact.avatar))
          throw new Error('Avatar local invalide.');
        container.alt = `Avatar de ${this.dialogue.contact.name ?? this.dialogue.contact.nickname}`;
        container.src = new URL(this.dialogue.contact.avatar, document.baseURI).href;
        return;
      }
      const avatar = createContactAvatar(this.dialogue.contact, 'story-avatar contact-avatar');
      container.replaceWith(avatar);
      const images = avatar.querySelectorAll('img');
      images.forEach((image) => {
        const path = image.getAttribute('src');
        if (!/^\.\/avatars\/[a-z0-9-]+\.svg$/i.test(path))
          throw new Error('Avatar local invalide.');
        image.src = new URL(path, document.baseURI).href;
      });
    });
    const playerAvatar = this.element.querySelector('.player-avatar');
    if (!/^\.\/avatars\/[a-z0-9-]+\.svg$/i.test(this.player.avatar))
      throw new Error('Avatar local invalide.');
    playerAvatar.src = new URL(this.player.avatar, document.baseURI).href;
    this.log = this.element.querySelector('.conversation-log');
    this.history = this.element.querySelector('.conversation-history');
    this.flow = this.element.querySelector('.conversation-flow');
    this.choices = this.element.querySelector('.dialogue-choices');
    this.composer = this.element.querySelector('.dialogue-composer');
    this.inputField = this.element.querySelector('.dialogue-input');
    this.inputStatus = this.element.querySelector('.dialogue-input-status');
    this.composer.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submitDialogueInput();
    });
    this.typing = this.element.querySelector('.dialogue-typing');
    this.typingIndicator = this.element.querySelector('.contact-typing');
    this.followLatest = true;
    this.unsubscribeIdentity?.();
    this.unsubscribeIdentity = subscribePlayerIdentity(() => this.refreshPlayerLabels());
    const log = this.log;
    this.log.addEventListener('scroll', () => {
      if (this.log !== log || !log.isConnected) return;
      this.followLatest = log.scrollHeight - log.clientHeight - log.scrollTop < 24;
    });
    this.logObserver = new ResizeObserver(() => {
      if (this.element?.isConnected) this.scrollLatest();
    });
    this.logObserver.observe(this.log);
    this.renderTranscript();
    this.onVisibility = () => {
      this.lastFrame = null;
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    this.sounds.unlock();
    this.onWindowState({ open: true, minimized: false });
    this.pump();
    this.frame = requestAnimationFrame((time) => this.tick(time));
  }
  restore() {
    if (!this.element?.isConnected) return this.open(Boolean(this.offlineContact));
    if (this.manager.activate) this.manager.activate(this.element);
    else {
      this.element.hidden = false;
      this.element.style.zIndex = ++this.manager.z;
    }
    this.lastFrame = null;
    this.refresh();
    this.onWindowState({ open: true, minimized: false });
  }
  openMinimized() {
    if (this.element?.isConnected) return this.element;
    this.open();
    if (!this.element?.isConnected) return this.element;
    if (this.manager.minimize) this.manager.minimize(this.element);
    else this.element.hidden = true;
    this.lastFrame = null;
    this.messengerInstance?.task.setAttribute('aria-pressed', 'false');
    this.onWindowState({ open: true, minimized: true });
    return this.element;
  }
  renderTranscript() {
    (this.flow ?? this.log).replaceChildren();
    this.renderedKeys = new Set();
    this.appendHistory();
  }
  appendHistory() {
    if (this.offlineContact) return;
    for (const message of this.thread.sync()) {
      if (this.renderedKeys.has(message.key)) continue;
      this.renderedKeys.add(message.key);
      this.appendMessage(message);
    }
  }
  refresh() {
    if (this.offlineContact && this.log) return;
    if (!this.element?.isConnected || !this.log) return;
    this.appendHistory();
    this.renderResponses();
    this.renderInput();
    this.renderTyping();
    const definition = this.thread.activeDefinition;
    if (this.dialogue.id === definition.id) {
      if (this.receiving && !this.thread.isReceiving(definition.id)) this.pump();
      return;
    }
    // Only completed events yield control; pending choices and transfers stay intact.
    if (
      (!this.session.state.finished &&
        !this.session.choices.length &&
        !this.session.node.transfer) ||
      this.transfer ||
      this.ghost
    )
      return;
    this.dialogue = definition;
    this.element.classList.remove('contact-away');
    this.element.querySelector('.contact-status').textContent = this.contactStatus(definition);
    this.session = this.sessionFor(definition);
    this.pending = null;
    this.ghost?.remove();
    this.ghost = null;
    this.transfer = null;
    this.lastFrame = null;
    this.appendHistory();
    this.pump();
  }
  appendMessage(message) {
    const row = document.createElement('div');
    row.className = `conversation-message ${message.speaker === 'player' ? 'from-player' : 'from-contact'}`;
    if (message.key) row.dataset.messageKey = message.key;
    if (message.speaker === 'player') row.dataset.playerSpeaker = 'true';
    if (message.type === 'wizz') {
      row.className = 'conversation-message conversation-system';
      row.textContent =
        message.speaker === 'player'
          ? `${(this.player ?? playerIdentity).nickname} vous a envoyé un wizz !`
          : message.text;
      (this.flow ?? this.log).append(row);
      this.scrollLatest();
      return row;
    }
    if (this.dialogue.contact.id === 'plumber-group') {
      const authorId = message.speaker === 'player' ? 'player' : GROUP_AUTHOR_IDS[message.author];
      if (authorId) row.dataset.authorId = authorId;
    }
    const author = document.createElement('small');
    author.textContent = `${message.speaker === 'player' ? (this.player ?? playerIdentity).nickname : message.author ?? this.dialogue.contact.nickname} dit :`;
    const copy = document.createElement(message.type === 'link' ? 'a' : 'p');
    if (message.type === 'link') {
      copy.href = '#';
      copy.className = 'conversation-link';
      copy.textContent = message.text;
      copy.addEventListener('click', (event) => {
        event.preventDefault();
        this.onLink(message.url);
      });
    } else appendMessageText(copy, message.text);
    row.append(author, copy);
    if (message.type === 'file') this.renderTransfer(row, message.fileKey);
    (this.flow ?? this.log).append(row);
    this.scrollLatest();
    return row;
  }
  refreshPlayerLabels() {
    if (!this.element?.isConnected) return;
    for (const row of this.element.querySelectorAll('[data-player-speaker="true"]')) {
      if (row.classList.contains('conversation-system')) {
        const message = this.thread.state.history.find((item) => item.key === row.dataset.messageKey);
        if (message?.type === 'wizz') row.textContent = `${this.player.nickname} vous a envoyé un wizz !`;
        continue;
      }
      const author = row.querySelector('small');
      if (author) author.textContent = `${this.player.nickname} dit :`;
    }
    this.element.querySelector('.contact-status').textContent = this.contactStatus(this.dialogue);
  }
  renderInput() {
    if (!this.composer) return;
    const input = this.session?.input;
    this.composer.hidden = !input;
    if (!input) {
      this.inputStatus.textContent = '';
      return;
    }
    this.inputField.maxLength = input.validator === 'playerNickname' ? 256 : input.maxLength ?? 64;
    this.inputField.placeholder = input.placeholder ?? '';
  }
  submitDialogueInput() {
    const input = this.session?.input;
    if (!input) return false;
    const accepted = this.session.submitInput(this.inputField.value, {
      validators: this.inputValidators,
      actions: this.inputActions,
    });
    if (!accepted) {
      this.inputStatus.textContent = input.invalidMessage;
      return false;
    }
    this.inputStatus.textContent = '';
    this.inputField.value = '';
    this.sounds.play('send');
    this.appendHistory();
    this.renderResponses();
    this.pump();
    return true;
  }
  scrollLatest() {
    if (this.followLatest && this.log?.isConnected) this.log.scrollTop = this.log.scrollHeight;
  }
  renderTransfer(row, key) {
    const file = this.progression.data.files[key];
    if (!file) return;
    const owner = this.thread.getEvents().find((event) => event.id === file.dialogue);
    const session = owner ? this.sessionFor(owner) : this.session;
    const card = document.createElement('div');
    card.className = 'msn-transfer';
    card.dataset.fileKey = key;
    const title = document.createElement('strong');
    title.textContent = `📎 ${file.name} (${file.sizeLabel})`;
    const status = document.createElement('small');
    status.textContent =
      file.status === 'complete'
        ? 'Transfert terminé'
        : file.status === 'declined'
          ? 'Transfert refusé'
          : file.transferState === 'accepted'
            ? 'Transfert accepté'
            : file.transferState === 'in-progress'
              ? 'Transfert en cours…'
              : file.direction === 'send'
                ? 'Fichier prêt à envoyer'
                : 'Un fichier vous est proposé';
    const meter = document.createElement('progress');
    meter.max = 1;
    meter.value = file.status === 'complete' ? 1 : 0;
    const button = document.createElement('button');
    button.className = 'xp-button transfer-accept';
    button.textContent = file.direction === 'send' ? 'Envoyer' : 'Accepter';
    button.hidden = file.status !== 'pending' || file.transferState === 'accepted' || file.transferState === 'in-progress';
    const refuse = document.createElement('button');
    refuse.className = 'xp-button transfer-refuse';
    refuse.textContent = 'Refuser';
    refuse.hidden = file.status !== 'pending' || file.direction === 'send' || file.transferState === 'accepted' || file.transferState === 'in-progress';
    refuse.addEventListener('click', () => {
      if (this.transfer?.key === key || !session.declineTransfer(key)) return;
      status.textContent = 'Transfert refusé';
      button.hidden = true;
      refuse.hidden = true;
      if (file.extractable === 'bomb-arena')
        this.onTransferDeclined({ file, dialogueId: owner?.id ?? this.dialogue.id });
      if (!this.pending) this.pump();
    });
    button.addEventListener('click', () => {
      if (this.transfer) return;
      if (!this.progression.acceptTransfer(key)) return;
      button.disabled = true;
      status.textContent = file.transferState === 'accepted' ? 'Transfert accepté' : 'Transfert en cours…';
      refuse.hidden = true;
      this.transfer = { key, elapsed: Math.max(0, Date.now() - (file.transferStartedAt ?? Date.now())), meter, status, button, started: file.transferState === 'in-progress' };
      this.sounds.play('send');
    });
    card.append(title, status, meter, button, refuse);
    row.append(card);
    if (file.status === 'pending' && ['accepted', 'in-progress'].includes(file.transferState)) {
      this.transfer ??= {
        key,
        elapsed: Math.max(0, Date.now() - (file.transferStartedAt ?? Date.now())),
        meter,
        status,
        button,
        started: file.transferState === 'in-progress',
      };
      meter.value = Math.min(1, this.transfer.elapsed / 1800);
    }
  }
  pump() {
    if (this.offlineContact) {
      this.choices.replaceChildren();
      this.typing.textContent = this.offlineContact.online
        ? 'Ce contact n’a pas encore envoyé de message.'
        : 'Ce contact est hors ligne. L\u2019envoi de messages est indisponible.';
      if (this.typingIndicator) this.typingIndicator.hidden = true;
      return;
    }
    this.renderResponses();
    this.renderInput();
    this.renderTyping();
    this.receiving = this.thread.isReceiving(this.session.dialogue.id);
    if (this.receiving) {
      this.pending = null;
      this.typing.textContent = '';
      this.renderTyping();
      return;
    }
    for (let transitions = 0; transitions < 100; transitions++) {
      const message = this.session.nextMessage();
      if (message) {
        this.thread.schedule(this.dialogue);
        this.receiving = true;
        this.pending = null;
        this.renderTyping();
        this.typing.textContent = '';
        this.scrollLatest();
        return;
      }
      if (this.session.advance()) continue;
      if (this.session.input) {
        this.typing.textContent = '';
        this.renderInput();
        return;
      }
      if (this.session.state.finished) {
        const stayOnline = this.dialogue.completion?.stayOnline;
        this.element.classList.toggle('contact-away', !stayOnline);
        this.typing.textContent = stayOnline
          ? ''
          : `${this.dialogue.contact.name} est absente · à tout à l’heure !`;
        this.element.querySelector('.contact-status').textContent = stayOnline
          ? this.contactStatus(this.dialogue)
          : 'Partie choisir une image perso';
        const pendingFile = this.session.state.transcript.some(
          (entry) =>
            entry.type === 'file' &&
            this.progression.data.files[entry.fileKey]?.status === 'pending',
        );
        if (!pendingFile) this.onCheckpoint(this.dialogue.id);
        if (pendingFile) this.typing.textContent = 'Termine le transfert quand tu le souhaites.';
        if (!this.thread.pendingResponses.length && !this.thread.hasPendingMessages) {
          this.choices.replaceChildren();
          this.responseSignature = JSON.stringify([false, []]);
        } else {
          this.element.classList.remove('contact-away');
          this.typing.textContent = 'À toi de répondre :)';
        }
        this.scrollLatest();
        return;
      }
      this.typing.textContent = 'À toi de répondre :)';
      if (this.session.node.transfer) {
        this.typing.textContent = 'Tu peux accepter ou refuser le fichier quand tu veux.';
        return;
      }
      this.renderResponses();
      this.scrollLatest();
      return;
    }
    throw new Error('Le dialogue contient une boucle automatique.');
  }
  renderTyping(now = Date.now()) {
    if (!this.typingIndicator) return;
    const contacts = this.offlineContact
      ? []
      : (this.thread.typingContacts?.(now) ?? [this.thread.typingContact(now)].filter(Boolean));
    const names = contacts.map((contact) => contact.nickname ?? contact.name).filter(Boolean);
    const participants =
      names.length < 2
        ? names[0] ?? ''
        : `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`;
    const text = participants
      ? `${participants} ${names.length > 1 ? 'sont' : 'est'} en train d'écrire...`
      : '';
    const changed = this.typingIndicator.textContent !== text;
    if (changed) this.typingIndicator.textContent = text;
    this.typingIndicator.classList.toggle('is-typing', names.length > 0);
    this.typingIndicator.hidden = names.length === 0;
  }
  renderResponses() {
    if (this.offlineContact) return;
    if (!this.choices || this.ghost) return;
    // One narrative question at a time, in order. Other questions stay saved.
    const groups = this.thread.availableResponses.slice(0, 1);
    const signature = JSON.stringify([
      this.thread.hasPendingMessages,
      groups.map((group) => [
        group.definition.id,
        this.progression.data.dialogues[group.definition.id].node,
        group.choices.map((choice) => choice.id),
        group.position,
      ]),
    ]);
    if (signature === this.responseSignature) return;
    this.responseSignature = signature;
    this.choices.replaceChildren();
    for (const group of groups) {
      const { definition } = group;
      const session = this.sessionFor(definition);
      session.offerChoices();
      const panel = this.choices;
      panel.dataset.eventId = definition.id;
      for (const choice of group.choices) {
        const button = document.createElement('button');
        button.className = 'xp-button dialogue-choice';
        button.dataset.choiceId = choice.id;
        appendMessageText(button, choice.text);
        button.addEventListener('click', () => {
          if (!button.isConnected || button.disabled || this.thread.hasPendingMessages) return;
          panel.querySelectorAll('button').forEach((item) => {
            item.disabled = true;
          });
          const selectedChoice = ConversationWindow.prototype.chooseResponse.call(
            this,
            group.definition,
            session,
            choice.id,
          );
          this.dialogue = definition;
          this.session = session;
          this.pending = null;
          this.lastFrame = null;
          this.element.classList.remove('contact-away');
          ConversationWindow.prototype.playChoiceSound.call(this, selectedChoice);
          this.appendHistory();
          this.renderResponses();
          const echo = this.session.takeEcho();
          if (echo) {
            this.choices.replaceChildren();
            this.ghost = this.appendMessage({ speaker: 'player', text: echo.text });
            this.ghost.classList.add('dialogue-echo');
            this.echoRemaining = echo.durationMs;
            this.typing.textContent = '';
            return;
          }
          this.pump();
          this.choices.querySelector('button')?.focus();
        });
        panel.append(button);
      }
    }
    if (groups.length) this.element.classList.remove('contact-away');
  }
  finishImmediately(random = Math.random, log = (message) => console.info(message)) {
    if (
      this.offlineContact ||
      !this.element?.isConnected ||
      this.devFastForwarding ||
      !this.thread ||
      !this.session ||
      (this.session.state.finished &&
        !this.thread.pendingResponses.length &&
        !this.thread.hasPendingMessages)
    )
      return false;

    if (this.session.input) return false;

    this.devFastForwarding = true;
    const nickname = this.dialogue.contact.nickname;
    let choiceNumber = 0;
    let operations = 0;
    const maxOperations = 1000;
    log(`[DEV] Conversation : ${nickname}`);
    try {
      this.pending = null;
      this.receiving = false;
      if (this.typing) this.typing.textContent = '';
      if (this.typingIndicator) {
        this.typingIndicator.textContent = '';
        this.typingIndicator.hidden = true;
        this.typingIndicator.classList.remove('is-typing');
      }

      // Ctrl+Shift+F finishes only the event shown in this conversation window.
      // Other events in the same contact thread must remain scheduled normally.
      const events = [this.dialogue];
      while (operations++ < maxOperations) {
        // Deliver one scripted message at a time through DialogueSession so its
        // transcript and save data stay identical to ordinary playback.
        let delivered = false;
        for (const definition of events) {
          const session = this.sessionFor(definition);
          if (session.state.finished) continue;
          const message = session.nextMessage();
          if (!message) continue;
          if (!session.deliver(Date.now())) {
            this.pump();
            return false;
          }
          delete session.state.receiveDueAt;
          session.persist();
          this.thread.sync();
          this.appendHistory();
          delivered = true;
          break;
        }
        if (delivered) continue;

        const transferEvent = events.find((definition) => {
          const session = this.sessionFor(definition);
          return session.node.transfer && session.activeTransfer?.status === 'pending';
        });
        if (transferEvent) {
          const session = this.sessionFor(transferEvent);
          const file = session.activeTransfer;
          // Finishing the BombArena conversation must apply its scripted ZIP
          // transfer; randomness remains for unrelated fictional transfers.
          const accepted =
            file.extractable === 'bomb-arena' || Number(random()) >= 0.5;
          if (accepted) {
            this.progression.finishTransfer(file.key);
            this.onFilesChanged();
          } else session.declineTransfer(file.key);
          log(`[DEV] Transfert ${accepted ? 'accepté' : 'refusé'} : "${file.name}"`);
          continue;
        }

        // Resolve automatic joins, then make the same persisted choice record
        // used by the normal response buttons.
        let advanced = false;
        for (const definition of events) {
          const session = this.sessionFor(definition);
          const unresolvedTransfer =
            session.node.transfer &&
            !['complete', 'declined'].includes(session.activeTransfer?.status);
          if (session.state.finished || session.choices.length || unresolvedTransfer) continue;
          if (session.advance()) {
            advanced = true;
            break;
          }
          if (session.state.finished) {
            this.onCheckpoint(definition.id);
            advanced = true;
            break;
          }
        }
        if (advanced) continue;

        const currentSession = this.sessionFor(this.dialogue);
        const pendingChoices = currentSession.choices;
        if (pendingChoices.length) {
          const session = currentSession;
          const offeredChoices = session.offerChoices();
          if (!offeredChoices.length) continue;
          const value = Number(random());
          const index = Number.isFinite(value)
            ? Math.min(offeredChoices.length - 1, Math.max(0, Math.floor(value * offeredChoices.length)))
            : 0;
          const choice = offeredChoices[index];
          this.chooseResponse(this.dialogue, session, choice.id);
          choiceNumber++;
          log(`[DEV] Choix ${choiceNumber} : "${choice.text}"`);
          this.thread.sync();
          this.appendHistory();
          continue;
        }

        const unfinished = events.some((definition) => {
          const session = this.sessionFor(definition);
          return !session.state.finished && !session.node.transfer;
        });
        if (!unfinished) {
          this.dialogue = this.thread.activeDefinition ?? this.dialogue;
          this.session = this.sessionFor(this.dialogue);
          this.element.classList.toggle('contact-away', !this.dialogue.completion?.stayOnline);
          this.pending = null;
          this.receiving = false;
          this.thread.markRead();
          this.appendHistory();
          this.renderResponses();
          if (this.typing) this.typing.textContent = '';
          this.scrollLatest();
          log('[DEV] Conversation terminée');
          return true;
        }
        return false;
      }
      log(`[DEV] Conversation interrompue : limite d'étapes atteinte`);
      return false;
    } finally {
      this.devFastForwarding = false;
    }
  }
  tick(time) {
    if (!this.element?.isConnected || this.offlineContact) return;
    const delta =
      this.lastFrame === null || this.lastFrame === undefined ? 0 : time - this.lastFrame;
    this.lastFrame = time;
    if (!document.hidden && !this.element.hidden && this.ghost) {
      this.echoRemaining -= delta;
      if (this.echoRemaining <= 0) {
        this.ghost.remove();
        this.ghost = null;
        this.pump();
      }
    }
    if (!document.hidden && !this.element.hidden && this.transfer) {
      const transfer = this.transfer;
      transfer.elapsed += delta;
      transfer.meter.value = Math.min(1, transfer.elapsed / 1800);
      if (transfer.elapsed >= 1800) {
        this.progression.finishTransfer(transfer.key);
        transfer.status.textContent = 'Transfert terminé';
        transfer.button.hidden = true;
        this.transfer = null;
        this.onFilesChanged();
        this.sounds.play('message');
        if (!this.pending) this.pump();
      }
      else if (!transfer.started) {
        this.progression.startTransfer(transfer.key, Date.now());
        transfer.started = true;
        transfer.elapsed = 0;
        transfer.status.textContent = 'Transfert en cours…';
      }
    }
    this.renderTyping();
    this.frame = requestAnimationFrame((next) => this.tick(next));
  }
  dispose(dismissal) {
    this.onDispose?.(this, dismissal);
    this.unsubscribeIdentity?.();
    this.unsubscribeIdentity = null;
    this.logObserver?.disconnect();
    cancelAnimationFrame(this.frame);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.pending = null;
    this.ghost = null;
    this.transfer = null;
    this.lastFrame = null;
    this.element = null;
    this.log = null;
    this.flow = null;
    this.history = null;
    this.typingIndicator = null;
    this.choices = null;
    this.composer = null;
    this.inputField = null;
    this.inputStatus = null;
    this.session = null;
    this.renderedKeys = null;
    this.responseSignature = null;
    this.contactsSignature = null;
    this.sessions.clear();
    this.onWindowState({ open: false, minimized: false });
  }
  openContacts() {
    return this.onContactsRequested?.();
  }
  closeForViewSwitch() {
    if (!this.element?.isConnected) return;
    this.switchingView = true;
    try {
      this.manager.close(Number(this.element.dataset.windowId));
    } finally {
      this.switchingView = false;
    }
  }
  showContacts() {
    return this.onContactsRequested?.();
  }
}
