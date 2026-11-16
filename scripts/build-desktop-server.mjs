// Bundles the desktop app (electron/main.cjs + the Express server + electron-updater)
// into a single file, so the installer doesn't need node_modules.
import { build } from 'esbuild'

await build({
  entryPoints: ['electron/main.cjs'],
  outfile: 'electron/app/main.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'info',
})
