const TIMEOUT_MS = 30000
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024

function isAllowedUrl(value: string) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false
    return true
  } catch {
    return false
  }
}

function safeLogUrl(value: string) {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    for (const key of ['username', 'user', 'password', 'pass', 'token', 'auth', 'api_key', 'apikey']) url.searchParams.delete(key)
    return url.toString()
  } catch {
    return '[invalid-url]'
  }
}

function proxiedUrl(target: URL, requestUrl: string) {
  return `${new URL('/api/stream', requestUrl).origin}/api/stream?url=${encodeURIComponent(target.toString())}`
}

function rewriteManifest(content: string, requestUrl: string, baseUrl: URL) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line

      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/gi, (_match, value: string) => {
          try {
            return `URI="${proxiedUrl(new URL(value, baseUrl), requestUrl)}"`
          } catch {
            return `URI="${value}"`
          }
        })
      }

      try {
        return proxiedUrl(new URL(trimmed, baseUrl), requestUrl)
      } catch {
        return line
      }
    })
    .join('\n')
}

function responseHeaders(source: Headers) {
  const headers = new Headers()
  for (const key of ['content-type', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
    const value = source.get(key)
    if (value) headers.set(key, value)
  }
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate')
  headers.set('Pragma', 'no-cache')
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified')
  return headers
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } })

  const targetValue = new URL(req.url).searchParams.get('url')?.trim()
  if (!targetValue || !isAllowedUrl(targetValue)) return new Response('URL inválida ou destino não permitido.', { status: 400 })

  const target = new URL(targetValue)
  const startedAt = Date.now()
  const requestId = Math.random().toString(36).slice(2, 8)
  console.info(`[StreamHub Stream ${requestId}] START ${req.method} ${safeLogUrl(target.toString())}`, {
    range: req.headers.get('range') || null,
    referer: req.headers.get('referer') ? '[present]' : null,
    origin: req.headers.get('origin') ? '[present]' : null,
  })

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const requestRange = req.headers.get('range')
    const requestReferer = req.headers.get('referer')
    const requestOrigin = req.headers.get('origin')
    const upstreamHeaders: Record<string, string> = {
      Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, video/mp2t, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36 StreamHub/1.0',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    }

    if (requestRange) upstreamHeaders.Range = requestRange
    if (requestReferer) upstreamHeaders.Referer = requestReferer
    else upstreamHeaders.Referer = `${target.origin}/`
    if (requestOrigin) upstreamHeaders.Origin = requestOrigin
    else upstreamHeaders.Origin = target.origin

    console.info(`[StreamHub Stream ${requestId}] UPSTREAM_REQUEST`, {
      url: safeLogUrl(target.toString()),
      range: requestRange || null,
      refererMode: requestReferer ? 'browser' : 'target-origin',
      originMode: requestOrigin ? 'browser' : 'target-origin',
    })

    const upstream = await fetch(target, {
      signal: controller.signal,
      headers: upstreamHeaders,
      redirect: 'follow',
    })

    const contentType = upstream.headers.get('content-type') || ''
    const contentLength = upstream.headers.get('content-length') || ''
    const finalUrl = new URL(upstream.url || target.toString())
    console.info(`[StreamHub Stream ${requestId}] UPSTREAM_RESPONSE ${upstream.status}`, {
      elapsedMs: Date.now() - startedAt,
      finalUrl: safeLogUrl(finalUrl.toString()),
      contentType,
      contentLength: contentLength || null,
      contentRange: upstream.headers.get('content-range') || null,
      location: upstream.headers.get('location') || null,
    })

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      console.warn(`[StreamHub Stream ${requestId}] UPSTREAM_ERROR_BODY`, text.slice(0, 300))
      return new Response(`Servidor de origem respondeu HTTP ${upstream.status}.${text ? ` ${text.slice(0, 300)}` : ''}`, {
        status: upstream.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
      })
    }

    const contentDisposition = upstream.headers.get('content-disposition') || ''
    const looksLikeManifestUrl = /\.m3u8(?:$|\?)/i.test(target.pathname + target.search) || /\.m3u8(?:$|\?)/i.test(finalUrl.pathname + finalUrl.search)
    const looksLikeText = /text\//i.test(contentType) || /mpegurl/i.test(contentType)
    const isManifest = looksLikeManifestUrl || looksLikeText || /\.m3u8/i.test(contentDisposition)

    console.info(`[StreamHub Stream ${requestId}] CLASSIFY`, {
      isManifest,
      looksLikeManifestUrl,
      looksLikeText,
      contentDisposition: contentDisposition || null,
    })

    if (isManifest) {
      const length = Number(contentLength || 0)
      if (length > MAX_MANIFEST_BYTES) return new Response('Manifesto HLS excede o limite permitido.', { status: 413 })
      const content = await upstream.text()
      const manifestBytes = new TextEncoder().encode(content).byteLength
      console.info(`[StreamHub Stream ${requestId}] MANIFEST_READ`, {
        bytes: manifestBytes,
        firstLine: content.split(/\r?\n/).find((line) => line.trim())?.slice(0, 120) || '',
        lineCount: content.split(/\r?\n/).length,
      })
      if (manifestBytes > MAX_MANIFEST_BYTES) return new Response('Manifesto HLS excede o limite permitido.', { status: 413 })

      const manifestLike = /^\s*#EXTM3U(?:\s|$)/i.test(content)
      if (!manifestLike && looksLikeManifestUrl) {
        console.warn(`[StreamHub Stream ${requestId}] INVALID_MANIFEST`, content.slice(0, 500))
        return new Response('A origem respondeu algo que não é um manifesto HLS válido.', {
          status: 502,
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
        })
      }

      const rewritten = manifestLike ? rewriteManifest(content, req.url, finalUrl) : content
      const proxyCount = (rewritten.match(/\/api\/stream\?url=/g) || []).length
      console.info(`[StreamHub Stream ${requestId}] MANIFEST_REWRITTEN`, {
        valid: manifestLike,
        proxiedEntries: proxyCount,
        changed: rewritten !== content,
      })
      return new Response(rewritten, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    const headers = responseHeaders(upstream.headers)
    if (!headers.has('content-type')) {
      headers.set('Content-Type', /\.ts(?:$|\?)/i.test(finalUrl.pathname + finalUrl.search) ? 'video/mp2t' : 'application/octet-stream')
    }
    console.info(`[StreamHub Stream ${requestId}] STREAM_RESPONSE_READY`, {
      status: upstream.status,
      contentType: headers.get('content-type'),
      contentLength: headers.get('content-length') || null,
      elapsedMs: Date.now() - startedAt,
    })
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    const rawMessage = error instanceof Error ? error.message : String(error)
    console.error(`[StreamHub Stream ${requestId}] EXCEPTION`, { aborted, message: rawMessage, elapsedMs: Date.now() - startedAt })
    const message = aborted ? 'Tempo limite ao acessar o stream.' : 'Não foi possível acessar o stream de origem.'
    return new Response(message, { status: 502, headers: { 'Access-Control-Allow-Origin': '*' } })
  } finally {
    clearTimeout(timeout)
    console.info(`[StreamHub Stream ${requestId}] END (${Date.now() - startedAt}ms)`)
  }
}
