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

function proxiedUrl(target: URL, requestUrl: string) {
  return `${new URL('/api/stream', requestUrl).origin}/api/stream?url=${encodeURIComponent(target.toString())}`
}

function rewriteManifest(content: string, requestUrl: string, baseUrl: URL) {
  return content
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line

      // HLS uses URI= for encryption keys, maps, subtitles and other auxiliary resources.
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
        // Every playlist/segment reference goes back through the same proxy.
        return proxiedUrl(new URL(trimmed, baseUrl), requestUrl)
      } catch {
        return line
      }
    })
    .join('\n')
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } })
  }

  const targetValue = new URL(req.url).searchParams.get('url')?.trim()
  if (!targetValue || !isAllowedUrl(targetValue)) {
    return new Response('URL inválida ou destino não permitido.', { status: 400 })
  }

  const target = new URL(targetValue)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, video/mp2t, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36 StreamHub/1.0',
        Connection: 'keep-alive',
      },
      redirect: 'follow',
    })

    if (!upstream.ok) {
      return new Response(`Servidor de origem respondeu HTTP ${upstream.status}.`, { status: 502 })
    }

    const contentType = upstream.headers.get('content-type') || ''
    const finalUrl = new URL(upstream.url || target.toString())
    const isManifest = contentType.toLowerCase().includes('mpegurl') || /\.m3u8(?:$|\?)/i.test(finalUrl.pathname + finalUrl.search)

    if (isManifest) {
      const contentLength = Number(upstream.headers.get('content-length') ?? 0)
      if (contentLength > MAX_MANIFEST_BYTES) {
        return new Response('Manifesto HLS excede o limite permitido.', { status: 413 })
      }

      const content = await upstream.text()
      if (new TextEncoder().encode(content).byteLength > MAX_MANIFEST_BYTES) {
        return new Response('Manifesto HLS excede o limite permitido.', { status: 413 })
      }

      // Use the final redirected URL as the base. This is important when the provider
      // redirects the request to a CDN with a different host/path.
      const rewritten = rewriteManifest(content, req.url, finalUrl)

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

    const headers = new Headers()
    const passthrough = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']
    for (const key of passthrough) {
      const value = upstream.headers.get(key)
      if (value) headers.set(key, value)
    }
    headers.set('Cache-Control', 'no-store')
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified')

    return new Response(upstream.body, { status: upstream.status, headers })
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? 'Tempo limite ao acessar o stream.'
      : 'Não foi possível acessar o stream de origem.'
    return new Response(message, { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}
