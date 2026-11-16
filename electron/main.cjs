// StreamHub desktop: starts the built-in server (front-end + stream proxy)
// on a fixed local port and opens it in an app window.
const { app, BrowserWindow, shell, dialog } = require('electron')
const path = require('node:path')
const { autoUpdater } = require('electron-updater')
// Bundled together with this file by scripts/build-desktop-server.mjs.
const { startServer } = require('../server/app.ts')

// The bundle lives in electron/app/, so the project root is two folders up.
const ROOT = path.join(__dirname, '..', '..')

// Fixed port: the playlist and preferences are saved per address, so it must not change.
const PORT = 51730
const HOST = '127.0.0.1'
const APP_URL = `http://${HOST}:${PORT}/`

// Channels start with sound, and HEVC uses the graphics card when available.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport')

let mainWindow = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 420,
    minHeight: 360,
    show: false,
    title: 'StreamHub',
    backgroundColor: '#0f0f0f',
    autoHideMenuBar: true,
    icon: path.join(ROOT, 'electron', 'icon.png'),
    webPreferences: { contextIsolation: true, sandbox: true },
  })
  mainWindow.once('ready-to-show', () => { mainWindow.maximize(); mainWindow.show() })

  // Links to other sites open in the normal browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(APP_URL)) { event.preventDefault(); void shell.openExternal(url) }
  })
  // F11: full screen. Ctrl+R / F5: reload.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') { mainWindow.setFullScreen(!mainWindow.isFullScreen()); event.preventDefault() }
    else if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) { mainWindow.webContents.reload(); event.preventDefault() }
  })
  mainWindow.on('closed', () => { mainWindow = null })
  void mainWindow.loadURL(APP_URL)
}

async function start() {
  try {
    await startServer({ port: PORT, host: HOST, distDir: path.join(ROOT, 'dist') })
  } catch (error) {
    dialog.showErrorBox('StreamHub', `Não foi possível iniciar o StreamHub na porta ${PORT}.\n\nFeche outra cópia do programa que esteja aberta e tente de novo.\n\n${error && error.message ? error.message : error}`)
    app.quit()
    return
  }
  createWindow()
  setupAutoUpdates()
}

// Automatic updates from GitHub Releases (only in the installed app).
// A new version is downloaded in the background; the user chooses when to restart.
function setupAutoUpdates() {
  if (!app.isPackaged) return
  autoUpdater.setFeedURL({ provider: 'github', owner: 'leozinwf', repo: 'streamhub' })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  let asked = false
  autoUpdater.on('update-downloaded', async (info) => {
    if (asked) return
    asked = true
    const { response } = await dialog.showMessageBox(mainWindow ?? undefined, {
      type: 'info',
      title: 'Atualização do StreamHub',
      message: `A versão ${info.version} do StreamHub está pronta.`,
      detail: 'Reinicie para usar a versão nova agora. Se preferir, ela será instalada quando você fechar o programa.',
      buttons: ['Reiniciar agora', 'Depois'],
      defaultId: 0,
      cancelId: 1,
    })
    if (response === 0) autoUpdater.quitAndInstall()
  })
  autoUpdater.on('error', (error) => console.warn('[StreamHub] Falha ao verificar atualizações:', error?.message || error))
  const check = () => { autoUpdater.checkForUpdates().catch(() => undefined) }
  setTimeout(check, 5000)
  setInterval(check, 4 * 60 * 60 * 1000)
}

// Only one copy at a time: opening it again just brings the window to the front.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(start)
  app.on('window-all-closed', () => app.quit())
}
