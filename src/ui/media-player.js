import { applicationName } from './identity.js';
import { mediaAudioResource, isMediaTrack } from './media-library.js';

export function formatMediaTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const whole = Math.floor(seconds);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

export function drawSpectrum(context, width, height, samples) {
  const bars = Math.min(48, samples.length);
  const gap = Math.max(2, width / 180);
  const barWidth = Math.max(2, (width - gap * (bars - 1)) / bars);
  const heights = [];
  for (let index = 0; index < bars; index++) {
    const sample = samples[Math.floor(index * samples.length / bars)] / 255;
    const barHeight = Math.max(2, sample * height * 0.88);
    heights.push(barHeight);
    const x = index * (barWidth + gap);
    const gradient = context.createLinearGradient(0, height - barHeight, 0, height);
    gradient.addColorStop(0, '#9eefff');
    gradient.addColorStop(0.5, '#28a9e0');
    gradient.addColorStop(1, '#194f9c');
    context.fillStyle = gradient;
    context.fillRect(x, height - barHeight, barWidth, barHeight);
  }
  return heights;
}

export class AudioPlayback {
  constructor(audio, onChange = () => {}, preparePlayback = () => {}) {
    this.audio = audio;
    this.onChange = onChange;
    this.preparePlayback = preparePlayback;
    this.tracks = [];
    this.selectedFileId = null;
    this.state = 'stopped';
    this.error = '';
    this.disposed = false;
    this.handlePlaying = () => {
      this.state = 'playing';
      this.error = '';
      this.update();
    };
    this.handlePaused = () => {
      if (this.state !== 'stopped' && this.state !== 'disposed') this.state = 'paused';
      this.update();
    };
    this.handleMetadata = () => this.update();
    this.handleTime = () => this.update();
    this.handleEnded = () => this.next();
    this.handleError = () => {
      this.state = 'paused';
      this.error = 'Ce morceau ne peut pas être lu.';
      this.update();
    };
    audio.addEventListener('playing', this.handlePlaying);
    audio.addEventListener('pause', this.handlePaused);
    audio.addEventListener('loadedmetadata', this.handleMetadata);
    audio.addEventListener('durationchange', this.handleMetadata);
    audio.addEventListener('timeupdate', this.handleTime);
    audio.addEventListener('ended', this.handleEnded);
    audio.addEventListener('error', this.handleError);
  }
  get currentTrack() {
    return this.tracks.find((track) => track.fileId === this.selectedFileId) ?? null;
  }
  get duration() {
    return Number.isFinite(this.audio.duration) && this.audio.duration > 0
      ? this.audio.duration
      : 0;
  }
  setTracks(tracks) {
    this.tracks = tracks.filter((track) => isMediaTrack(track) && track.fileId);
    if (this.selectedFileId && !this.tracks.some((track) => track.fileId === this.selectedFileId)) {
      this.stop();
      this.audio.removeAttribute?.('src');
      this.audio.load?.();
      this.selectedFileId = null;
    }
    this.update();
  }
  select(fileId) {
    const track = this.tracks.find((item) => item.fileId === fileId);
    if (!track) return false;
    this.selectedFileId = fileId;
    this.error = '';
    if (this.audio.src !== track.src) {
      this.audio.src = track.src;
      this.audio.load?.();
    }
    this.update();
    return true;
  }
  async play(fileId = this.selectedFileId) {
    if (this.disposed) return false;
    const track = this.tracks.find((item) => item.fileId === fileId);
    if (!track) return false;
    this.selectedFileId = track.fileId;
    this.error = '';
    this.preparePlayback();
    if (this.audio.src !== track.src) {
      this.audio.src = track.src;
      this.audio.load?.();
    }
    this.update();
    try {
      await this.audio.play();
      this.state = 'playing';
      this.update();
      return true;
    } catch {
      this.state = 'paused';
      this.error = 'Le navigateur a refusé le démarrage de la lecture.';
      this.update();
      return false;
    }
  }
  pause() {
    if (this.disposed || !this.currentTrack) return;
    this.state = 'paused';
    this.audio.pause();
    this.update();
  }
  stop() {
    if (this.disposed) return;
    this.state = 'stopped';
    this.audio.pause();
    try {
      this.audio.currentTime = 0;
    } catch {
      // Metadata may not have loaded yet.
    }
    this.update();
  }
  async previous() {
    if (!this.tracks.length) return false;
    if (this.currentTrack && this.audio.currentTime > 3) {
      this.stop();
      return this.play(this.selectedFileId);
    }
    const index = this.tracks.findIndex((track) => track.fileId === this.selectedFileId);
    return this.play(this.tracks[Math.max(0, index - 1)]?.fileId ?? this.tracks[0].fileId);
  }
  async next() {
    if (!this.tracks.length) return false;
    const index = this.tracks.findIndex((track) => track.fileId === this.selectedFileId);
    const nextTrack = this.tracks[index + 1];
    if (!nextTrack) {
      this.stop();
      return false;
    }
    return this.play(nextTrack.fileId);
  }
  seek(seconds) {
    if (!this.currentTrack || !this.duration) return;
    const target = Number(seconds);
    if (Number.isFinite(target)) this.audio.currentTime = Math.max(0, Math.min(this.duration, target));
    this.update();
  }
  setVolume(value) {
    const next = Math.max(0, Math.min(1, Number(value) || 0));
    this.audio.volume = next;
    this.update();
  }
  setMuted(value) {
    this.audio.muted = Boolean(value);
    this.update();
  }
  toggleMuted() {
    this.setMuted(!this.audio.muted);
  }
  update() {
    if (!this.disposed) this.onChange(this);
  }
  dispose() {
    if (this.disposed) return;
    this.state = 'disposed';
    this.disposed = true;
    this.audio.pause();
    for (const [type, listener] of [
      ['playing', this.handlePlaying],
      ['pause', this.handlePaused],
      ['loadedmetadata', this.handleMetadata],
      ['durationchange', this.handleMetadata],
      ['timeupdate', this.handleTime],
      ['ended', this.handleEnded],
      ['error', this.handleError],
    ]) this.audio.removeEventListener(type, listener);
    this.audio.removeAttribute?.('src');
    this.audio.load?.();
  }
}

const PLAYER_BODY = `

  <section class="wmp-shell" aria-label="Windows Media Play">
    <section class="wmp-now-playing" aria-label="Lecture en cours">
      <div class="wmp-now-title"><strong class="wmp-current-title">Aucun fichier en cours de lecture</strong><span class="wmp-current-artist"></span></div>
      <canvas class="wmp-visualizer" aria-label="Visualisation du signal audio"></canvas>
      <div class="wmp-timeline"><span class="wmp-elapsed">00:00</span><input class="wmp-seek" type="range" min="0" max="0" step="0.01" value="0" aria-label="Position dans le morceau"><span class="wmp-duration">--:--</span></div>
    </section>
    <footer class="wmp-controls">
      <div class="wmp-transport">
        <button type="button" data-media-action="previous" aria-label="Pr&#233;c&#233;dent"><svg class="wmp-control-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M3 4h2v12H3zM8 10l9-6v12z"/></svg></button>
        <button type="button" data-media-action="play" aria-label="Lecture"><svg class="wmp-control-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 3.5 17 10 5 16.5z"/></svg></button>
        <button type="button" data-media-action="pause" aria-label="Pause"><svg class="wmp-control-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 3h4v14H4zM12 3h4v14h-4z"/></svg></button>
        <button type="button" data-media-action="stop" aria-label="Stop"><svg class="wmp-control-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 4h12v12H4z"/></svg></button>
        <button type="button" data-media-action="next" aria-label="Suivant"><svg class="wmp-control-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M15 4h2v12h-2zM12 10 3 4v12z"/></svg></button>
      </div>
      <div class="wmp-volume"><button type="button" data-media-action="mute" aria-label="Muet" aria-pressed="false"><svg class="wmp-control-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M2 7h4l5-4v14l-5-4H2z"/><g class="wmp-volume-waves" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M13 7a4.2 4.2 0 0 1 0 6M15 4.5a7.5 7.5 0 0 1 0 11"/></g><path class="wmp-muted-x" d="m13 7 5 6m0-6-5 6" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button><input class="wmp-volume-range" type="range" min="0" max="100" value="70" aria-label="Volume de Windows Media Play"></div>
      <output class="wmp-status" role="status" aria-live="polite">Pr&ecirc;t</output>
    </footer>
  </section>
`;

export class WindowsMediaPlay {
  constructor(manager, applications, virtualFilesystem, {
    createAudio = () => new Audio(),
    audioContextFactory = () => {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      return Context ? new Context() : null;
    },
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (id) => cancelAnimationFrame(id),
  } = {}) {
    Object.assign(this, { manager, applications, virtualFilesystem, createAudio, audioContextFactory, requestFrame, cancelFrame });
    this.durationCache = new Map();
    this.window = null;
  }
  open(file = null, fileId = file?.fileId) {
    const existing = this.applications.instances.get('windows-media-play');
    if (existing?.element.isConnected) {
      this.applications.restore(existing);
      if (isMediaTrack(file) && fileId) {
        this.syncTracks();
        void this.playFile(fileId);
      }
      return existing;
    }
    const title = applicationName('media');
    const id = this.manager.spawn('desktopapp', {
      preview: true,
      resizable: true,
      maximizable: true,
      minWidth: 420,
      minHeight: 330,
      windowClass: 'windows-media-play-window',
      content: { title, iconName: 'media', body: PLAYER_BODY },
      onDismiss: () => this.disposeWindow(id),
    });
    const instance = this.applications.attachWindow('windows-media-play', id, title, 'media');
    const element = instance.element;
    this.window = { id, instance, element };
    element.querySelector('.window-title > span').textContent = title;
    this.createSession();
    this.bindControls();
    this.syncTracks();
    this.applications.restore(instance);
    if (isMediaTrack(file) && fileId) void this.playFile(fileId);
    return instance;
  }
  createSession() {
    this.audio = this.createAudio();
    this.audio.preload = 'metadata';
    this.audio.volume = 0.7;
    this.context = null;
    this.sourceNode = null;
    this.analyser = null;
    this.visualFrame = 0;
    this.canvas = this.window.element.querySelector('.wmp-visualizer');
    this.canvasContext = this.canvas.getContext?.('2d') ?? null;
    this.playback = new AudioPlayback(this.audio, () => this.renderPlayback(), () => this.preparePlayback());
  }
  bindControls() {
    const { element } = this.window;
    element.querySelectorAll('[data-media-action]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.mediaAction;
        if (action === 'play') void this.playback.play();
        else if (action === 'pause') this.playback.pause();
        else if (action === 'stop') this.playback.stop();
        else if (action === 'previous') void this.playback.previous();
        else if (action === 'next') void this.playback.next();
        else if (action === 'mute') this.playback.toggleMuted();
      });
    });
    element.querySelector('.wmp-seek').addEventListener('input', (event) =>
      this.playback.seek(event.currentTarget.value),
    );
    element.querySelector('.wmp-volume-range').addEventListener('input', (event) =>
      this.playback.setVolume(Number(event.currentTarget.value) / 100),
    );
  }
  tracksFromFilesystem() {
    return ['music', 'downloads']
      .flatMap((location) => this.virtualFilesystem.getLocation(location).items)
      .filter(isMediaTrack)
      .map((file) => ({ ...file, src: mediaAudioResource(file.audioRef) }));
  }
  syncTracks() {
    if (!this.playback || !this.window) return;
    this.playback.setTracks(this.tracksFromFilesystem());
    this.renderPlayback();
  }
  async playFile(fileId) {
    if (!this.window) this.open();
    const track = this.playback.tracks.find((item) => item.fileId === fileId);
    if (!track || !this.virtualFilesystem.exists(fileId)) return false;
    return this.playback.play(fileId);
  }
  preparePlayback() {
    if (!this.context) {
      try {
        this.context = this.audioContextFactory();
        if (this.context) {
          this.analyser = this.context.createAnalyser();
          this.analyser.fftSize = 128;
          this.sourceNode = this.context.createMediaElementSource(this.audio);
          this.sourceNode.connect(this.analyser);
          this.analyser.connect(this.context.destination);
        }
      } catch {
        this.context = null;
        this.analyser = null;
      }
    }
    if (this.context?.state === 'suspended') void this.context.resume().catch(() => {});
  }
  renderPlayback() {
    if (!this.window || !this.playback) return;
    const { element } = this.window;
    const track = this.playback.currentTrack;
    const actualDuration = this.playback.duration;
    if (track && actualDuration) this.durationCache.set(track.fileId, actualDuration);
    element.querySelector('.wmp-current-title').textContent = track?.title ?? 'Aucun fichier en cours de lecture';
    element.querySelector('.wmp-current-artist').textContent = track?.artist ?? '';
    const duration = this.playback.duration || this.durationCache.get(track?.fileId) || 0;
    const seek = element.querySelector('.wmp-seek');
    seek.max = String(duration);
    seek.value = String(Math.min(this.audio.currentTime || 0, duration));
    seek.disabled = !duration;
    element.querySelector('.wmp-elapsed').textContent = formatMediaTime(this.audio.currentTime);
    element.querySelector('.wmp-duration').textContent = formatMediaTime(duration);
    element.querySelector('.wmp-volume-range').value = String(Math.round(this.audio.volume * 100));
    const mute = element.querySelector('[data-media-action="mute"]');
    mute.setAttribute('aria-pressed', String(this.audio.muted));
    mute.setAttribute('aria-label', this.audio.muted ? 'R?activer le son' : 'Muet');
    const status = this.playback.error || (this.playback.state === 'playing'
      ? 'Lecture en cours'
      : this.playback.state === 'paused' ? 'En pause' : 'Pr?t');
    element.querySelector('.wmp-status').textContent = status;
    this.syncVisualizer();
  }
  syncVisualizer() {
    if (this.playback?.state === 'playing' && this.analyser) {
      if (!this.visualFrame) this.visualFrame = this.requestFrame(() => this.drawVisualizer());
      return;
    }
    if (this.visualFrame) this.cancelFrame(this.visualFrame);
    this.visualFrame = 0;
    this.drawRestingVisualizer();
  }
  drawVisualizer() {
    this.visualFrame = 0;
    if (!this.window || this.playback?.state !== 'playing' || !this.analyser || !this.canvasContext) return;
    const canvas = this.canvas;
    const ratio = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = this.canvasContext;
    context.clearRect(0, 0, width, height);
    const samples = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(samples);
    drawSpectrum(context, width, height, samples);
    this.visualFrame = this.requestFrame(() => this.drawVisualizer());
  }
  drawRestingVisualizer() {
    if (!this.canvasContext || !this.canvas) return;
    const ratio = globalThis.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * ratio));
    this.canvas.width = width;
    this.canvas.height = height;
    this.canvasContext.clearRect(0, 0, width, height);
    this.canvasContext.fillStyle = '#356aa1';
    this.canvasContext.fillRect(0, Math.floor(height / 2), width, 1);
  }
  onFilesDeleted() {
    if (!this.window) return;
    this.syncTracks();
  }
  disposeWindow(id) {
    if (!this.window || this.window.id !== id) return;
    if (this.visualFrame) this.cancelFrame(this.visualFrame);
    this.visualFrame = 0;
    this.playback?.dispose();
    this.sourceNode?.disconnect?.();
    this.analyser?.disconnect?.();
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.applications.instances.delete('windows-media-play');
    this.window.instance.task.remove();
    this.window = null;
    this.audio = this.playback = null;
    this.context = this.sourceNode = this.analyser = null;
  }
}
