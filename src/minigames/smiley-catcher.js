import { smileyIcon } from './smiley-icons.js';
import { createGameMusic } from '../audio/game-music.js';

const smileyMusicUrl = new URL(
  '../../assets/djartmusic-i-love-my-8-bit-game-console-301272.mp3',
  import.meta.url,
).href;

export class SmileyCatcher {
  constructor(definition, manager, sounds, onComplete) {
    this.definition = definition;
    this.manager = manager;
    this.sounds = sounds;
    this.onComplete = onComplete;
    this.music = createGameMusic(smileyMusicUrl);
    this.elapsed = 0;
    this.score = 0;
    this.combo = 0;
    this.spawnClock = 0;
    this.targets = [];
  }
  open() {
    if (this.element?.isConnected) {
      this.element.style.zIndex = ++this.manager.z;
      return;
    }
    const id = this.manager.spawn('minigame', {
      preview: true,
      x: 0.2,
      y: 0.12,
      content: {
        title: 'SUPER_MEGA_GAME.exe',
        iconName: 'music',
        body: /* HTML */ `<div class="flash-game">
          <h2>SMILEY CATCHER <span>2009 ★</span></h2>
          <p>Clique sur les smileys ! Le clic le plus MEGA de ta vie !!!</p>
          <div class="flash-stats">
            <strong class="flash-score"></strong><span class="flash-time"></span
            ><button class="xp-button flash-pause">Pause</button
            ><button class="xp-button flash-rules" aria-label="R?gles du mini-jeu">?</button>
          </div>
          <div class="smiley-arena" aria-label="Smileys à attraper"></div>
          <div class="flash-feedback" role="status">LET'S GOOOO !!!</div>
          <div class="flash-result" hidden>
            <h3>YOU ARE AWESOME !!!</h3>
            <strong></strong>
            <p>★★★★★ MEGA CHAMPION ★★★★★</p>
            <button class="xp-button flash-return">Retour au bureau</button
            ><button class="xp-button flash-replay">Encore !!!</button>
          </div>
        </div>`,
      },
      onDismiss: () => this.dispose(),
    });
    this.element = this.manager.windows.get(id).element;
    this.arena = this.element.querySelector('.smiley-arena');
    this.feedback = this.element.querySelector('.flash-feedback');
    this.result = this.element.querySelector('.flash-result');
    this.element
      .querySelector('.flash-return')
      .addEventListener('click', () => this.manager.close(id));
    this.element.querySelector('.flash-replay').addEventListener('click', () => {
      this.resetRound();
      this.spawn();
      this.render();
      this.music.start();
      this.startLoop();
    });
    this.element.querySelector('.flash-pause').addEventListener('click', (event) => {
      this.paused = !this.paused;
      event.target.textContent = this.paused ? 'Reprendre' : 'Pause';
      if (this.paused) this.music.pause();
      else this.music.resume();
    });
    this.element.querySelector('.flash-rules').addEventListener('click', () => this.showRules?.());
    this.resetRound();
    this.onVisibility = () => {
      this.lastFrame = null;
    };
    this.spawn();
    this.render();
    this.music.start();
    this.startLoop();
  }
  startLoop() {
    cancelAnimationFrame(this.frame);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.frame = requestAnimationFrame((time) => this.tick(time));
  }
  resetRound() {
    this.elapsed = 0;
    this.score = 0;
    this.combo = 0;
    this.spawnClock = 0;
    this.targets = [];
    this.arena.replaceChildren();
    this.result.hidden = true;
    this.paused = false;
    this.finished = false;
    this.lastFrame = null;
    this.element.querySelector('.flash-pause').textContent = 'Pause';
  }
  spawn() {
    if (this.targets.length >= this.definition.maxTargets) return;
    const target = document.createElement('button');
    target.className = 'catch-smiley';
    target.innerHTML = smileyIcon(Math.floor(Math.random() * 4));
    target.setAttribute('aria-label', 'Attraper le smiley');
    target.style.left = `${Math.random() * Math.max(0, this.arena.clientWidth - 62)}px`;
    target.style.top = `${Math.random() * Math.max(0, this.arena.clientHeight - 62)}px`;
    const item = { element: target, expires: this.elapsed + this.definition.targetLifetimeSeconds };
    this.targets.push(item);
    this.arena.append(target);
    target.addEventListener('click', () => {
      if (this.finished || this.paused || !target.isConnected) return;
      this.combo++;
      this.score += 100 + Math.min(this.combo, 5) * 25;
      this.feedback.textContent = this.combo >= 3 ? 'MEGA COMBO !!!' : 'AWESOME !!!';
      this.targets = this.targets.filter((entry) => entry !== item);
      target.remove();
      this.sounds.play('catch');
      this.render();
    });
  }
  render() {
    this.element.querySelector('.flash-score').textContent = `SCORE ${this.score}`;
    this.element.querySelector('.flash-time').textContent =
      `${Math.ceil(Math.max(0, this.definition.durationSeconds - this.elapsed))} s`;
  }
  tick(time) {
    if (!this.element?.isConnected || this.finished) return;
    const delta = this.lastFrame === null ? 0 : (time - this.lastFrame) / 1000;
    this.lastFrame = time;
    if (!document.hidden && !this.paused && !this.finished) {
      this.elapsed = Math.min(this.definition.durationSeconds, this.elapsed + delta);
      this.spawnClock += delta;
      this.targets = this.targets.filter((item) => {
        if (item.expires > this.elapsed) return true;
        item.element.remove();
        this.combo = 0;
        return false;
      });
      if (this.spawnClock >= this.definition.spawnSeconds) {
        this.spawnClock = 0;
        this.spawn();
      }
      this.render();
      if (this.elapsed >= this.definition.durationSeconds) return this.finish();
    }
    this.frame = requestAnimationFrame((next) => this.tick(next));
  }
  finish() {
    if (!this.element?.isConnected || this.finished) return false;
    this.finished = true;
    this.music.stop();
    cancelAnimationFrame(this.frame);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.elapsed = this.definition.durationSeconds;
    this.targets = [];
    this.arena.replaceChildren();
    this.render();
    this.result.hidden = false;
    this.result.querySelector('strong').textContent = `${this.score} MEGA POINTS !!!`;
    this.sounds.play('victory');
    this.onComplete({ score: this.score, duration: this.elapsed });
    return true;
  }
  dispose() {
    this.music.dispose();
    cancelAnimationFrame(this.frame);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.targets = [];
    this.element = null;
    this.lastFrame = null;
  }
}
