import { createMiniGame } from './minigame-registry.js';

// Received fictional files unlock engines; the launcher never executes host programs.
export class MiniGameLauncher {
  constructor(
    definitions,
    progression,
    manager,
    sounds,
    beforeOpen = () => {},
    rules,
    onVictory = () => {},
    onFinish = () => {},
    canOpenFile = () => true,
    onWindowOpened = () => {},
  ) {
    Object.assign(this, {
      definitions,
      progression,
      manager,
      sounds,
      beforeOpen,
      rules,
      onVictory,
      onFinish,
      canOpenFile,
      onWindowOpened,
    });
    this.active = null;
  }
  open(file) {
    if (!file.launch || !this.canOpenFile(file)) return null;
    const unlocked = Object.values(this.progression.data.files).some(
      (saved) =>
        saved.id === file.id &&
        saved.status === 'complete' &&
        saved.direction === 'receive' &&
        saved.launch?.game === file.launch.game,
    );
    if (!unlocked) return null;
    const definition = this.definitions[file.launch.game];
    if (!definition) throw new Error('Ce mini-jeu est indisponible.');
    if (this.rules && !this.rules.hasSeen(definition)) {
      this.rules.beforeStart(definition, () => this.open(file));
      return null;
    }
    this.beforeOpen();
    if (!this.active?.element?.isConnected || this.active.definition.id !== definition.id)
      this.active = createMiniGame(definition, this.manager, this.sounds, (result) => {
        this.onFinish(definition, result);
        const sequence = this.progression.current;
        if (
          sequence?.type === 'minigame' &&
          sequence.game === definition.id &&
          result.won !== false &&
          this.progression.complete(sequence.id, result)
        )
          this.onVictory(sequence, result);
      });
    this.active.showRules = () => {
      if (!this.rules) return;
      const game = this.active;
      const paused = game.paused;
      game.paused = true;
      this.rules.review(definition, () => {
        game.paused = paused;
        game.lastFrame = null;
      });
    };
    if (import.meta.env?.DEV && this.active.element)
      this.manager.setDevelopmentContent?.(this.active.element, () => this.active);
    this.sounds.unlock();
    this.active.open();
    this.onWindowOpened(this.active);
    return this.active;
  }
  reset() {
    this.active = null;
  }
}
