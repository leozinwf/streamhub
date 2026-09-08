import { useEffect, useMemo, useRef, useState } from 'react'
import { Maximize2, Minimize2, PictureInPicture2, Radio, RefreshCw, Settings2, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import type { Channel, ChannelVariant } from '../types'

function isMpegTs(url: string) {
  const value = url.toLowerCase().split('?')[0]
  return value.endsWith('.ts') || value.endsWith('.m2ts')
}

function proxyStreamUrl(url: string) {
  return `/api/stream?url=${encodeURIComponent(url)}`
}

function xtreamTsFallback(url: string) {
  if (!/\/live\//i.test(url) || !/\.m3u8(?:$|\?)/i.test(url)) return null
  return url.replace(/\.m3u8(?=$|\?)/i, '.ts')
}

function uniqueVariants(channel: Channel | null): ChannelVariant[] {
  if (!channel?.variants?.length) return []
  return Array.from(new Map(channel.variants.map((variant) => [variant.id, variant])).values())
}

function safePlay(video: HTMLVideoElement, audible = false) {
  if (audible) video.muted = false
  void video.play().catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return
    if (audible) {
      video.muted = true
      void video.play().catch(() => undefined)
    }
  })
}

type Props = {
  channel: Channel | null
}

export default function Player({ channel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const tsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null)
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [usingFallback, setUsingFallback] = useState(false)
  const [variantId, setVariantId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(Number.NaN)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPictureInPicture, setIsPictureInPicture] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [hlsLevels, setHlsLevels] = useState<Array<{ index: number; height: number; bitrate: number }>>([])
  const [hlsQuality, setHlsQuality] = useState(-1)
  const [playbackRate, setPlaybackRate] = useState(1)

  const variants = useMemo(() => uniqueVariants(channel), [channel])
  const activeVariant = variants.find((variant) => variant.id === variantId) ?? null
  const activeUrl = activeVariant?.url ?? channel?.url ?? ''

  const showControls = () => {
    setControlsVisible(true)
    if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current)
  }

  const scheduleHideControls = () => {
    if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current)
    controlsHideTimerRef.current = setTimeout(() => {
      setControlsVisible(false)
      setSettingsOpen(false)
    }, 1500)
  }

  useEffect(() => {
    setVariantId(null)
    setUsingFallback(false)
    setSettingsOpen(false)
    setPlaybackRate(1)
    showControls()
  }, [channel?.id])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const sync = () => {
      setIsPlaying(!video.paused)
      setIsMuted(video.muted || video.volume === 0)
      setVolume(video.volume)
      setCurrentTime(Number.isFinite(video.currentTime) ? video.currentTime : 0)
      setDuration(Number.isFinite(video.duration) ? video.duration : Number.NaN)
    }
    const onFullscreen = () => setIsFullscreen(document.fullscreenElement === rootRef.current)
    const onEnterPiP = () => setIsPictureInPicture(true)
    const onLeavePiP = () => setIsPictureInPicture(false)
    const events: Array<keyof HTMLMediaElementEventMap> = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'volumechange', 'progress', 'playing', 'waiting']
    events.forEach((event) => video.addEventListener(event, sync))
    document.addEventListener('fullscreenchange', onFullscreen)
    video.addEventListener('enterpictureinpicture', onEnterPiP)
    video.addEventListener('leavepictureinpicture', onLeavePiP)
    sync()
    return () => {
      events.forEach((event) => video.removeEventListener(event, sync))
      document.removeEventListener('fullscreenchange', onFullscreen)
      video.removeEventListener('enterpictureinpicture', onEnterPiP)
      video.removeEventListener('leavepictureinpicture', onLeavePiP)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA') return
      const video = videoRef.current
      if (!video) return
      if (event.code === 'Space') { event.preventDefault(); void (video.paused ? safePlay(video) : video.pause()) }
      else if (event.key.toLowerCase() === 'm') { event.preventDefault(); video.muted = !video.muted }
      else if (event.key.toLowerCase() === 'f') { event.preventDefault(); void toggleFullscreen() }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); seekBy(-10) }
      else if (event.key === 'ArrowRight') { event.preventDefault(); seekBy(10) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !channel) return

    let disposed = false
    let mediaRecoveryAttempts = 0
    let networkRecoveryAttempts = 0
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null

    const cleanupVideo = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer)
      watchdogTimer = null
      video.pause()
      video.removeAttribute('src')
      video.load()
    }

    const destroyPlayers = () => {
      try { hlsRef.current?.destroy() } catch { /* ignore */ }
      try { tsRef.current?.destroy() } catch { /* ignore */ }
      hlsRef.current = null
      tsRef.current = null
    }

    const fail = (message: string) => {
      if (!disposed) setError(message)
    }

    const startWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer)
      watchdogTimer = setTimeout(() => {
        if (!disposed && (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime < 0.5)) {
          fail('O stream carregou, mas não entregou dados suficientes para iniciar.')
        }
      }, 10000)
    }

    setError(null)
    setHlsLevels([])
    setHlsQuality(-1)
    video.muted = false
    video.volume = 1

    const startTs = (url: string) => {
      if (disposed || !mpegts.getFeatureList().mseLivePlayback) return false
      try {
        const player = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: proxyStreamUrl(url),
          cors: true,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 8,
          liveBufferLatencyMinRemain: 2,
        } as any)
        tsRef.current = player
        player.attachMediaElement(video)
        player.on(mpegts.Events.ERROR, (_type, detail) => fail(`Falha MPEG-TS: ${String(detail || 'erro desconhecido')}`))
        player.load()
        startWatchdog()
        safePlay(video, true)
        return true
      } catch (cause) {
        fail(`Não foi possível iniciar MPEG-TS: ${String(cause)}`)
        return false
      }
    }

    if (isMpegTs(activeUrl)) {
      if (!startTs(activeUrl)) fail('O navegador não conseguiu iniciar este stream MPEG-TS.')
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startPosition: -1,
        backBufferLength: 20,
        maxBufferLength: 12,
        maxMaxBufferLength: 24,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        manifestLoadingMaxRetry: 2,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 2,
        levelLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 2,
        fragLoadingRetryDelay: 1000,
        appendErrorMaxRetry: 2,
      })
      hlsRef.current = hls
      hls.attachMedia(video)
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (!disposed) hls.loadSource(proxyStreamUrl(usingFallback ? xtreamTsFallback(activeUrl) || activeUrl : activeUrl))
      })
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (disposed) return
        setHlsLevels(hls.levels.map((level, index) => ({ index, height: level.height || 0, bitrate: level.bitrate || 0 })))
        startWatchdog()
        safePlay(video, true)
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (disposed || !data.fatal) return
        const details = data.details || 'erro desconhecido'
        const status = data.response?.code ? ` HTTP ${data.response.code}` : ''
        const message = `${details}${status}`
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (networkRecoveryAttempts < 1) { networkRecoveryAttempts += 1; hls.startLoad(); return }
          const fallback = xtreamTsFallback(activeUrl)
          if (fallback && !usingFallback) { setUsingFallback(true); setRetryKey((value) => value + 1); return }
          fail(`Falha de rede no HLS (${message}).`)
          return
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (mediaRecoveryAttempts === 0) { mediaRecoveryAttempts += 1; hls.recoverMediaError(); return }
          if (mediaRecoveryAttempts === 1) { mediaRecoveryAttempts += 1; try { hls.swapAudioCodec() } catch { /* ignore */ }; hls.recoverMediaError(); return }
          const fallback = xtreamTsFallback(activeUrl)
          if (fallback && !usingFallback) { setUsingFallback(true); setRetryKey((value) => value + 1); return }
          fail(`Falha de mídia no HLS (${message}).`)
          return
        }
        fail(`O HLS não pôde ser reproduzido (${message}).`)
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = proxyStreamUrl(usingFallback ? xtreamTsFallback(activeUrl) || activeUrl : activeUrl)
      const onLoaded = () => { startWatchdog(); safePlay(video, true) }
      const onError = () => fail('O player nativo não conseguiu carregar o HLS.')
      video.addEventListener('loadedmetadata', onLoaded)
      video.addEventListener('error', onError)
      return () => { disposed = true; video.removeEventListener('loadedmetadata', onLoaded); video.removeEventListener('error', onError); cleanupVideo() }
    } else {
      fail('Este navegador não oferece suporte ao formato deste stream.')
    }

    return () => {
      disposed = true
      if (watchdogTimer) clearTimeout(watchdogTimer)
      destroyPlayers()
      cleanupVideo()
    }
  }, [channel, activeUrl, retryKey, usingFallback])

  const togglePlay = () => { const video = videoRef.current; if (!video) return; if (video.paused) safePlay(video); else video.pause() }
  const toggleMute = () => { const video = videoRef.current; if (!video) return; video.muted = !video.muted }
  const setPlayerVolume = (value: number) => { const video = videoRef.current; if (!video) return; video.volume = Math.max(0, Math.min(1, value)); if (value > 0) video.muted = false }
  const seekBy = (delta: number) => { const video = videoRef.current; if (!video || !Number.isFinite(video.duration)) return; video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + delta)) }
  const goLive = () => { const video = videoRef.current; if (!video) return; const livePosition = Number((hlsRef.current as any)?.liveSyncPosition); if (Number.isFinite(livePosition)) video.currentTime = livePosition; else if (Number.isFinite(video.duration)) video.currentTime = Math.max(0, video.duration - 0.5) }
  const toggleFullscreen = async () => { const root = rootRef.current; if (!root) return; if (document.fullscreenElement) await document.exitFullscreen(); else await root.requestFullscreen() }
  const togglePiP = async () => { const video = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<PictureInPictureWindow> }; if (!video.requestPictureInPicture) return; try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture() } catch { /* unsupported/rejected */ } }
  const retry = () => { setUsingFallback(false); setRetryKey((value) => value + 1) }
  const selectVariant = (variant: ChannelVariant) => { setVariantId(variant.id); setUsingFallback(false); setSettingsOpen(false); setRetryKey((value) => value + 1) }
  const selectHlsQuality = (value: number) => { const hls = hlsRef.current; if (!hls) return; hls.currentLevel = value; setHlsQuality(value) }
  const changePlaybackRate = () => { const video = videoRef.current; if (!video) return; const rates = [0.5, 0.75, 1, 1.25, 1.5, 2]; const current = Number(video.playbackRate.toFixed(2)); const index = rates.indexOf(current); const next = rates[(index >= 0 ? index + 1 : 2) % rates.length]; video.playbackRate = next; setPlaybackRate(next) }
  const handleVideoClick = () => { togglePlay(); scheduleHideControls() }

  if (!channel) return <div className="empty-player"><strong>Selecione um canal para assistir</strong><span>Escolha um canal da sua biblioteca abaixo</span></div>

  const fullscreenRootStyle = isFullscreen ? { width: '100vw', height: '100vh', aspectRatio: 'auto' as const, maxWidth: '100vw', maxHeight: '100vh' } : undefined
  const fullscreenVideoStyle = isFullscreen ? { width: '100%', height: '100%', objectFit: 'contain' as const, maxWidth: '100%', maxHeight: '100%' } : undefined

  return <div ref={rootRef} className={`video-wrapper player-modern ${controlsVisible ? 'controls-visible' : 'controls-hidden'}`} style={fullscreenRootStyle} onMouseEnter={showControls} onMouseMove={showControls} onMouseLeave={scheduleHideControls} onDoubleClick={() => void toggleFullscreen()}>
    <video ref={videoRef} controls={false} playsInline preload="auto" style={fullscreenVideoStyle} onClick={handleVideoClick} />
    <div className="now-playing"><div><strong>{channel.name}</strong><span>{channel.group}</span></div><small>{activeVariant?.quality || (usingFallback ? 'MPEG-TS' : isMpegTs(activeUrl) ? 'MPEG-TS' : 'HLS')}</small></div>
    {error && <div className="video-error"><span>{error}</span><button onClick={retry}><RefreshCw size={14} /> Tentar novamente</button></div>}
    <div className="player-custom-controls" onMouseEnter={showControls} onDoubleClick={(event) => event.stopPropagation()}>
      {Number.isFinite(duration) && duration > 0 && <input className="player-seek" aria-label="Posição" type="range" min={0} max={duration} step={0.1} value={Math.min(currentTime, duration)} onChange={(event) => { const video = videoRef.current; if (video) video.currentTime = Number(event.target.value) }} />}
      <div className="player-control-row">
        <button className="player-live-action player-action" onClick={goLive} title="Ir para o ao vivo"><Radio size={14} /><span>LIVE</span></button>
        <button className="player-speed-action player-action" onClick={changePlaybackRate} title="Velocidade de reprodução">{playbackRate}x</button>
        <button className="player-action" onClick={() => seekBy(-10)} title="Voltar 10 segundos"><SkipBack size={16} /></button>
        <button className="player-action" onClick={() => seekBy(10)} title="Avançar 10 segundos"><SkipForward size={16} /></button>
        <button className="player-action" onClick={toggleMute} title={isMuted ? 'Ativar som' : 'Silenciar'}>{isMuted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
        <input className="player-volume" aria-label="Volume" type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume} style={{ background: `linear-gradient(90deg, #4a8cff 0%, #4a8cff ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,.22) ${(isMuted ? 0 : volume) * 100}%, rgba(255,255,255,.22) 100%)` }} onPointerDown={showControls} onChange={(event) => setPlayerVolume(Number(event.target.value))} />
        <span className="player-control-spacer" />
        {variants.length > 1 && <div className="player-settings-wrap">
          <button className="player-action" onClick={() => { setSettingsOpen((value) => !value); showControls() }} title="Qualidade"><Settings2 size={17} /></button>
          {settingsOpen && <div className="player-settings-menu">
            <div className="player-settings-title">Qualidade do canal</div>
            {variants.map((variant) => <button key={variant.id} className={variant.id === (activeVariant?.id ?? channel.id) ? 'quality-option active' : 'quality-option'} onClick={() => selectVariant(variant)}><span>{variant.quality}</span><small>{variant.name}</small></button>)}
            {hlsLevels.length > 1 && <>
              <div className="player-settings-title">Qualidade HLS</div>
              <button className={hlsQuality === -1 ? 'quality-option active' : 'quality-option'} onClick={() => selectHlsQuality(-1)}><span>Automático</span><small>Seleção adaptativa</small></button>
              {hlsLevels.slice().sort((a, b) => b.height - a.height).map((level) => <button key={level.index} className={hlsQuality === level.index ? 'quality-option active' : 'quality-option'} onClick={() => selectHlsQuality(level.index)}><span>{level.height ? `${level.height}p` : 'Qualidade'}</span><small>{level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : 'HLS'}</small></button>)}
            </>}
          </div>}
        </div>}
        <button className="player-action" onClick={() => void togglePiP()} title="Picture-in-Picture"><PictureInPicture2 size={17} /></button>
        <button className="player-action" onClick={() => void toggleFullscreen()} title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>{isFullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
      </div>
    </div>
  </div>
}
