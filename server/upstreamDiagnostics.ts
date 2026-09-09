// Log only fixed classifications and booleans: upstream headers, URLs and
// response bodies can contain account credentials or session identifiers.
export function logUpstreamFailure(route: 'xtream' | 'playlist', response: Response) {
  const server = response.headers.get('server')?.toLowerCase() ?? ''
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  console.warn('[StreamHub upstream]', JSON.stringify({
    route,
    status: response.status,
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
  }))
}
