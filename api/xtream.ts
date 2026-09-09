import { handleNodeRequest } from './adapter.js'
import { logUpstreamFailure } from '../server/upstreamDiagnostics.js'

const TIMEOUT_MS = 15000
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'

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

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
}

function jsonResponse(body: unknown, status: number) {
  return Response.json(body, { status, headers: corsHeaders })
}

function upstreamHeaders(req: Request, target: URL) {
  const incomingUserAgent = text(req.headers.get('user-agent'))
  const userAgent = incomingUserAgent && !/vercel|node|undici|bot|crawler|spider/i.test(incomingUserAgent)
    ? incomingUserAgent
    : BROWSER_USER_AGENT

  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': text(req.headers.get('accept-language')) || 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: `${target.origin}/`,
    'User-Agent': userAgent,
  }
}

export async function handleXtream(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { ...corsHeaders, Allow: 'GET, POST, OPTIONS' } })
  }

  const params = new URL(req.url).searchParams
  const body = req.method === 'POST'
    ? await req.json().catch(() => ({})) as Record<string, unknown>
    : {}
  const value = (key: string) => text(typeof body[key] === 'string' ? body[key] as string : params.get(key))
  const server = normalizeServer(value('server'))
  const username = value('username')
  const password = value('password')
  const action = value('action')

  if (!server || !username || !password) {
    return jsonResponse({ error: 'Servidor, usuário e senha são obrigatórios.' }, 400)
  }

  const target = new URL('/player_api.php', server)
  target.searchParams.set('username', username)
  target.searchParams.set('password', password)
  if (action) target.searchParams.set('action', action)
  for (const key of ['category_id', 'series_id', 'vod_id', 'stream_id', 'limit']) {
    const parameter = value(key)
    if (parameter) target.searchParams.set(key, parameter)
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      headers: upstreamHeaders(req, target),
      redirect: 'follow',
    })

    if (!upstream.ok) {
      await logUpstreamFailure('xtream', upstream)
      return jsonResponse({ error: `Servidor de origem respondeu HTTP ${upstream.status}.` }, 502)
    }

    const data = await upstream.json()
    return jsonResponse(data, 200)
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? 'Tempo limite ao conectar ao servidor IPTV.'
      : 'Não foi possível conectar ao servidor IPTV.'
    return jsonResponse({ error: message }, 502)
  } finally {
    clearTimeout(timeout)
  }
}

export default async function handler(req: any, res: any) {
  await handleNodeRequest(req, res, handleXtream)
}
