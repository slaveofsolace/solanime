'use strict';

const { app, BrowserWindow, session } = require('electron');
const { SITE, permittedDocument, blockedRequest, safeHost } = require('./policy.cjs');

app.enableSandbox();

function createWindow() {
  const profile = session.fromPartition('persist:solanime-desktop-preview');
  profile.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(permission === 'fullscreen' &&
      permittedDocument(details?.requestingUrl ?? '', false));
  });
  profile.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    permission === 'fullscreen' && permittedDocument(requestingOrigin, false));
  profile.on('will-download', event => event.preventDefault());
  profile.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const cancel = blockedRequest(details.url, details.resourceType);
    if (cancel) console.warn('Blocked request:', details.resourceType, safeHost(details.url));
    callback({ cancel });
  });

  const window = new BrowserWindow({
    title: 'Solanime Preview',
    width: 1280,
    height: 820,
    minWidth: 360,
    minHeight: 480,
    backgroundColor: '#090909',
    autoHideMenuBar: true,
    webPreferences: {
      partition: 'persist:solanime-desktop-preview',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  });

  const contents = window.webContents;
  let rejectedWindows = 0;
  contents.setWindowOpenHandler(details => {
    rejectedWindows += 1;
    console.warn('Rejected new window:', rejectedWindows, safeHost(details.url));
    return { action: 'deny' };
  });

  function checkNavigation(event) {
    if (permittedDocument(event.url, event.isMainFrame)) return;
    console.warn('Rejected document navigation:', safeHost(event.url),
      'mainFrame=', event.isMainFrame);
    event.preventDefault();
  }
  contents.on('will-frame-navigate', checkNavigation);
  contents.on('will-redirect', checkNavigation);
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
    if (mainFrame) console.error('Solanime page failed:', code, description, safeHost(url));
  });

  void contents.loadURL(SITE);
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
