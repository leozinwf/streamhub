import { handleNodeRequest } from './adapter.js'

const TIMEOUT_MS = 15000

function normalizeServer(value: string) {
  const raw = value.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(raw)) return null
  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return null
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return null
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return null
    return raw
  } catch {
    return null
  }
}

function text(value: string | null) {
  return value?.trim() ?? ''
}

export async function handleXtream(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } })
  }

  const params = new URL(req.url).searchParams
  const server = normalizeServer(text(params.get('server')))
  const username = text(params.get('username'))
  const password = text(params.get('password'))
  const action = text(params.get('action'))

  if (!server || !username || !password) {
    return Response.json({ error: 'Servidor, usuário e senha são obrigatórios.' }, { status: 400 })
  }

  const target = new URL('/player_api.php', server)
  target.searchParams.set('username', username)
  target.searchParams.set('password', password)
  if (action) target.searchParams.set('action', action)
  for (const key of ['category_id', 'series_id', 'vod_id', 'stream_id', 'limit']) {
    const value = text(params.get(key))
    if (value) target.searchParams.set(key, value)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      redirect: 'follow',
    })

    if (!upstream.ok) {
      return Response.json({ error: `Servidor de origem respondeu HTTP ${upstream.status}.` }, { status: 502 })
    }

    const data = await upstream.json()
    return Response.json(data, {
      status: 200,
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? 'Tempo limite ao conectar ao servidor IPTV.'
      : 'Não foi possível conectar ao servidor IPTV.'
    return Response.json({ error: message }, { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}

export default async function handler(req: any, res: any) {
  await handleNodeRequest(req, res, handleXtream)
}
