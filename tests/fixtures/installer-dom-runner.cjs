const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.setPath('userData', path.join(require('node:os').tmpdir(), 'chaos-survival-installer-dom-test'));

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 800,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  const errors = [];
  window.webContents.on('console-message', (_event, levelOrDetails, legacyMessage) => {
    const level = typeof levelOrDetails === 'object' ? levelOrDetails.level : levelOrDetails;
    const message = typeof levelOrDetails === 'object' ? levelOrDetails.message : legacyMessage;
    if (level === 'error' || level >= 2) errors.push(message);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    errors.push(`Renderer exited: ${details.reason}`);
  });

  try {
    await window.loadFile(path.join(__dirname, 'installer-dom.html'));
    const result = await window.webContents.executeJavaScript('window.runInstallerDomScenarios()');
    errors.push(...result.errors);
    process.stdout.write(`INSTALLER_DOM_RESULT:${JSON.stringify({ result: result.scenarios, errors })}\n`);
    app.exit(errors.length ? 1 : 0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
