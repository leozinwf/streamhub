import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import playlistHandler from './api/playlist'
import xtreamHandler from './api/xtream'
import streamHandler from './api/stream'

async function sendResponse(response: Response, res: any, stream = false) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => res.setHeader(key, value))
  if (stream && response.body) {
    const reader = response.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    } finally { reader.releaseLock() }
    res.end()
    return
  }
  res.end(new Uint8Array(await response.arrayBuffer()))
}

function localApi(): Plugin {
  return {
    name: 'streamhub-local-api',
    configureServer(server) {
      const handlers: Record<string, (request: Request) => Promise<Response>> = {
        '/api/playlist': playlistHandler,
        '/api/xtream': xtreamHandler,
        '/api/stream': streamHandler,
      }
      for (const [route, handler] of Object.entries(handlers)) {
        server.middlewares.use(route, async (req: any, res: any, next: any) => {
          try {
            const headers = new Headers()
            for (const [key, value] of Object.entries(req.headers ?? {})) {
              if (typeof value === 'string') headers.set(key, value)
              else if (Array.isArray(value)) headers.set(key, value.join(', '))
            }
            const request = new Request(`http://localhost:5173${req.url ?? ''}`, { method: req.method ?? 'GET', headers })
            const response = await handler(request)
            await sendResponse(response, res, route === '/api/stream')
          } catch (error) {
            console.error(`[StreamHub API] ${req.method ?? 'GET'} ${route} failed`, error)
            next(error)
          }
        })
      }
    },
    transform(code, id) {
      if (!id.endsWith('/src/components/Player.tsx')) return null
      let fixed = code

      fixed = fixed.replace(
        "  const [hlsQuality, setHlsQuality] = useState(-1)\n",
        "  const [hlsQuality, setHlsQuality] = useState(-1)\n  const [playbackRate, setPlaybackRate] = useState(1)\n",
      )

      fixed = fixed.replace(
        "    setSettingsOpen(false)\n    showControls()",
        "    setSettingsOpen(false)\n    setPlaybackRate(1)\n    showControls()",
      )

      fixed = fixed.replace(
        "  const selectHlsQuality = (value: number) => { const hls = hlsRef.current; if (!hls) return; hls.currentLevel = value; setHlsQuality(value) }\n",
        "  const selectHlsQuality = (value: number) => { const hls = hlsRef.current; if (!hls) return; hls.currentLevel = value; setHlsQuality(value) }\n  const changePlaybackRate = () => { const video = videoRef.current; if (!video) return; const rates = [0.5, 0.75, 1, 1.25, 1.5, 2]; const current = Number(video.playbackRate.toFixed(2)); const index = rates.indexOf(current); const next = rates[(index >= 0 ? index + 1 : 2) % rates.length]; video.playbackRate = next; setPlaybackRate(next) }\n",
      )

      fixed = fixed.replace(
        "    {!isPlaying && !error && <div className=\"player-center-play\" onClick={handleVideoClick}><Play size={28} fill=\"currentColor\" /></div>}\n",
        "",
      )

      fixed = fixed.replace(
        "        <button className=\"player-action\" onClick={() => seekBy(-10)} title=\"Voltar 10 segundos\"><SkipBack size={16} /></button>\n",
        "        <button className=\"player-live-action player-action\" onClick={goLive} title=\"Ir para o ao vivo\" style={{ width: 54, flex: '0 0 54px', gap: 4, fontSize: 9, fontWeight: 800 }}><Radio size={14} /><span>LIVE</span></button>\n        <button className=\"player-speed-action player-action\" onClick={changePlaybackRate} title=\"Velocidade de reprodução\" style={{ width: 46, flex: '0 0 46px', fontSize: 10, fontWeight: 800 }}>{playbackRate}x</button>\n        <button className=\"player-action\" onClick={() => seekBy(-10)} title=\"Voltar 10 segundos\"><SkipBack size={16} /></button>\n",
      )

      fixed = fixed.replace(
        "        <button className=\"player-action\" onClick={togglePlay} title={isPlaying ? 'Pausar' : 'Reproduzir'}>{isPlaying ? <Pause size={17} /> : <Play size={17} fill=\"currentColor\" />}</button>\n",
        "",
      )

      fixed = fixed.replace(
        "        <input className=\"player-volume\" aria-label=\"Volume\" type=\"range\" min={0} max={1} step={0.01} value={isMuted ? 0 : volume} onChange={(event) => setPlayerVolume(Number(event.target.value))} />\n",
        "        <input className=\"player-volume\" aria-label=\"Volume\" type=\"range\" min={0} max={1} step={0.01} value={isMuted ? 0 : volume} style={{ background: `linear-gradient(90deg, #4a8cff 0%, #4a8cff ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,.22) ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,.22) 100%)`, transition: 'background 120ms ease' }} onPointerDown={showControls} onChange={(event) => setPlayerVolume(Number(event.target.value))} />\n",
      )

      fixed = fixed.replace(
        "        <button className=\"player-action\" onClick={goLive} title=\"Ir para o ao vivo\"><Radio size={16} /></button>\n",
        "",
      )

      return fixed === code ? null : { code: fixed, map: null }
    },
  }
}

export default defineConfig({ plugins: [react(), localApi()] })
