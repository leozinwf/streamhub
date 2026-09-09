import { handleNodeRequest } from './adapter.js'
import { logUpstreamFailure } from '../server/upstreamDiagnostics.js'

const TIMEOUT_MS = 15000

const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36'

function normalizeServer(value: string) {
  const raw = value.trim().replace(/\/+$/, '')

  if (!/^https?:\/\//i.test(raw)) return null

  try {
    const url = new URL(raw)
    const host = url.hostname.toLowerCase()

    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return null
    if (/^127\./.test(host)) return null
    if (/^10\./.test(host)) return null
    if (/^192\.168\./.test(host)) return null
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
  return Response.json(body, {
    status,
    headers: corsHeaders,
  })
}

function upstreamHeaders(req: Request, target: URL) {
  const incomingUserAgent = text(req.headers.get('user-agent'))

  const userAgent =
    incomingUserAgent &&
    !/vercel|node|undici|bot|crawler|spider/i.test(incomingUserAgent)
      ? incomingUserAgent
      : BROWSER_USER_AGENT

  return {
    Accept: 'application/json, text/plain, */*',
    'Accept-Language':
      text(req.headers.get('accept-language')) ||
      'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    Referer: `${target.origin}/`,
    'User-Agent': userAgent,
  }
}

function safeTarget(target: URL) {
  return `${target.protocol}//${target.host}${target.pathname}`
}

export async function handleXtream(req: Request): Promise<Response> {
  const requestId = crypto.randomUUID()

  console.log('[XTREAM] Request received', {
    requestId,
    method: req.method,
    timestamp: new Date().toISOString(),
  })

  if (req.method === 'OPTIONS') {
    console.log('[XTREAM] OPTIONS request', {
      requestId,
    })

    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    })
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    console.warn('[XTREAM] Unsupported method', {
      requestId,
      method: req.method,
    })

    return new Response('Method Not Allowed', {
      status: 405,
      headers: {
        ...corsHeaders,
        Allow: 'GET, POST, OPTIONS',
      },
    })
  }

  const params = new URL(req.url).searchParams

  const body =
    req.method === 'POST'
      ? (await req.json().catch(() => ({}))) as Record<string, unknown>
      : {}

  const value = (key: string) =>
    text(
      typeof body[key] === 'string'
        ? body[key] as string
        : params.get(key),
    )

  const server = normalizeServer(value('server'))
  const username = value('username')
  const password = value('password')
  const action = value('action')

  console.log('[XTREAM] Input validation', {
    requestId,
    hasServer: Boolean(server),
    hasUsername: Boolean(username),
    hasPassword: Boolean(password),
    action: action || '(none)',
  })

  if (!server || !username || !password) {
    console.warn('[XTREAM] Missing required credentials', {
      requestId,
      hasServer: Boolean(server),
      hasUsername: Boolean(username),
      hasPassword: Boolean(password),
    })

    return jsonResponse(
      {
        error: 'Servidor, usuário e senha são obrigatórios.',
        requestId,
      },
      400,
    )
  }

  const target = new URL('/player_api.php', server)

  target.searchParams.set('username', username)
  target.searchParams.set('password', password)

  if (action) {
    target.searchParams.set('action', action)
  }

  for (const key of [
    'category_id',
    'series_id',
    'vod_id',
    'stream_id',
    'limit',
  ]) {
    const parameter = value(key)

    if (parameter) {
      target.searchParams.set(key, parameter)
    }
  }

  console.log('[XTREAM] Target prepared', {
    requestId,
    target: safeTarget(target),
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || '(default)',
    action: action || '(none)',
  })

  const controller = new AbortController()

  const timeout = setTimeout(() => {
    console.warn('[XTREAM] Request timeout reached', {
      requestId,
      timeoutMs: TIMEOUT_MS,
      target: safeTarget(target),
    })

    controller.abort()
  }, TIMEOUT_MS)

  const startedAt = Date.now()

  console.log('[XTREAM] Starting upstream fetch', {
    requestId,
    target: safeTarget(target),
    timeoutMs: TIMEOUT_MS,
  })

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      headers: upstreamHeaders(req, target),
      redirect: 'follow',
    })

    const durationMs = Date.now() - startedAt

    console.log('[XTREAM] Upstream response received', {
      requestId,
      durationMs,
      status: upstream.status,
      statusText: upstream.statusText,
      ok: upstream.ok,
      finalUrl: upstream.url
        ? (() => {
            try {
              const url = new URL(upstream.url)
              return `${url.protocol}//${url.host}${url.pathname}`
            } catch {
              return '(invalid URL)'
            }
          })()
        : '(none)',
      serverHeader: upstream.headers.get('server'),
      contentType: upstream.headers.get('content-type'),
      contentLength: upstream.headers.get('content-length'),
      location: upstream.headers.get('location')
        ? (() => {
            try {
              const url = new URL(upstream.headers.get('location')!)
              return `${url.protocol}//${url.host}${url.pathname}`
            } catch {
              return '(invalid location)'
            }
          })()
        : null,
    })

    if (!upstream.ok) {
      console.warn('[XTREAM] Upstream returned HTTP error', {
        requestId,
        status: upstream.status,
        statusText: upstream.statusText,
        durationMs,
      })

      await logUpstreamFailure('xtream', upstream)

      return jsonResponse(
        {
          error: `Servidor de origem respondeu HTTP ${upstream.status}.`,
          requestId,
          upstreamStatus: upstream.status,
          durationMs,
        },
        502,
      )
    }

    console.log('[XTREAM] Parsing upstream JSON', {
      requestId,
      durationMs,
    })

    const data = await upstream.json()

    console.log('[XTREAM] Upstream JSON parsed successfully', {
      requestId,
      totalDurationMs: Date.now() - startedAt,
      responseType: Array.isArray(data) ? 'array' : typeof data,
      isArray: Array.isArray(data),
    })

    return jsonResponse(data, 200)
  } catch (error) {
    const durationMs = Date.now() - startedAt

    const errorInfo = {
      requestId,
      durationMs,
      target: safeTarget(target),
      errorType: error instanceof Error
        ? error.constructor.name
        : typeof error,
      name: error instanceof Error
        ? error.name
        : null,
      message: error instanceof Error
        ? error.message
        : String(error),
      cause: error instanceof Error
        ? error.cause
        : null,
      stack: error instanceof Error
        ? error.stack
        : null,
    }

    console.error('[XTREAM] Upstream request FAILED', errorInfo)

    const isTimeout =
      error instanceof DOMException &&
      error.name === 'AbortError'

    if (isTimeout) {
      console.error('[XTREAM] FAILURE REASON: TIMEOUT', {
        requestId,
        durationMs,
        timeoutMs: TIMEOUT_MS,
      })
    } else {
      console.error('[XTREAM] FAILURE REASON: CONNECTION/FETCH ERROR', {
        requestId,
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    }

    return jsonResponse(
      {
        error: isTimeout
          ? 'Tempo limite ao conectar ao servidor IPTV.'
          : 'Não foi possível conectar ao servidor IPTV.',
        requestId,
        diagnostic: {
          type: error instanceof Error
            ? error.name
            : typeof error,
          durationMs,
          timeout: isTimeout,
        },
      },
      502,
    )
  } finally {
    clearTimeout(timeout)

    console.log('[XTREAM] Request finished', {
      requestId,
      totalDurationMs: Date.now() - startedAt,
    })
  }
}

export default async function handler(req: any, res: any) {
  await handleNodeRequest(req, res, handleXtream)
}