import data from './data.json' with { type: 'json' };
import { HOPLA_HOTEL_URL } from './model.js';
import { renderHoplaHotelRoom } from './render.js';
import { createGameMusic } from '../../../audio/game-music.js';

const discoMusicUrl = new URL(
  '../../../../assets/producesplatinum-disco-483559.mp3',
  import.meta.url,
).href;

// A simulated desktop application; rooms and movement stay in the existing renderer.
export class HoplaHotelClient {
  constructor(manager, applications, onHome, getMusicVolume = () => 1) {
    Object.assign(this, { manager, applications, onHome, getMusicVolume });
  }
  setMusicVolume(value) {
    this.discoMusic?.setMasterVolume(value);
  }
  stopMusic() {
    this.discoMusic?.stop();
    this.activeMusic = null;
    this.musicStopped = true;
  }
  updateMusic(room) {
    if (room.id !== 'discotheque') {
      if (this.activeMusic === 'discoMusic') this.discoMusic?.stop();
      this.activeMusic = null;
      this.musicStopped = true;
      return;
    }
    if (this.activeMusic === 'discoMusic' && !this.musicStopped) return;
    this.discoMusic ??= createGameMusic(discoMusicUrl, undefined, this.getMusicVolume());
    this.activeMusic = 'discoMusic';
    this.musicStopped = false;
    this.discoMusic.start();
  }
  disposeMusic() {
    this.discoMusic?.dispose();
    this.discoMusic = this.activeMusic = null;
    this.musicStopped = true;
  }
  open() {
    if (this.instance?.element.isConnected) {
      if (this.musicStopped && this.room?.id === 'discotheque') {
        this.musicStopped = false;
        this.showRoom(this.room ?? data.room);
      }
      this.applications.restore(this.instance);
      return this.instance;
    }
    const id = this.manager.spawn('desktopapp', {
      preview: true,
      resizable: true,
      maximizable: true,
      minWidth: 320,
      minHeight: 220,
      content: { title: data.name, iconName: 'browser', body: '' },
      onDismiss: () => {
        const instance = this.instance;
        instance.cleanup?.();
        this.disposeMusic();
        instance.element.removeEventListener('click', instance.home);
        instance.task.remove();
        this.applications.instances.delete('hopla-hotel');
        this.instance = null;
        this.applications.onWindowState();
      },
    });
    const instance = this.applications.attachWindow('hopla-hotel', id, data.name, 'browser');
    this.instance = instance;
    const { element } = instance;
    element.classList.add('hopla-hotel-client');
    instance.onMinimize = () => {
      instance.cleanup?.('pause');
      if (!this.musicStopped) this.discoMusic?.pause();
    };
    instance.onRestore = () => {
      instance.resume?.();
      if (!this.musicStopped) this.discoMusic?.resume();
    };
    instance.home = (event) => {
      const link = event.target.closest('[data-browser-link]');
      if (!link) return;
      event.preventDefault();
      if (link.dataset.browserLink === HOPLA_HOTEL_URL) {
        this.stopMusic();
        this.onHome?.();
      }
    };
    element.addEventListener('click', instance.home);
    // movementBounds already accounts for the real desktop and taskbar, even in arcade mode.
    const area = () => this.manager.movementBounds({ offsetWidth: 0, offsetHeight: 0 });
    const bounds = area();
    const width = (bounds.maxX - bounds.minX) * 0.94;
    const height = (bounds.maxY - bounds.minY) * 0.94;
    Object.assign(element.style, {
      width: `${width}px`,
      height: `${height}px`,
      left: `${bounds.minX + (bounds.maxX - bounds.minX - width) / 2}px`,
      top: `${bounds.minY + (bounds.maxY - bounds.minY - height) / 2}px`,
    });
    this.manager.dragged.add(element);
    this.showRoom(data.room);
    this.applications.restore(instance);
    return instance;
  }
  showRoom(room) {
    const instance = this.instance;
    this.room = room;
    instance.cleanup?.();
    instance.cleanup = instance.resume = null;
    const context = {
      onDispose: (cleanup) => {
        instance.cleanup = cleanup;
      },
      onResume: (resume) => {
        instance.resume = resume;
      },
      navigate: (url) => {
        const destination = [data.room, ...data.rooms].find(
          (item) => url === `${HOPLA_HOTEL_URL}salle/${item.id}`,
        );
        if (destination) this.showRoom(destination);
      },
    };
    instance.element
      .querySelector('.window-body')
      .replaceChildren(renderHoplaHotelRoom(context, data, room));
    this.updateMusic(room);
  }
}
