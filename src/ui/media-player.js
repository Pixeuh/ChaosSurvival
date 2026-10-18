import { icon } from './icons.js';
import libraryMetadata from '../config/media-library.json' with { type: 'json' };
import { mediaLibraryResources } from '../config/media-library-assets.js';
import { subscribeMusicFocus } from '../audio/music-focus.js';

const defaultLibrary = Object.fromEntries(
  Object.entries(libraryMetadata).map(([fileId, metadata]) => [fileId, {
    ...metadata,
    resource: mediaLibraryResources[fileId] ?? null,
  }]),
);

const PLAYER_BODY = `
  <section class="media-player" aria-label="Windows Media Play">
    <nav class="media-player-tabs" aria-label="Navigation du lecteur">
      <button type="button" data-media-view="library" aria-pressed="true">Bibliothèque</button>
      <button type="button" data-media-view="now-playing" aria-pressed="false">Lecture en cours</button>
    </nav>
    <div class="media-player-workspace">
      <section class="media-library-view" data-media-panel="library">
        <h2>Ma musique</h2>
        <p class="media-player-status" role="status">Sélectionnez un morceau.</p>
        <div class="media-track-list" role="list" aria-label="Bibliothèque musicale"></div>
      </section>
      <section class="media-now-playing" data-media-panel="now-playing" hidden>
        <div class="media-track-info"><small>LECTURE EN COURS</small><strong data-media-title>Aucun morceau sélectionné</strong><span data-media-subtitle>Choisissez un fichier dans Ma musique.</span></div>
        <canvas class="media-visualizer" width="640" height="220" aria-label="Visualisation du signal audio"></canvas>
      </section>
    </div>
    <footer class="media-transport">
      <div class="media-transport-buttons">
        <button type="button" data-media-control="previous" aria-label="Précédent">|◀</button>
        <button type="button" data-media-control="play" aria-label="Lecture">▶</button>
        <button type="button" data-media-control="pause" aria-label="Pause">Ⅱ</button>
        <button type="button" data-media-control="stop" aria-label="Stop">■</button>
        <button type="button" data-media-control="next" aria-label="Suivant">▶|</button>
      </div>
      <div class="media-seek-row"><span data-media-elapsed>00:00</span><input data-media-seek type="range" min="0" max="0" step="0.1" value="0" aria-label="Position de lecture" disabled><span data-media-duration>--:--</span></div>
      <div class="media-volume-row"><button type="button" data-media-control="mute" aria-pressed="false">Muet</button><label>Volume <input data-media-volume type="range" min="0" max="100" value="70" aria-label="Volume Windows Media Play"></label><output data-media-volume-value>70 %</output></div>
    </footer>
  </section>`;

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
};

export class MediaPlayer {
  constructor(manager, taskbar, virtualFilesystem, { AudioConstructor, metadata = defaultLibrary, onWindowState = () => {} } = {}) {
    this.manager = manager;
    this.taskbar = taskbar;
    this.virtualFilesystem = virtualFilesystem;
    this.metadata = metadata;
    this.onWindowState = onWindowState;
    this.AudioConstructor = AudioConstructor ?? ((resource) => new Audio(resource));
    this.volume = 0.7;
    this.muted = false;
    this.resumeAfterFocus = false;
    this.focusActive = false;
    this.trackIds = [];
    this.unsubscribeFocus = subscribeMusicFocus((active) => this.onMusicFocus(active));
  }
  open(fileId = null, { autoplay = false } = {}) {
    if (this.instance?.element.isConnected) {
      this.restore();
      if (fileId) this.openFile(fileId, { autoplay });
      return this.instance;
    }
    const id = this.manager.spawn('desktopapp', {
      preview: true, resizable: true, maximizable: true, minWidth: 560, minHeight: 420,
      x: 0.2, y: 0.12, windowClass: 'popup-media-player',
      content: { title: 'Windows Media Play', iconName: 'media-play', body: PLAYER_BODY },
      onDismiss: () => { this.destroyWindow(); this.onWindowState(); },
    });
    const element = this.manager.windows.get(id).element;
    const task = document.createElement('button');
    task.type = 'button';
    task.className = 'task-tab desktop-app-task media-player-task';
    task.dataset.app = 'media-player';
    task.dataset.windowId = String(id);
    task.innerHTML = icon('media-play');
    const label = document.createElement('span');
    label.textContent = 'Windows Media Play';
    task.append(label);
    this.taskbar.insertBefore(task, this.taskbar.querySelector('.tray'));
    this.instance = { id, element, task };
    element.querySelector('.titlebar').insertBefore(
      this.makeMinimizeButton(), element.querySelector('.maximize-button') ?? element.querySelector('.close-button'),
    );
    task.addEventListener('click', () => this.restore());
    this.bind(element);
    this.refreshLibrary();
    this.restore();
    if (fileId) this.openFile(fileId, { autoplay });
    return this.instance;
  }
  makeMinimizeButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'msn-minimize';
    button.textContent = '−';
    button.setAttribute('aria-label', 'Réduire Windows Media Play');
    button.addEventListener('click', () => {
      this.instance.element.hidden = true;
      this.instance.task.setAttribute('aria-pressed', 'false');
    });
    return button;
  }
  restore() {
    if (!this.instance) return;
    this.instance.element.hidden = false;
    this.instance.task.setAttribute('aria-pressed', 'true');
    this.manager.bringToFront(this.instance.element);
  }
  bind(element) {
    this.audio = this.AudioConstructor();
    this.audio.preload = 'metadata';
    this.audio.volume = this.volume;
    this.audio.addEventListener('loadedmetadata', () => this.syncDuration());
    this.audio.addEventListener('durationchange', () => this.syncDuration());
    this.audio.addEventListener('timeupdate', () => this.syncTime());
    this.audio.addEventListener('play', () => { this.playing = true; this.syncControls(); this.startVisualizer(); });
    this.audio.addEventListener('pause', () => { this.playing = false; this.syncControls(); this.stopVisualizer(); });
    this.audio.addEventListener('ended', () => this.next(true));
    this.audio.addEventListener('error', () => this.setStatus('Ce fichier audio ne peut pas être lu. Vérifiez son format ou sa ressource.'));
    this.seek = element.querySelector('[data-media-seek]');
    this.seek.addEventListener('input', () => {
      if (!Number.isFinite(this.audio.duration)) return;
      this.audio.currentTime = Number(this.seek.value);
      this.syncTime();
    });
    element.querySelector('[data-media-volume]').addEventListener('input', (event) => {
      this.volume = Number(event.target.value) / 100;
      this.applyVolume();
      element.querySelector('[data-media-volume-value]').value = `${event.target.value} %`;
    });
    element.querySelector('[data-media-control="mute"]').addEventListener('click', (event) => {
      this.muted = !this.muted;
      event.currentTarget.setAttribute('aria-pressed', String(this.muted));
      event.currentTarget.textContent = this.muted ? 'Son' : 'Muet';
      this.applyVolume();
    });
    element.querySelector('[data-media-control="play"]').addEventListener('click', () => this.play());
    element.querySelector('[data-media-control="pause"]').addEventListener('click', () => this.pause(true));
    element.querySelector('[data-media-control="stop"]').addEventListener('click', () => this.stop());
    element.querySelector('[data-media-control="next"]').addEventListener('click', () => this.next(false));
    element.querySelector('[data-media-control="previous"]').addEventListener('click', () => this.previous());
    element.querySelectorAll('[data-media-view]').forEach((button) => button.addEventListener('click', () => this.showView(button.dataset.mediaView)));
    this.syncControls();
  }
  refreshLibrary() {
    if (!this.instance?.element.isConnected) return;
    const list = this.instance.element.querySelector('.media-track-list');
    const files = this.virtualFilesystem.getLocation('music').items.filter((item) => /\.(mp3|ogg|wav|m4a)$/i.test(item.name));
    this.trackIds = files.map((file) => file.fileId);
    list.replaceChildren();
    for (const file of files) {
      const metadata = this.metadata[file.fileId] ?? {};
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'media-track';
      row.dataset.fileId = file.fileId;
      row.setAttribute('role', 'listitem');
      const title = document.createElement('strong');
      title.textContent = metadata.title ?? file.name.replace(/\.(mp3|ogg|wav|m4a)$/i, '');
      const details = document.createElement('span');
      details.textContent = `${metadata.artist ?? 'Artiste inconnu'} · ${metadata.source ?? 'Fichier audio'}`;
      const duration = document.createElement('small');
      duration.textContent = 'Durée inconnue';
      const availability = document.createElement('em');
      availability.textContent = metadata.resource ? 'Disponible' : 'Ressource indisponible';
      row.append(title, details, duration, availability);
      row.addEventListener('click', () => this.select(file.fileId, false));
      list.append(row);
    }
    if (this.selectedId && !this.trackIds.includes(this.selectedId)) {
      this.stop();
      this.selectedId = null;
      this.setStatus('Le fichier sélectionné a été supprimé.');
    }
  }
  openFile(fileId, { autoplay = false } = {}) {
    if (!this.virtualFilesystem.exists(fileId) || !/\.(mp3|ogg|wav|m4a)$/i.test(fileId)) return null;
    this.refreshLibrary();
    return this.select(fileId, autoplay);
  }
  select(fileId, autoplay) {
    const file = this.virtualFilesystem.getFile(fileId);
    if (!file || !/\.(mp3|ogg|wav|m4a)$/i.test(file.name)) return null;
    this.selectedId = fileId;
    const metadata = this.metadata[fileId] ?? {};
    this.instance.element.querySelector('[data-media-title]').textContent = metadata.title ?? file.name.replace(/\.(mp3|ogg|wav|m4a)$/i, '');
    this.instance.element.querySelector('[data-media-subtitle]').textContent = `${metadata.artist ?? 'Artiste inconnu'} · ${metadata.source ?? 'Fichier audio'}`;
    this.instance.element.querySelectorAll('.media-track').forEach((row) => row.setAttribute('aria-current', String(row.dataset.fileId === fileId)));
    if (this.currentResource !== metadata.resource) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.currentResource = null;
      this.playing = false;
      this.syncDuration();
      this.syncTime();
    }
    if (!metadata.resource) {
      this.setStatus('Cette piste est répertoriée, mais sa ressource audio n’est pas encore installée.');
      this.syncControls();
      this.showView('now-playing');
      return file;
    }
    if (this.currentResource !== metadata.resource) {
      this.currentResource = metadata.resource;
      this.audio.src = metadata.resource;
      this.audio.load();
    }
    this.setStatus('Prêt à lire.');
    this.showView('now-playing');
    if (autoplay) this.play();
    return file;
  }
  async play() {
    if (!this.selectedId) {
      const candidate = this.trackIds.find((id) => this.metadata[id]?.resource);
      if (candidate) this.select(candidate, false);
    }
    if (!this.selectedId || !this.currentResource) {
      this.setStatus('Aucune ressource audio disponible à la lecture.');
      return false;
    }
    this.userPaused = false;
    if (this.focusActive) {
      this.resumeAfterFocus = true;
      this.setStatus('En attente de la fin de la musique du jeu.');
      return true;
    }
    try {
      await this.audio.play();
      this.setStatus('Lecture en cours.');
      return true;
    } catch {
      this.setStatus('La lecture a été refusée par le navigateur. Réessayez.');
      return false;
    }
  }
  pause(manual = false) {
    if (manual) {
      this.userPaused = true;
      this.resumeAfterFocus = false;
    }
    this.audio?.pause();
    this.setStatus('Lecture en pause.');
  }
  stop() {
    if (!this.audio) return;
    this.userPaused = false;
    this.resumeAfterFocus = false;
    this.audio.pause();
    try { this.audio.currentTime = 0; } catch { /* Metadata may not have loaded. */ }
    this.syncTime();
    this.setStatus('Lecture arrêtée.');
  }
  next(automatic) {
    if (!this.trackIds.length) return;
    const index = this.trackIds.indexOf(this.selectedId);
    if (index < 0 || index + 1 >= this.trackIds.length) {
      if (automatic) this.stop();
      else this.setStatus('Fin de la bibliothèque.');
      return;
    }
    this.select(this.trackIds[index + 1], automatic || Boolean(this.playing));
  }
  previous() {
    if (this.audio && this.audio.currentTime > 3) {
      this.audio.currentTime = 0;
      this.syncTime();
      return;
    }
    const index = this.trackIds.indexOf(this.selectedId);
    if (index > 0) this.select(this.trackIds[index - 1], Boolean(this.playing));
    else if (this.selectedId) this.audio.currentTime = 0;
  }
  onMusicFocus(active) {
    this.focusActive = active;
    if (!this.audio) return;
    if (active && !this.audio.paused) {
      this.resumeAfterFocus = !this.userPaused;
      this.audio.pause();
      this.setStatus('En pause pendant la musique du jeu.');
    } else if (!active && this.resumeAfterFocus && !this.userPaused && this.instance?.element.isConnected) {
      this.resumeAfterFocus = false;
      this.play();
    }
  }
  applyVolume() { if (this.audio) this.audio.volume = this.muted ? 0 : this.volume; }
  syncDuration() {
    if (!this.instance) return;
    const duration = this.audio?.duration;
    this.seek.max = Number.isFinite(duration) ? String(duration) : '0';
    this.seek.disabled = !Number.isFinite(duration);
    this.instance.element.querySelector('[data-media-duration]').textContent = formatTime(duration);
    const row = [...this.instance.element.querySelectorAll('.media-track')]
      .find((track) => track.dataset.fileId === this.selectedId)?.querySelector('small');
    if (row) row.textContent = formatTime(duration);
  }
  syncTime() {
    if (!this.instance) return;
    const time = Number.isFinite(this.audio?.currentTime) ? this.audio.currentTime : 0;
    this.seek.value = String(time);
    this.instance.element.querySelector('[data-media-elapsed]').textContent = formatTime(time);
  }
  syncControls() {
    if (!this.instance) return;
    this.instance.element.querySelector('[data-media-control="play"]').disabled = Boolean(this.playing);
    this.instance.element.querySelector('[data-media-control="pause"]').disabled = !this.playing;
    this.instance.element.querySelector('[data-media-control="stop"]').disabled = !this.selectedId;
  }
  setStatus(message) { if (this.instance) this.instance.element.querySelector('.media-player-status').textContent = message; }
  showView(view) {
    if (!this.instance) return;
    this.instance.element.querySelectorAll('[data-media-panel]').forEach((panel) => { panel.hidden = panel.dataset.mediaPanel !== view; });
    this.instance.element.querySelectorAll('[data-media-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mediaView === view)));
  }
  startVisualizer() {
    if (!this.instance || this.visualizerFrame) return;
    const canvas = this.instance.element.querySelector('.media-visualizer');
    const context = canvas.getContext?.('2d');
    if (!context) return;
    try {
      const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextClass) return;
      this.audioContext ??= new AudioContextClass();
      this.analyser ??= this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      if (!this.sourceNode) {
        this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
        this.sourceNode.connect(this.analyser);
        this.analyser.connect(this.audioContext.destination);
      }
      this.audioContext.resume().catch(() => {});
    } catch { this.analyser = null; }
    if (!this.analyser) return;
    const values = new Uint8Array(this.analyser.frequencyBinCount);
    const draw = () => {
      if (!this.playing || !this.instance?.element.isConnected) { this.visualizerFrame = 0; return; }
      this.analyser.getByteFrequencyData(values);
      context.clearRect(0, 0, canvas.width, canvas.height);
      const width = canvas.width / values.length;
      values.forEach((value, index) => {
        const height = value / 255 * (canvas.height - 16);
        const gradient = context.createLinearGradient(0, canvas.height - height, 0, canvas.height);
        gradient.addColorStop(0, '#70eaff'); gradient.addColorStop(1, '#2861c8');
        context.fillStyle = gradient;
        context.fillRect(index * width + 2, canvas.height - height, width - 4, height);
      });
      this.visualizerFrame = requestAnimationFrame(draw);
    };
    this.visualizerFrame = requestAnimationFrame(draw);
  }
  stopVisualizer() {
    if (this.visualizerFrame) cancelAnimationFrame(this.visualizerFrame);
    this.visualizerFrame = 0;
    const canvas = this.instance?.element.querySelector('.media-visualizer');
    canvas?.getContext?.('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }
  destroyWindow() {
    this.stopVisualizer();
    this.audio?.pause();
    this.audio?.removeAttribute('src');
    this.audio?.load();
    this.audio = null;
    this.sourceNode?.disconnect?.();
    this.analyser?.disconnect?.();
    this.sourceNode = null;
    this.analyser = null;
    const closing = this.audioContext?.close?.();
    closing?.catch?.(() => {});
    this.audioContext = null;
    this.instance?.task.remove();
    this.instance = null;
    this.playing = false;
    this.selectedId = null;
    this.currentResource = null;
    this.resumeAfterFocus = false;
  }
  dispose() {
    this.destroyWindow();
    this.unsubscribeFocus?.();
  }
}
