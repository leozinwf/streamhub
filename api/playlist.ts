const MAX_PLAYLIST_BYTES = 15 * 1024 * 1024
const TIMEOUT_MS = 15000

function isPublicHttpUrl(value: string) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    const host = url.hostname.toLowerCase()
    if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return false
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return false
    const private172 = /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    if (private172) return false
    return true
  } catch {
    return false
  }
}

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } })
  }

  const target = new URL(req.url).searchParams.get('url')?.trim()
  if (!target || !isPublicHttpUrl(target)) {
    return new Response('URL inválida ou destino não permitido.', { status: 400 })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.apple.mpegurl, application/x-mpegurl, text/plain, */*' },
      redirect: 'follow',
    })

    if (!upstream.ok) {
      return new Response(`Servidor de origem respondeu HTTP ${upstream.status}.`, { status: 502 })
    }

    const contentLength = Number(upstream.headers.get('content-length') ?? 0)
    if (contentLength > MAX_PLAYLIST_BYTES) {
      return new Response('A playlist excede o limite de 15 MB.', { status: 413 })
    }

    const content = await upstream.text()
    if (new TextEncoder().encode(content).byteLength > MAX_PLAYLIST_BYTES) {
      return new Response('A playlist excede o limite de 15 MB.', { status: 413 })
    }

    return new Response(content, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (error) {
    const message = error instanceof DOMException && error.name === 'AbortError'
      ? 'Tempo limite ao acessar a playlist.'
      : 'Não foi possível acessar a playlist de origem.'
    return new Response(message, { status: 502 })
  } finally {
    clearTimeout(timeout)
  }
}

export default adaptHandler(handle)
import { adaptHandler } from './adapter'
