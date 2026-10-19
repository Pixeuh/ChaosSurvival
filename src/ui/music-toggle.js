export function createMusicToggle(desktop, audio) {
  const button = document.createElement('button');
  button.className = 'hud-control music-toggle';
  button.id = 'music-toggle-button';
  button.type = 'button';
  button.setAttribute('aria-pressed', 'true');
  desktop.querySelector('.hud').append(button);

  function render() {
    const enabled = !audio.muted;
    button.textContent = `Musique : ${enabled ? 'ON' : 'OFF'}`;
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', `Musique : ${enabled ? 'ON' : 'OFF'}`);
  }

  button.addEventListener('click', () => {
    audio.setMuted(!audio.muted);
    render();
  });
  render();
  return { render };
}
