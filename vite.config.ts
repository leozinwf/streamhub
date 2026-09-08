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
          const startedAt = Date.now()
          try {
            const headers = new Headers()
            for (const [key, value] of Object.entries(req.headers ?? {})) {
              if (typeof value === 'string') headers.set(key, value)
              else if (Array.isArray(value)) headers.set(key, value.join(', '))
            }
            const request = new Request(`http://localhost:5173${req.url ?? ''}`, {
              method: req.method ?? 'GET',
              headers,
            })
            const response = await handler(request)
            console.info(`[StreamHub API] ${req.method ?? 'GET'} ${route} -> ${response.status} (${Date.now() - startedAt}ms)`)
            await sendResponse(response, res, route === '/api/stream')
          } catch (error) {
            console.error(`[StreamHub API] ${req.method ?? 'GET'} ${route} -> EXCEPTION`, error)
            next(error)
          }
        })
      }
    },
    transform(code, id) {
      if (!id.endsWith('/src/App.tsx')) return null

      let fixed = code
        .replace(
          "import { Search, Upload, Play, Star, Tv, X, Link, LoaderCircle, Server, Eye, EyeOff, Menu, Home, Radio, RefreshCw, Clock3, Trash2 } from 'lucide-react'",
          "import { Search, Upload, Play, Star, Tv, X, Link, LoaderCircle, Server, Eye, EyeOff, Menu, Home, Radio, RefreshCw, Clock3, Trash2, Volume2, VolumeX, Maximize2, Minimize2, PictureInPicture2, Settings2, RotateCcw, SkipBack, SkipForward } from 'lucide-react'",
        )
        .replace('    setError(null)\n    setUsingFallback(false)\n    setDebug', '    setError(null)\n    setDebug')
        .replace('  }, [channel, retryKey, usingFallback])', '  }, [channel, retryKey])')

      const debugStateLine = "  const [debug, setDebug] = useState<DebugState>({ mode: '—', manifest: '—', firstSegment: '—', lastError: '', elapsed: 0 })"
      if (fixed.includes(debugStateLine) && !fixed.includes('const [isPlaying, setIsPlaying]')) {
        fixed = fixed.replace(
          debugStateLine,
          `${debugStateLine}\n  const playerRootRef = useRef<HTMLDivElement>(null)\n  const [isPlaying, setIsPlaying] = useState(false)\n  const [isMuted, setIsMuted] = useState(true)\n  const [volume, setVolume] = useState(1)\n  const [isFullscreen, setIsFullscreen] = useState(false)\n  const [isPictureInPicture, setIsPictureInPicture] = useState(false)\n  const [currentTime, setCurrentTime] = useState(0)\n  const [duration, setDuration] = useState(Number.NaN)\n  const [quality, setQuality] = useState(-1)\n  const [qualityLevels, setQualityLevels] = useState<Array<{ index: number; height: number; bitrate: number }>>([])`,
        )
      }

      const effectAnchor = "  useEffect(() => {\n    const video = videoRef.current\n    if (!video || !channel) return"
      if (fixed.includes(effectAnchor) && !fixed.includes('fullscreenchange')) {
        fixed = fixed.replace(
          effectAnchor,
          `  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const sync = () => {
      setIsPlaying(!video.paused)
      setIsMuted(video.muted || video.volume === 0)
      setVolume(video.volume)
      setCurrentTime(Number.isFinite(video.currentTime) ? video.currentTime : 0)
      setDuration(Number.isFinite(video.duration) ? video.duration : Number.NaN)
    }
    const onFullscreen = () => setIsFullscreen(document.fullscreenElement === playerRootRef.current)
    const events: Array<keyof HTMLMediaElementEventMap> = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'volumechange', 'progress', 'playing', 'waiting']
    events.forEach((event) => video.addEventListener(event, sync))
    document.addEventListener('fullscreenchange', onFullscreen)
    video.addEventListener('enterpictureinpicture', () => setIsPictureInPicture(true))
    video.addEventListener('leavepictureinpicture', () => setIsPictureInPicture(false))
    sync()
    return () => {
      events.forEach((event) => video.removeEventListener(event, sync))
      document.removeEventListener('fullscreenchange', onFullscreen)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA') return
      const video = videoRef.current
      if (!video) return
      if (event.code === 'Space') { event.preventDefault(); void (video.paused ? video.play() : video.pause()); return }
      if (event.key.toLowerCase() === 'm') { event.preventDefault(); video.muted = !video.muted; return }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); void toggleFullscreen() }
      if (event.key === 'ArrowLeft') { event.preventDefault(); seekBy(-10) }
      if (event.key === 'ArrowRight') { event.preventDefault(); seekBy(10) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    setQualityLevels([])
    setQuality(-1)
    setIsPlaying(false)
    setIsPictureInPicture(false)
  }, [channel, retryKey])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !channel) return`,
        )
      }

      fixed = fixed.replace(
        '    setError(null)\n    setDebug({ mode: \'—\', manifest: \'—\', firstSegment: \'—\', lastError: \'\', elapsed: 0 })',
        '    setError(null)\n    setDebug({ mode: \'—\', manifest: \'—\', firstSegment: \'—\', lastError: \'\', elapsed: 0 })\n    setIsMuted(true)\n    setVolume(1)\n    video.muted = true\n    video.volume = 1',
      )

      fixed = fixed.replace(
        "      hls.on(Hls.Events.MANIFEST_PARSED, () => {",
        "      hls.on(Hls.Events.MANIFEST_PARSED, () => {\n        setQualityLevels(hls.levels.map((level, index) => ({ index, height: level.height || 0, bitrate: level.bitrate || 0 })))",
      )

      const returnAnchor = '  return <div className="video-wrapper">'
      if (fixed.includes(returnAnchor) && !fixed.includes('player-custom-controls')) {
        fixed = fixed.replace(
          returnAnchor,
          `  const togglePlay = () => { const video = videoRef.current; if (!video) return; void (video.paused ? video.play() : video.pause()) }
  const toggleMute = () => { const video = videoRef.current; if (!video) return; video.muted = !video.muted }
  const setPlayerVolume = (value: number) => { const video = videoRef.current; if (!video) return; video.volume = Math.max(0, Math.min(1, value)); if (value > 0 && video.muted) video.muted = false }
  const seekBy = (delta: number) => { const video = videoRef.current; if (!video || !Number.isFinite(video.duration)) return; video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta)) }
  const goLive = () => { const video = videoRef.current; if (!video) return; const livePosition = Number((hlsRef.current as any)?.liveSyncPosition); if (Number.isFinite(livePosition)) video.currentTime = livePosition; else if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.5) }
  const selectQuality = (value: number) => { const hls = hlsRef.current; if (!hls) return; hls.currentLevel = value; setQuality(value) }
  const toggleFullscreen = async () => { const root = playerRootRef.current; if (!root) return; if (document.fullscreenElement) { await document.exitFullscreen(); return } await root.requestFullscreen() }
  const togglePictureInPicture = async () => { const video = videoRef.current as (HTMLVideoElement & { requestPictureInPicture?: () => Promise<PictureInPictureWindow> }) | null; if (!video?.requestPictureInPicture) return; try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture() } catch { /* browser may reject PiP for this stream */ } }
  const retryPlayer = () => { setUsingFallback(false); setRetryKey((value) => value + 1) }
  const formatTime = (value: number) => { if (!Number.isFinite(value)) return 'LIVE'; const total = Math.max(0, Math.floor(value)); const h = Math.floor(total / 3600); const m = Math.floor((total % 3600) / 60); const s = total % 60; return h > 0 ? [h, String(m).padStart(2, '0'), String(s).padStart(2, '0')].join(':') : [m, String(s).padStart(2, '0')].join(':') }

  return <div ref={playerRootRef} className="video-wrapper" onDoubleClick={() => void toggleFullscreen()}>
    <video ref={videoRef} controls={false} playsInline preload="auto" onClick={togglePlay} />
    {!isPlaying && !error && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}><span style={{ width: 62, height: 62, display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(0,0,0,.62)', color: '#fff', boxShadow: '0 8px 35px rgba(0,0,0,.35)' }}><Play size={28} fill="currentColor" /></span></div>}
    <div className="player-custom-controls" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '44px 12px 10px', background: 'linear-gradient(transparent, rgba(0,0,0,.92))', color: '#fff' }} onDoubleClick={(event) => event.stopPropagation()}>
      {Number.isFinite(duration) && duration > 0 && <input aria-label="Posição" type="range" min={0} max={duration} step={0.1} value={Math.min(currentTime, duration)} onChange={(event) => { const video = videoRef.current; if (video) video.currentTime = Number(event.target.value) }} style={{ width: '100%', accentColor: '#4a8cff', margin: '0 0 7px' }} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <button className="ghost-button player-action" onClick={togglePlay} title={isPlaying ? 'Pausar' : 'Reproduzir'}>{isPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <button className="ghost-button player-action" onClick={() => seekBy(-10)} title="Voltar 10 segundos"><SkipBack size={16} /></button>
        <button className="ghost-button player-action" onClick={() => seekBy(10)} title="Avançar 10 segundos"><SkipForward size={16} /></button>
        <button className="ghost-button player-action" onClick={toggleMute} title={isMuted ? 'Ativar som' : 'Silenciar'}>{isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
        <input aria-label="Volume" type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume} onChange={(event) => setPlayerVolume(Number(event.target.value))} style={{ width: 90, accentColor: '#4a8cff' }} />
        <span style={{ fontSize: 11, color: '#d0d6df', minWidth: 72 }}>{Number.isFinite(duration) ? `${formatTime(currentTime)} / ${formatTime(duration)}` : 'AO VIVO'}</span>
        <div style={{ flex: 1 }} />
        {qualityLevels.length > 0 && <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title="Qualidade"><Settings2 size={15} /><select aria-label="Qualidade" value={quality} onChange={(event) => selectQuality(Number(event.target.value))} style={{ background: '#11151d', border: '1px solid rgba(255,255,255,.14)', color: '#fff', borderRadius: 7, padding: '6px 8px', fontSize: 11 }}><option value={-1}>Auto</option>{qualityLevels.map((level) => <option key={level.index} value={level.index}>{level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)} kbps`}</option>)}</select></label>}
        <button className="ghost-button player-action" onClick={goLive} title="Ir para o ao vivo"><Radio size={16} /></button>
        <button className="ghost-button player-action" onClick={() => void togglePictureInPicture()} title="Picture-in-Picture"><PictureInPicture2 size={16} /></button>
        <button className="ghost-button player-action" onClick={retryPlayer} title="Recarregar canal"><RotateCcw size={16} /></button>
        <button className="ghost-button player-action" onClick={() => void toggleFullscreen()} title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5, fontSize: 10, color: '#8f99aa' }}><span>{usingFallback ? 'MPEG-TS fallback' : isMpegTs(channel.url) ? 'MPEG-TS' : 'HLS'}</span><span>{isPictureInPicture ? 'PiP ativo' : 'Atalhos: espaço · M · F · ← →'}</span></div>
    </div>`,
        )
      }

      fixed = fixed.replace(
        "{error && <div className=\"video-error\"><span>{error}</span><button onClick={() => { setUsingFallback(false); setRetryKey((value) => value + 1) }}><RefreshCw size={14} /> Tentar novamente</button></div>}",
        "{error && <div className=\"video-error\"><span>{error}</span><button onClick={retryPlayer}><RefreshCw size={14} /> Tentar novamente</button></div>}",
      )

      return fixed === code ? null : { code: fixed, map: null }
    },
  }
}

export default defineConfig({ plugins: [react(), localApi()] })
