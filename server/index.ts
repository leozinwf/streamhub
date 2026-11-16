import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './app.js'

const PORT = Number(process.env.PORT) || 3000
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

startServer({ port: PORT, distDir: path.join(rootDir, 'dist') })
  .then(() => console.log(`StreamHub rodando na porta ${PORT}`))
  .catch((error) => { console.error('[StreamHub] Não foi possível iniciar o servidor:', error); process.exit(1) })
