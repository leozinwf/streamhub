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

function getResponseDiagnostics(response: Response) {
  const headers = [
    'server',
    'content-type',
    'content-length',
    'location',
    'cf-ray',
    'cf-cache-status',
    'cf-mitigated',
    'cf-chl-out',
    'x-cache',
    'x-cache-status',
    'x-powered-by',
    'via',
    'retry-after',
    'www-authenticate',
  ]

  const result: Record<string, string | null> = {}

  for (const header of headers) {
    result[header] = response.headers.get(header)
  }

  return result
}

async function getBodyPreview(response: Response) {
  try {
    const clone = response.clone()
    const text = await clone.text()

    return {
      length: text.length,
      preview: text.slice(0, 1000),
    }
  } catch (error) {
    return {
      length: 0,
      preview: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
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

  const headers = upstreamHeaders(req, target)

  console.log('[XTREAM] Upstream request configuration', {
    requestId,
    method: 'GET',
    target: safeTarget(target),
    headers: {
      Accept: headers.Accept,
      'Accept-Language': headers['Accept-Language'],
      'Cache-Control': headers['Cache-Control'],
      Pragma: headers.Pragma,
      Referer: headers.Referer,
      'User-Agent': headers['User-Agent'],
    },
    redirect: 'follow',
    timeoutMs: TIMEOUT_MS,
  })

  const controller = new AbortController()

  let timedOut = false

  const timeout = setTimeout(() => {
    timedOut = true

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
  })

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      headers,
      redirect: 'follow',
    })

    const durationMs = Date.now() - startedAt

    const diagnostics = getResponseDiagnostics(upstream)

    console.log('[XTREAM] Upstream response received', {
      requestId,
      durationMs,
      status: upstream.status,
      statusText: upstream.statusText,
      ok: upstream.ok,
      redirected: upstream.redirected,
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
      diagnostics,
    })

    if (!upstream.ok) {
      const bodyPreview = await getBodyPreview(upstream)

      console.warn('[XTREAM] Upstream HTTP error diagnostics', {
        requestId,
        status: upstream.status,
        statusText: upstream.statusText,
        durationMs,
        redirected: upstream.redirected,
        diagnostics,
        bodyLength: bodyPreview.length,
        bodyPreview: bodyPreview.preview,
      })

      if (upstream.status === 403) {
        console.error('[XTREAM] HTTP 403 DETECTED', {
          requestId,
          message:
            'O servidor IPTV recebeu a requisição, mas recusou o acesso.',
          possibleCauses: [
            'IP da Vercel bloqueado',
            'Firewall/WAF do servidor',
            'Regra anti-bot',
            'Regra geográfica',
            'Cloudflare/WAF',
            'Restrição de origem',
            'Header obrigatório ausente',
          ],
          server: diagnostics.server,
          cfRay: diagnostics['cf-ray'],
          cfCacheStatus: diagnostics['cf-cache-status'],
          cfMitigated: diagnostics['cf-mitigated'],
        })
      }

      if (upstream.status === 401) {
        console.warn('[XTREAM] HTTP 401 DETECTED', {
          requestId,
          message:
            'O servidor respondeu, mas indicou falha de autenticação.',
        })
      }

      if (upstream.status >= 500) {
        console.error('[XTREAM] UPSTREAM 5XX DETECTED', {
          requestId,
          message:
            'O próprio servidor IPTV ou infraestrutura intermediária retornou erro 5xx.',
        })
      }

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

    console.log('[XTREAM] Upstream returned successful HTTP status', {
      requestId,
      status: upstream.status,
      durationMs,
      contentType: upstream.headers.get('content-type'),
    })

    try {
      const data = await upstream.json()

      console.log('[XTREAM] Upstream JSON parsed successfully', {
        requestId,
        totalDurationMs: Date.now() - startedAt,
        responseType: Array.isArray(data)
          ? 'array'
          : typeof data,
        isArray: Array.isArray(data),
      })

      return jsonResponse(data, 200)
    } catch (error) {
      console.error('[XTREAM] Failed to parse upstream JSON', {
        requestId,
        durationMs: Date.now() - startedAt,
        errorType:
          error instanceof Error
            ? error.constructor.name
            : typeof error,
        name:
          error instanceof Error
            ? error.name
            : null,
        message:
          error instanceof Error
            ? error.message
            : String(error),
      })

      return jsonResponse(
        {
          error: 'O servidor IPTV retornou uma resposta que não é um JSON válido.',
          requestId,
        },
        502,
      )
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt

    const errorInfo = {
      requestId,
      durationMs,
      target: safeTarget(target),
      timedOut,
      errorType:
        error instanceof Error
          ? error.constructor.name
          : typeof error,
      name:
        error instanceof Error
          ? error.name
          : null,
      message:
        error instanceof Error
          ? error.message
          : String(error),
      cause:
        error instanceof Error
          ? error.cause
          : null,
      stack:
        error instanceof Error
          ? error.stack
          : null,
    }

    console.error('[XTREAM] Upstream request FAILED', errorInfo)

    if (timedOut) {
      console.error('[XTREAM] FAILURE REASON: TIMEOUT', {
        requestId,
        durationMs,
        timeoutMs: TIMEOUT_MS,
        target: safeTarget(target),
      })
    } else {
      console.error('[XTREAM] FAILURE REASON: FETCH/CONNECTION ERROR', {
        requestId,
        durationMs,
        errorName:
          error instanceof Error
            ? error.name
            : null,
        errorMessage:
          error instanceof Error
            ? error.message
            : String(error),
        cause:
          error instanceof Error
            ? error.cause
            : null,
      })
    }

    return jsonResponse(
      {
        error: timedOut
          ? 'Tempo limite ao conectar ao servidor IPTV.'
          : 'Não foi possível conectar ao servidor IPTV.',
        requestId,
        diagnostic: {
          type:
            error instanceof Error
              ? error.name
              : typeof error,
          durationMs,
          timeout: timedOut,
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