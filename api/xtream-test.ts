const TIMEOUT_MS = 10000

const TARGET = 'https://rootdns.cc'

type TestResult = {
  name: string
  url: string
  status: number | null
  statusText: string | null
  durationMs: number
  ok: boolean
  redirected: boolean
  finalUrl: string | null
  headers: Record<string, string | null>
  bodyPreview: string
  error: string | null
}

function safeUrl(value: string) {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return value
  }
}

function responseHeaders(response: Response) {
  const names = [
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

  for (const name of names) {
    result[name] = response.headers.get(name)
  }

  return result
}

async function readPreview(response: Response) {
  try {
    const text = await response.clone().text()

    return text.slice(0, 1000)
  } catch {
    return ''
  }
}

async function runTest(
  name: string,
  url: string,
  headers?: Record<string, string>,
): Promise<TestResult> {
  const startedAt = Date.now()

  const controller = new AbortController()

  const timeout = setTimeout(() => {
    controller.abort()
  }, TIMEOUT_MS)

  try {
    console.log('[XTREAM-TEST] Starting', {
      name,
      url: safeUrl(url),
      headers,
    })

    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    })

    const durationMs = Date.now() - startedAt

    const finalUrl = response.url
      ? safeUrl(response.url)
      : null

    const preview = await readPreview(response)

    const result: TestResult = {
      name,
      url: safeUrl(url),
      status: response.status,
      statusText: response.statusText,
      durationMs,
      ok: response.ok,
      redirected: response.redirected,
      finalUrl,
      headers: responseHeaders(response),
      bodyPreview: preview,
      error: null,
    }

    console.log('[XTREAM-TEST] Result', result)

    return result
  } catch (error) {
    const durationMs = Date.now() - startedAt

    const result: TestResult = {
      name,
      url: safeUrl(url),
      status: null,
      statusText: null,
      durationMs,
      ok: false,
      redirected: false,
      finalUrl: null,
      headers: {},
      bodyPreview: '',
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
    }

    console.error('[XTREAM-TEST] Failed', result)

    return result
  } finally {
    clearTimeout(timeout)
  }
}

export default async function handler(req: any, res: any) {
  const requestId = crypto.randomUUID()

  console.log('[XTREAM-TEST] Request received', {
    requestId,
    method: req.method,
    timestamp: new Date().toISOString(),
  })

  if (req.method !== 'GET') {
    return res.status(405).json({
      error: 'Method Not Allowed',
      requestId,
    })
  }

  const results: TestResult[] = []

  /*
   * TESTE 1
   *
   * Apenas o domínio raiz.
   */
  results.push(
    await runTest(
      '01 - Root domain',
      `${TARGET}/`,
    ),
  )

  /*
   * TESTE 2
   *
   * Endpoint player_api.php sem credenciais.
   *
   * Esperamos normalmente algum erro do endpoint,
   * mas queremos observar se é 403, 404 ou outra resposta.
   */
  results.push(
    await runTest(
      '02 - player_api.php',
      `${TARGET}/player_api.php`,
    ),
  )

  /*
   * TESTE 3
   *
   * Mesmo endpoint usando User-Agent de navegador.
   */
  results.push(
    await runTest(
      '03 - player_api.php + Chrome User-Agent',
      `${TARGET}/player_api.php`,
      {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      },
    ),
  )

  /*
   * TESTE 4
   *
   * Reproduz os principais headers utilizados pelo StreamHub.
   */
  results.push(
    await runTest(
      '04 - StreamHub headers',
      `${TARGET}/player_api.php`,
      {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language':
          'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        Referer: `${TARGET}/`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      },
    ),
  )

  /*
   * TESTE 5
   *
   * Endpoint com uma query fictícia.
   *
   * NÃO contém usuário ou senha reais.
   */
  results.push(
    await runTest(
      '05 - player_api.php + dummy query',
      `${TARGET}/player_api.php?username=test&password=test`,
      {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language':
          'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        Referer: `${TARGET}/`,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      },
    ),
  )

  /*
   * RESUMO
   */
  const summary = results.map((result) => ({
    test: result.name,
    status: result.status,
    durationMs: result.durationMs,
    ok: result.ok,
    redirected: result.redirected,
    finalUrl: result.finalUrl,
    server: result.headers.server,
    contentType: result.headers['content-type'],
    cfRay: result.headers['cf-ray'],
    cfCacheStatus: result.headers['cf-cache-status'],
    cfMitigated: result.headers['cf-mitigated'],
    error: result.error,
  }))

  console.log('[XTREAM-TEST] Complete', {
    requestId,
    summary,
  })

  return res.status(200).json({
    success: true,
    requestId,

    description:
      'Diagnóstico de conectividade da Vercel com rootdns.cc. Nenhuma credencial real foi utilizada.',

    summary,

    results,
  })
}
