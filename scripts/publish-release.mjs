// Creates (or updates) the GitHub release for the current version with the
// standard notes (build/release-notes.md), before electron-builder uploads the files.
// Creating it first avoids two parallel "create release" calls from electron-builder.
// Usage: GH_TOKEN=... [STREAMHUB_NEWS="item 1; item 2"] node scripts/publish-release.mjs
import { readFileSync } from 'node:fs'

const REPO = 'leozinwf/streamhub'
const token = process.env.GH_TOKEN
if (!token) { console.error('GH_TOKEN não definido.'); process.exit(1) }

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const tag = `v${version}`
const base = readFileSync('build/release-notes.md', 'utf8').replaceAll('{version}', version)
const newsItems = (process.env.STREAMHUB_NEWS || '').split(';').map((item) => item.trim()).filter(Boolean)
const newsSection = (items) => `### Novidades desta versão\n${items.map((item) => `- ${item}`).join('\n')}\n\n`

const api = (path, options = {}) => fetch(`https://api.github.com/repos/${REPO}${path}`, {
  ...options,
  headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'streamhub-release' },
})

const existing = await api(`/releases/tags/${tag}`)
if (existing.ok) {
  const release = await existing.json()
  // Keep the "Novidades" already written when republishing without new text.
  const previousNews = !newsItems.length && release.body?.startsWith('### Novidades') ? release.body.slice(0, release.body.indexOf('## StreamHub')) : ''
  const body = (newsItems.length ? newsSection(newsItems) : previousNews) + base
  const res = await api(`/releases/${release.id}`, { method: 'PATCH', body: JSON.stringify({ name: version, body, draft: false }) })
  if (!res.ok) { console.error(`Falha ao atualizar a release ${tag}: HTTP ${res.status}`, await res.text()); process.exit(1) }
  console.log(`Release ${tag} atualizada.`)
} else {
  const body = (newsItems.length ? newsSection(newsItems) : '') + base
  const res = await api('/releases', { method: 'POST', body: JSON.stringify({ tag_name: tag, target_commitish: 'main', name: version, body, draft: false }) })
  if (!res.ok) { console.error(`Falha ao criar a release ${tag}: HTTP ${res.status}`, await res.text()); process.exit(1) }
  console.log(`Release ${tag} criada.`)
}
