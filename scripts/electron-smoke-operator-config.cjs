const { app, BrowserWindow } = require('electron');

const targetUrl = process.argv[2] || 'http://127.0.0.1:3030/#/operator-config';

function fail(message) {
  console.error(message);
  app.exit(1);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const timeout = setTimeout(() => {
    fail('operator-config smoke timed out');
  }, 15000);

  try {
    await window.loadURL(targetUrl);
    await window.webContents.executeJavaScript(`
      new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const tick = () => {
          const button = document.querySelector('.config-panel-back-btn');
          if (button) {
            resolve(true);
            return;
          }
          if (Date.now() - startedAt > 10000) {
            reject(new Error('back button not found'));
            return;
          }
          setTimeout(tick, 100);
        };
        tick();
      })
    `);
    await window.webContents.executeJavaScript(`
      document.querySelector('.config-panel-back-btn').click();
      new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const tick = () => {
          if (window.location.hash === '#/' || window.location.hash === '') {
            resolve(window.location.href);
            return;
          }
          if (Date.now() - startedAt > 5000) {
            reject(new Error('return navigation failed: ' + window.location.href));
            return;
          }
          setTimeout(tick, 100);
        };
        tick();
      })
    `);
    clearTimeout(timeout);
    app.exit(0);
  } catch (error) {
    clearTimeout(timeout);
    fail(error instanceof Error ? error.message : String(error));
  }
});
