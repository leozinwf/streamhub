function safeBodyPreview(value: string) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/[^\s"'<>]+/gi, '[url removida]')
    .replace(/((?:username|user|password|pass|token|key)\s*[=:]\s*)[^\s&,;"'<>]+/gi, '$1[removido]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip removido]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
}

export async function logUpstreamFailure(route: 'xtream' | 'playlist', response: Response) {
  const server = response.headers.get('server')?.toLowerCase() ?? ''
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  let bodyPreview = ''
  try {
    bodyPreview = safeBodyPreview(await response.clone().text())
  } catch {
    bodyPreview = '[não foi possível ler a resposta]'
  }

  console.warn('[StreamHub upstream]', JSON.stringify({
    route,
    status: response.status,
    statusText: response.statusText || null,
    redirected: response.redirected,
    server: server.includes('cloudflare') ? 'cloudflare'
      : server.includes('nginx') ? 'nginx'
      : server.includes('apache') ? 'apache'
      : server ? 'other' : 'unknown',
    contentType: contentType.includes('text/html') ? 'html'
      : contentType.includes('application/json') ? 'json'
      : contentType.includes('mpegurl') ? 'playlist'
      : contentType.includes('text/plain') ? 'text'
      : contentType ? 'other' : 'unknown',
    cloudflareChallenge: response.headers.get('cf-mitigated') === 'challenge',
    hasCloudflareRay: response.headers.has('cf-ray'),
    hasAuthChallenge: response.headers.has('www-authenticate'),
    hasRetryAfter: response.headers.has('retry-after'),
    hasVia: response.headers.has('via'),
    bodyPreview: bodyPreview || '[resposta vazia]',
  }))
}
