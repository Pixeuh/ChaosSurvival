const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } = require('electron');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { resolveLocalAsset } = require('./local-assets.cjs');
const { developmentUrl, securityPolicy, protectSession, protectWindow } = require('./security.cjs');
const { createVideoOpener } = require('./video-links.cjs');
const { createQuitHandler } = require('./quit-handler.cjs');

// A packaged executable always loads its own bundled game.
const devUrl = !app.isPackaged ? developmentUrl(process.env.CHAOS_DEV_URL) : undefined;
const policy = securityPolicy(devUrl);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'chaos',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

async function createWindow() {
  const window = new BrowserWindow({
    title: 'Chaos Survival',
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    useContentSize: true,
    backgroundColor: '#3a95d7',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
    },
  });

  window.chaosReady = new Promise((resolve) =>
    window.once('ready-to-show', () => {
      window.show();
      resolve();
    }),
  );
  for (const event of ['enter-full-screen', 'leave-full-screen'])
    window.on(event, () => {
      window.webContents.send('chaos:fullscreen-changed', window.isFullScreen());
    });
  protectWindow(window.webContents);
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      event.preventDefault();
      window.setFullScreen(!window.isFullScreen());
    }
    if (devUrl && input.key === 'F12') {
      event.preventDefault();
      window.webContents.toggleDevTools();
    }
  });

  await window.loadURL(policy.documentUrl);
}

app
  .whenReady()
  .then(async () => {
    ipcMain.handle(
      'chaos:open-video',
      createVideoOpener(policy, (url) => shell.openExternal(url)),
    );
    ipcMain.handle('chaos:quit', createQuitHandler(policy, app));
    ipcMain.handle(
      'chaos:get-fullscreen',
      (event) =>
        policy.trustedSender(event) &&
        (BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false),
    );
    ipcMain.handle('chaos:set-fullscreen', async (event, value) => {
      if (!policy.trustedSender(event) || typeof value !== 'boolean') return false;
      const window = BrowserWindow.fromWebContents(event.sender);
      if (window) await window.chaosReady;
      if (window && typeof value === 'boolean') window.setFullScreen(value);
      return window?.isFullScreen() ?? false;
    });
    Menu.setApplicationMenu(null);
    app.setAppUserModelId('com.chaossurvival.game');
    protectSession(session.defaultSession, policy);

    const assetRoot = path.join(app.getAppPath(), 'dist');
    protocol.handle('chaos', async (request) => {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      try {
        const filename = resolveLocalAsset(assetRoot, request.url);
        if (!filename) return new Response('Forbidden', { status: 403 });
        // Read only the resolved bundle path; do not allow file: requests from the renderer.
        const types = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.gif': 'image/gif',
          '.bmp': 'image/bmp',
          '.ico': 'image/x-icon',
          '.mp3': 'audio/mpeg',
          '.wav': 'audio/wav',
          '.woff': 'font/woff',
          '.woff2': 'font/woff2',
        };
        return new Response(await readFile(filename), {
          headers: {
            'Content-Type':
              types[path.extname(filename).toLowerCase()] || 'application/octet-stream',
            'Content-Security-Policy': policy.csp,
            'X-Content-Type-Options': 'nosniff',
          },
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });

    await createWindow();
    app.on('activate', () => {
      if (!BrowserWindow.getAllWindows().length) createWindow().catch(showStartupError);
    });
  })
  .catch(showStartupError);

function showStartupError(error) {
  dialog.showErrorBox('Chaos Survival — démarrage impossible', error.message);
  app.quit();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
