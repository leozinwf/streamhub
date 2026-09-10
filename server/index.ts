import express from 'express'
import cors from 'cors'

const app = express()

const PORT = Number(process.env.PORT) || 3000

app.use(cors({
  origin: true,
  credentials: false,
}))

app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    service: 'streamhub-api',
    timestamp: new Date().toISOString(),
  })
})

app.post('/api/xtream', async (req, res) => {
  const { server, username, password, action } = req.body ?? {}

  if (!server || !username || !password) {
    return res.status(400).json({
      error: 'Servidor, usuário e senha são obrigatórios.',
    })
  }

  try {
    const normalizedServer = String(server).trim().replace(/\/+$/, '')

    const target = new URL('/player_api.php', normalizedServer)

    target.searchParams.set('username', String(username))
    target.searchParams.set('password', String(password))

    if (action) {
      target.searchParams.set('action', String(action))
    }

    console.log('[XTREAM] Request', {
      target: `${target.origin}${target.pathname}`,
      hasUsername: Boolean(username),
      hasPassword: Boolean(password),
      action: action || null,
    })

    const controller = new AbortController()

    const timeout = setTimeout(() => {
      controller.abort()
    }, 15000)

    try {
      const response = await fetch(target.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language':
            'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache',
          Pragma: 'no-cache',
          Referer: `${target.origin}/`,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
        },
        redirect: 'follow',
        signal: controller.signal,
      })

      const text = await response.text()

      console.log('[XTREAM] Upstream response', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        server: response.headers.get('server'),
        cfRay: response.headers.get('cf-ray'),
        bodyLength: text.length,
      })

      if (!response.ok) {
        return res.status(502).json({
          error: 'Servidor IPTV recusou a requisição.',
          upstreamStatus: response.status,
          upstreamStatusText: response.statusText,
          bodyPreview: text.slice(0, 500),
        })
      }

      let data: unknown

      try {
        data = JSON.parse(text)
      } catch {
        return res.status(502).json({
          error: 'O servidor IPTV retornou uma resposta inválida.',
          upstreamStatus: response.status,
          bodyPreview: text.slice(0, 500),
        })
      }

      return res.status(200).json(data)
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    console.error('[XTREAM] Error', error)

    return res.status(502).json({
      error: 'Não foi possível conectar ao servidor IPTV.',
      details:
        error instanceof Error
          ? error.message
          : String(error),
    })
  }
})

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
  })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`StreamHub API running on port ${PORT}`)
})