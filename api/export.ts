import { handleNodeRequest } from './adapter.js'

const TIMEOUT_MS = 60000

function normalizeServer(value: string) {
  const raw = value.trim().replace(/\/+$/, '')
  try {
    const url = new URL(raw)
    if (!['http:', 'https:'].includes(url.protocol)) return null
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return null
    if (/^127\.|^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return null
    return raw
  } catch { return null }
}

export async function handleExport(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } })
  const params = new URL(req.url).searchParams
  const server = normalizeServer(params.get('server') || '')
  const username = (params.get('username') || '').trim()
  const password = (params.get('password') || '').trim()
  if (!server || !username || !password) return new Response('Dados IPTV inválidos.', { status: 400 })

  const target = new URL('/get.php', server)
  target.searchParams.set('username', username)
  target.searchParams.set('password', password)
  target.searchParams.set('type', 'm3u_plus')
  target.searchParams.set('output', 'ts')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const upstream = await fetch(target, { signal: controller.signal, redirect: 'follow' })
    if (!upstream.ok || !upstream.body) return new Response(`O IPTV respondeu HTTP ${upstream.status}.`, { status: 502 })
    return new Response(upstream.body, { headers: {
      'Content-Type': 'audio/x-mpegurl; charset=utf-8',
      'Content-Disposition': 'attachment; filename="streamhub-completo.m3u"',
      'Cache-Control': 'no-store',
    } })
  } catch { return new Response('Não foi possível exportar a lista completa.', { status: 502 }) }
  finally { clearTimeout(timeout) }
}

export default async function handler(req: any, res: any) {
  await handleNodeRequest(req, res, handleExport)
}
