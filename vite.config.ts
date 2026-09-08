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
      if (id.endsWith('/src/styles.css')) {
        const extra = `

/* StreamHub UI extensions */
.sidebar{width:320px;flex-basis:320px}
.nav-item span{min-width:0}
.nav-item small{margin-left:auto;min-width:24px;padding:2px 6px;border-radius:10px;background:#171d28;color:#8a98ad;font-size:10px;font-weight:800;text-align:center;line-height:1.2}
.nav-item:hover small,.nav-item.active small{background:rgba(74,140,255,.14);color:#8fb9ff}
.nav-heading{white-space:nowrap}
.recent-list{display:flex;flex-direction:column;gap:7px}
.recent-row{display:flex;align-items:center;gap:8px;padding:7px;border:1px solid rgba(255,255,255,.06);border-radius:12px;background:#0f131b}
.recent-main{min-width:0;flex:1;display:flex;align-items:center;gap:11px;padding:4px;border:0;background:transparent;color:#eef2f8;text-align:left}
.recent-main>div:last-child{min-width:0}
.recent-main strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.recent-main span{display:block;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#697587;font-size:11px}
.recent-remove{width:32px;height:32px;flex:0 0 32px;display:grid;place-items:center;border:0;border-radius:9px;background:transparent;color:#6d798b}
.recent-remove:hover{background:#20161a;color:#ff9aa4}
.active-toggle{background:#15233a!important;color:#72a9ff!important}
.theater-mode .topbar{z-index:70}
.theater-mode .layout{display:block;min-height:calc(100vh - 64px)}
.theater-mode .sidebar{display:none}
.theater-mode .content{max-width:100%;padding:16px 24px 34px}
.theater-mode .watch-area,.theater-mode .category-strip,.theater-mode .channels-section{width:min(1500px,100%)}
.theater-mode .player-screen{border-radius:10px;box-shadow:0 20px 70px rgba(0,0,0,.42)}
.adult-chip{border:1px solid rgba(194,53,66,.25)}
.adult-chip.active{background:#3a161d;color:#ffb4ba}
.adult-area{padding:16px;border:1px solid rgba(194,53,66,.2);border-radius:16px;background:linear-gradient(180deg,rgba(72,18,25,.18),rgba(10,12,17,.3))}
.adult-heading{color:#c35a67}
.adult-nav-item{border:1px solid rgba(194,53,66,.16)}
.adult-nav-icon{width:31px!important;height:22px;display:grid!important;place-items:center;flex:0 0 31px;padding:0!important;border-radius:6px;background:#481920;color:#ffb4ba!important;font-size:9px;font-weight:900;letter-spacing:.02em}
@media(max-width:1100px){.sidebar{width:280px;flex-basis:280px}}
@media(max-width:800px){.sidebar{width:320px;flex-basis:320px}}
@media(max-width:560px){.sidebar{width:min(92vw,320px);flex-basis:min(92vw,320px)}.theater-mode .content{padding:8px 10px 28px}.recent-row{padding:6px}.recent-remove{width:30px;height:30px;flex-basis:30px}}
`
        return { code: code + extra, map: null }
      }

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

      fixed = fixed.replace(
        "        <span className=\"player-time\">{formatTime(currentTime)}</span>\n        <span className=\"player-time\">{Number.isFinite(duration) ? ` / ${formatTime(duration)}` : ''}</span>\n",
        "",
      )

      return fixed === code ? null : { code: fixed, map: null }
    },
  }
}

export default defineConfig({ plugins: [react(), localApi()] })
