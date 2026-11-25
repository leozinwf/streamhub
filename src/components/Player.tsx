import { clearProgress, getProgress, markWatched, saveProgress } from '../lib/watchState'
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, ChevronLeft, ChevronRight, Gauge, Maximize, Minimize, Pause, PictureInPicture2, Play, RectangleHorizontal, RefreshCw, RotateCcw, RotateCw, Scan, Settings, SlidersHorizontal, Volume1, Volume2, VolumeX } from 'lucide-react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import type { Channel, ChannelVariant } from '../types'
import { readVolume, usePreference } from '../lib/preferences'
import { groupLabel } from '../lib/groupLabel'

function isMpegTs(url: string) {
  const value = url.toLowerCase().split('?')[0]
  return value.endsWith('.ts') || value.endsWith('.m2ts')
}

function isDirectVideo(url: string) {
  return /\.(?:mp4|m4v|webm|mkv|avi|mov)(?:$|\?)/i.test(url)
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
  void video.play().catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') return
    if (audible) {
      video.muted = true
      void video.play().catch(() => undefined)
    }
  })
}

function formatTime(value: number) {
  const total = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor(total / 60) % 60
  const seconds = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

const PLAYBACK_RATES = ['0.5', '0.75', '1', '1.25', '1.5', '2'] as const
const SCREEN_FITS = ['contain', 'cover', 'fill'] as const
const SCREEN_FIT_LABELS: Record<(typeof SCREEN_FITS)[number], string> = { contain: 'Ajustar', cover: 'Preencher', fill: 'Esticar' }
const SCREEN_FIT_HINTS: Record<(typeof SCREEN_FITS)[number], string> = { contain: 'Sem cortes (original)', cover: 'Corta as bordas', fill: 'Ocupa toda a tela' }
/** How far back (seconds) a live channel can be rewound. The browser may keep less. */
const DVR_BUFFER_SECONDS = 30 * 60
/**
 * Memory budget for already-played HLS media. Browsers cap a SourceBuffer at
 * roughly 150 MB; holding 30 minutes of HD video overflows it, appends start
 * failing and playback freezes until the buffer is flushed (e.g. by switching
 * quality). The rewind window is derived from the bitrate to stay under it.
 */
const BACK_BUFFER_BUDGET_BYTES = 90 * 1024 * 1024
const MIN_BACK_BUFFER_SECONDS = 60
/** MPEG-TS has no bitrate info up front, so keep a conservative fixed window. */
const TS_BACK_BUFFER_SECONDS = 4 * 60
/** Playback that makes no progress for this long counts as frozen. */
const STALL_TIMEOUT_MS = 4000

function backBufferFor(bitrate: number) {
  if (!bitrate || !Number.isFinite(bitrate)) return 3 * 60
  const seconds = (BACK_BUFFER_BUDGET_BYTES * 8) / bitrate
  return Math.round(Math.min(DVR_BUFFER_SECONDS, Math.max(MIN_BACK_BUFFER_SECONDS, seconds)))
}

/** Within this many seconds of the live edge the player counts as "ao vivo". */
const LIVE_EDGE_TOLERANCE = 8

type Timeline = { start: number; end: number; bufferedEnd: number }
type MenuPanel = 'main' | 'quality' | 'speed' | 'fit'

/** Seekable window: whole file for VOD; for live, from the oldest kept media to the live edge. */
function readTimeline(video: HTMLVideoElement, hls: Hls | null, live: boolean): Timeline {
  const ranges = video.buffered
  const bufferedStart = ranges.length ? ranges.start(0) : Number.NaN
  const bufferedEnd = ranges.length ? ranges.end(ranges.length - 1) : Number.NaN
  const current = Number.isFinite(video.currentTime) ? video.currentTime : 0
  if (!live) {
    const end = Number.isFinite(video.duration) ? video.duration : Number.isFinite(bufferedEnd) ? bufferedEnd : 0
    return { start: 0, end, bufferedEnd }
  }
  let edge = Number.NaN
  let windowStart = Number.NaN
  if (hls) {
    const sync = hls.liveSyncPosition
    if (sync !== null && Number.isFinite(sync)) edge = sync
    const level = hls.levels[hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel] as (typeof hls.levels)[number] | undefined
    const fragments = level?.details?.fragments
    if (fragments?.length) windowStart = fragments[0].start
  }
  if (!Number.isFinite(edge)) edge = Number.isFinite(bufferedEnd) ? Math.max(0, bufferedEnd - 1.5) : current
  edge = Math.max(edge, current)
  const starts = [bufferedStart, windowStart, current].filter(Number.isFinite)
  return { start: Math.min(...starts), end: edge, bufferedEnd }
}

type Props = {
  channel: Channel | null
  theaterMode?: boolean
  onToggleTheater?: () => void
  /** Movies/episodes: called when playback reaches the end (next episode). */
  onEnded?: () => void
}

export default function Player({ channel, theaterMode = false, onToggleTheater, onEnded }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const tsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null)
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const progressRef = useRef<HTMLDivElement>(null)
  const settingsWrapRef = useRef<HTMLDivElement>(null)
  const settingsOpenRef = useRef(false)
  /** True while the viewer is watching the live edge; false after pausing or rewinding. */
  const followLiveRef = useRef(true)
  const isLiveRef = useRef(false)
  /** False only after the viewer pauses; while true a paused video is restarted. */
  const wantPlayRef = useRef(true)
  const tapRevealRef = useRef(false)
  const theaterToggleRef = useRef(onToggleTheater)
  theaterToggleRef.current = onToggleTheater
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [usingFallback, setUsingFallback] = useState(false)
  const [variantId, setVariantId] = useState<string | null>(null)
  /** Short message over the video (quality switched, resumed from…). */
  const [notice, setNotice] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null)
  const triedVariantsRef = useRef(new Set<string>())
  const onEndedRef = useRef(onEnded)
  onEndedRef.current = onEnded
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [volume, setVolume] = useState(readVolume)
  const [screenFit, setScreenFit] = usePreference('streamhub-screen-fit', 'contain', SCREEN_FITS)
  const [mutedPreference, setMutedPreference] = usePreference('streamhub-muted', '0', ['0', '1'] as const)
  const [currentTime, setCurrentTime] = useState(0)
  const [timeline, setTimeline] = useState<Timeline>({ start: 0, end: 0, bufferedEnd: Number.NaN })
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isPictureInPicture, setIsPictureInPicture] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [menuPanel, setMenuPanel] = useState<MenuPanel>('main')
  const [controlsVisible, setControlsVisible] = useState(false)
  const [hlsLevels, setHlsLevels] = useState<Array<{ index: number; height: number; bitrate: number }>>([])
  const [hlsQuality, setHlsQuality] = useState(-1)
  /** Quality chosen by the viewer (-1 = auto), readable from player callbacks. */
  const hlsQualityRef = useRef(-1)
  const [activeHeight, setActiveHeight] = useState(0)
  const [scrubTime, setScrubTime] = useState<number | null>(null)
  const [hoverPoint, setHoverPoint] = useState<{ x: number; time: number } | null>(null)
  const [playbackRate, setPlaybackRate] = usePreference('streamhub-playback-rate', '1', PLAYBACK_RATES)
  const requestedRateRef = useRef(playbackRate)

  const variants = useMemo(() => uniqueVariants(channel), [channel])
  const activeVariant = variants.find((variant) => variant.id === variantId) ?? null
  const activeUrl = activeVariant?.url ?? channel?.url ?? ''
  const isLive = Boolean(channel) && channel?.kind !== 'movie' && channel?.kind !== 'series' && !isDirectVideo(activeUrl)
  isLiveRef.current = isLive

  const showControls = () => {
    setControlsVisible(true)
    scheduleHideControls()
  }

  const scheduleHideControls = () => {
    if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current)
    // Keep the controls up while the settings menu is open; it closes on outside click or Escape.
    if (settingsOpenRef.current) return
    controlsHideTimerRef.current = setTimeout(() => {
      setControlsVisible(false)
      setSettingsOpen(false)
    }, 3000)
  }

  useEffect(() => {
    settingsOpenRef.current = settingsOpen
    if (!settingsOpen) { setMenuPanel('main'); return }
    if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current)
    setControlsVisible(true)
    const onPointerDown = (event: PointerEvent) => {
      if (settingsWrapRef.current && !settingsWrapRef.current.contains(event.target as Node)) setSettingsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setSettingsOpen(false) }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      settingsOpenRef.current = false
      scheduleHideControls()
    }
  }, [settingsOpen])

  useEffect(() => () => { if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current) }, [])

  useEffect(() => {
    triedVariantsRef.current = new Set()
    setNotice(null)
    setVariantId(null)
    setUsingFallback(false)
    setSettingsOpen(false)
    if (controlsHideTimerRef.current) clearTimeout(controlsHideTimerRef.current)
    setControlsVisible(false)
  }, [channel?.id])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = readVolume()
    video.muted = mutedPreference === '1'
    const sync = () => {
      setIsPlaying(!video.paused)
      setIsMuted(video.muted || video.volume === 0)
      setVolume(video.volume)
      setCurrentTime(Number.isFinite(video.currentTime) ? video.currentTime : 0)
      setTimeline(readTimeline(video, hlsRef.current, isLiveRef.current))
    }
    const onFullscreen = () => setIsFullscreen(document.fullscreenElement === rootRef.current)
    const onEnterPiP = () => setIsPictureInPicture(true)
    const onLeavePiP = () => setIsPictureInPicture(false)
    const events: Array<keyof HTMLMediaElementEventMap> = ['play', 'pause', 'timeupdate', 'loadedmetadata', 'durationchange', 'volumechange', 'progress', 'playing', 'waiting', 'seeked']
    events.forEach((event) => video.addEventListener(event, sync))
    document.addEventListener('fullscreenchange', onFullscreen)
    video.addEventListener('enterpictureinpicture', onEnterPiP)
    video.addEventListener('leavepictureinpicture', onLeavePiP)
    // While paused no timeupdate fires, but the live edge keeps moving.
    const ticker = setInterval(() => { if (video.paused) sync() }, 1000)
    sync()
    return () => {
      clearInterval(ticker)
      events.forEach((event) => video.removeEventListener(event, sync))
      document.removeEventListener('fullscreenchange', onFullscreen)
      video.removeEventListener('enterpictureinpicture', onEnterPiP)
      video.removeEventListener('leavepictureinpicture', onLeavePiP)
    }
  }, [channel !== null])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.isContentEditable || target?.tagName === 'BUTTON' || target?.tagName === 'INPUT' || target?.tagName === 'SELECT' || target?.tagName === 'TEXTAREA') return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      // Shift+↑/↓ is channel up/down (handled by the app), not volume.
      if (event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) return
      const video = videoRef.current
      if (!video) return
      const key = event.key.toLowerCase()
      if (event.code === 'Space' || key === 'k') { event.preventDefault(); togglePlay(); showControls() }
      else if (key === 'm') { event.preventDefault(); video.muted = !video.muted; rememberAudio(video); showControls() }
      else if (key === 'f') { event.preventDefault(); void toggleFullscreen() }
      else if (key === 't' && theaterToggleRef.current) { event.preventDefault(); theaterToggleRef.current() }
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setPlayerVolume((video.muted ? 0 : video.volume) + (event.key === 'ArrowUp' ? 0.05 : -0.05)); showControls() }
      else if (event.key === 'ArrowLeft' || key === 'j') { event.preventDefault(); seekBy(-10); showControls() }
      else if (event.key === 'ArrowRight' || key === 'l') { event.preventDefault(); seekBy(10); showControls() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !channel) return

    let disposed = false
    followLiveRef.current = true
    setActiveHeight(0)
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
    hlsQualityRef.current = -1

    const startTs = (url: string) => {
      if (disposed || !mpegts.getFeatureList().mseLivePlayback) return false
      try {
        const player = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: proxyStreamUrl(url),
          cors: true,
          // Live catch-up is handled by the player (followLive) so pausing and
          // rewinding are not undone by mpegts jumping back to the edge.
          liveBufferLatencyChasing: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: TS_BACK_BUFFER_SECONDS,
          autoCleanupMinBackwardDuration: TS_BACK_BUFFER_SECONDS - 60,
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

    if (isDirectVideo(activeUrl)) {
      video.src = proxyStreamUrl(activeUrl)
      const onLoaded = () => safePlay(video, true)
      const onError = () => fail('O navegador não conseguiu reproduzir este vídeo.')
      video.addEventListener('loadedmetadata', onLoaded)
      video.addEventListener('error', onError)
      return () => { disposed = true; video.removeEventListener('loadedmetadata', onLoaded); video.removeEventListener('error', onError); cleanupVideo() }
    } else if (isMpegTs(activeUrl)) {
      if (!startTs(activeUrl)) fail('O navegador não conseguiu iniciar este stream MPEG-TS.')
    } else if (Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        startPosition: -1,
        // Live streams often arrive unevenly. Keep enough media ahead of the
        // playhead to absorb a short interruption instead of falling back to
        // an older segment when loading resumes.
        // Keep already-played media so the user can pause and rewind live
        // channels (timeshift). The browser may evict older data earlier.
        // Adjusted per quality in LEVEL_SWITCHED (see backBufferFor).
        backBufferLength: 3 * 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        liveSyncDurationCount: 2,
        // Never auto-jump to the live edge: catching up is done by the
        // player only while the user is following the live broadcast.
        liveMaxLatencyDurationCount: Infinity,
        // When the stream gets behind, catch up gently rather than seeking
        // through the buffered timeline, which is perceived as a replay.
        maxLiveSyncPlaybackRate: 1.15,
        manifestLoadingMaxRetry: 3,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 4,
        levelLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 4,
        fragLoadingRetryDelay: 1000,
        appendErrorMaxRetry: 3,
      })
      hlsRef.current = hls
      hls.attachMedia(video)
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (!disposed) hls.loadSource(proxyStreamUrl(usingFallback ? xtreamTsFallback(activeUrl) || activeUrl : activeUrl))
      })
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        if (disposed) return
        const level = hls.levels[data.level]
        setActiveHeight(level?.height || 0)
        hls.config.backBufferLength = backBufferFor(level?.bitrate || 0)
      })
      // Media is flowing again: give future failures a fresh set of retries.
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        networkRecoveryAttempts = 0
        mediaRecoveryAttempts = 0
      })
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (disposed) return
        setHlsLevels(hls.levels.map((level, index) => ({ index, height: level.height || 0, bitrate: level.bitrate || 0 })))
        startWatchdog()
        safePlay(video, true)
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (disposed) return
        if (!data.fatal) {
          // The SourceBuffer is full: drop the played media now instead of
          // letting playback freeze until the next quality switch.
          if (data.details === Hls.ErrorDetails.BUFFER_FULL_ERROR && video.currentTime > 30) {
            hls.trigger(Hls.Events.BUFFER_FLUSHING, { startOffset: 0, endOffset: video.currentTime - 10, type: null })
          }
          return
        }
        const details = data.details || 'erro desconhecido'
        const status = data.response?.code ? ` HTTP ${data.response.code}` : ''
        const message = `${details}${status}`
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (networkRecoveryAttempts < 3) {
            networkRecoveryAttempts += 1
            setTimeout(() => { if (!disposed) hls.startLoad() }, 1000 * networkRecoveryAttempts)
            return
          }
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

    // Mid-playback freeze recovery. The start-up watchdog above only covers the
    // first seconds; after that a stalled stream used to stay frozen until the
    // viewer switched quality. Escalate: resume loading -> reload the current
    // quality (what a manual switch does) -> rebuild the media pipeline ->
    // restart the player.
    let lastTime = video.currentTime
    let lastProgressAt = Date.now()
    let stallStep = 0
    const stallTimer = setInterval(() => {
      if (disposed) return
      const now = Date.now()
      if (video.paused || video.ended || video.seeking || video.readyState === HTMLMediaElement.HAVE_NOTHING) {
        lastTime = video.currentTime
        lastProgressAt = now
        return
      }
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime
        lastProgressAt = now
        stallStep = 0
        return
      }
      if (now - lastProgressAt < STALL_TIMEOUT_MS) return
      lastProgressAt = now
      stallStep += 1
      recoverFromStall(stallStep)
    }, 1000)

    const recoverFromStall = (step: number) => {
      const hls = hlsRef.current
      const ts = tsRef.current
      // A small gap in the buffer: hop over it.
      for (let i = 0; i < video.buffered.length; i += 1) {
        const start = video.buffered.start(i)
        if (start > video.currentTime && start - video.currentTime < 2) { video.currentTime = start + 0.1; return }
      }
      if (hls) {
        if (step === 1) {
          const sync = hls.liveSyncPosition
          if (followLiveRef.current && sync !== null && Number.isFinite(sync) && sync > video.currentTime + 1) video.currentTime = sync
          hls.startLoad()
        } else if (step === 2) {
          // Same as picking a quality in the menu: flush and refetch.
          hls.currentLevel = hlsQualityRef.current
        } else if (step === 3) {
          hls.recoverMediaError()
        } else {
          setRetryKey((value) => value + 1)
        }
        safePlay(video)
        return
      }
      if (ts && step === 1 && video.buffered.length) {
        const end = video.buffered.end(video.buffered.length - 1)
        if (end - video.currentTime > 1) { video.currentTime = Math.max(video.currentTime, end - 2); return }
      }
      if (step >= 2) setRetryKey((value) => value + 1)
    }

    return () => {
      disposed = true
      clearInterval(stallTimer)
      if (watchdogTimer) clearTimeout(watchdogTimer)
      destroyPlayers()
      cleanupVideo()
    }
  }, [channel, activeUrl, retryKey, usingFallback])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    requestedRateRef.current = playbackRate
    const restoreRate = () => {
      const rate = Number(requestedRateRef.current)
      if (video.defaultPlaybackRate !== rate) video.defaultPlaybackRate = rate
      if (video.playbackRate !== rate) video.playbackRate = rate
    }
    restoreRate()
    const events = ['loadedmetadata', 'playing', 'ratechange'] as const
    events.forEach((event) => video.addEventListener(event, restoreRate))
    return () => events.forEach((event) => video.removeEventListener(event, restoreRate))
  }, [playbackRate, activeUrl, retryKey, usingFallback])

  // A quality that fails to open hands over to the next one of the same channel
  // (FHD → HD → SD…) before showing an error.
  useEffect(() => {
    if (!error || variants.length < 2) return
    const current = activeVariant ?? variants[0]
    triedVariantsRef.current.add(current.id)
    const next = variants.find((variant) => !triedVariantsRef.current.has(variant.id))
    if (!next) return
    setNotice({ text: `${current.quality || 'Esta qualidade'} não abriu. Trocando para ${next.quality || 'outra qualidade'}…` })
    setError(null)
    setUsingFallback(false)
    setVariantId(next.id)
    setRetryKey((value) => value + 1)
  }, [error])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), notice.action ? 8000 : 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  // Movies and episodes: resume where the viewer stopped, keep saving the
  // position, and report the end so the next episode can start.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !channel || (channel.kind !== 'movie' && channel.kind !== 'series')) return
    const entry = () => ({
      id: channel.id, mediaId: channel.mediaId || channel.id, kind: channel.kind as 'movie' | 'series', name: channel.name,
      label: channel.episodeLabel, poster: channel.logo, url: channel.url,
      position: video.currentTime, duration: video.duration,
    })
    let resumed = false
    let lastSave = 0
    const onMetadata = () => {
      if (resumed) return
      resumed = true
      const saved = getProgress(channel.id)
      if (saved && saved.position > 30 && (!Number.isFinite(video.duration) || saved.position < video.duration - 60)) {
        video.currentTime = saved.position
        setNotice({ text: `Continuando de ${formatTime(saved.position)}`, action: { label: 'Recomeçar', run: () => { video.currentTime = 0; clearProgress(channel.id); setNotice(null) } } })
      }
    }
    const onTime = () => {
      if (!resumed || Date.now() - lastSave < 5000) return
      lastSave = Date.now()
      saveProgress(entry())
    }
    const onPause = () => { if (resumed && video.currentTime > 0) saveProgress(entry()) }
    const onEnd = () => { markWatched(channel.id); onEndedRef.current?.() }
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) onMetadata()
    video.addEventListener('loadedmetadata', onMetadata)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnd)
    return () => {
      if (resumed && video.currentTime > 0) saveProgress(entry())
      video.removeEventListener('loadedmetadata', onMetadata)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnd)
    }
  }, [channel?.id, activeUrl, retryKey])

  // Autoplay guard. A play() call made while hls.js/mpegts are still attaching
  // or seeking is often rejected with AbortError ("interrupted by a new load
  // request"), which left channels sitting paused until the viewer pressed play.
  // Keep trying whenever the video becomes playable, unless the viewer paused.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !channel) return
    wantPlayRef.current = true
    const onPlay = () => { wantPlayRef.current = true }
    // Only a pause while media is loaded is the viewer's; teardown pauses come with no data.
    const onPause = () => { if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !video.ended) wantPlayRef.current = false }
    const kick = () => { if (wantPlayRef.current && video.paused && !video.ended && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) safePlay(video, true) }
    const events = ['loadeddata', 'canplay', 'canplaythrough', 'seeked'] as const
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    events.forEach((event) => video.addEventListener(event, kick))
    const timer = setInterval(kick, 1500)
    return () => {
      clearInterval(timer)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      events.forEach((event) => video.removeEventListener(event, kick))
    }
  }, [channel, activeUrl, retryKey, usingFallback])

  // Follow the live edge only while the viewer has not paused or rewound.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !isLive) return
    const chase = () => {
      if (!followLiveRef.current || video.paused || video.seeking) return
      const hls = hlsRef.current
      if (hls) {
        const sync = hls.liveSyncPosition
        // Jump before falling out of the playlist window (IPTV lists often
        // hold only a few segments); otherwise the next segment is gone.
        const details = hls.levels[hls.currentLevel >= 0 ? hls.currentLevel : hls.loadLevel]?.details
        const windowSeconds = details?.totalduration || 30
        const maxBehind = Math.max(10, Math.min(30, windowSeconds - (details?.targetduration || 6)))
        if (sync !== null && Number.isFinite(sync) && sync - video.currentTime > maxBehind) video.currentTime = sync
        return
      }
      if (!video.buffered.length) return
      const end = video.buffered.end(video.buffered.length - 1)
      if (end - video.currentTime > 8) video.currentTime = Math.max(video.currentTime, end - 2)
    }
    video.addEventListener('timeupdate', chase)
    return () => video.removeEventListener('timeupdate', chase)
  }, [isLive, activeUrl, retryKey, usingFallback])

  const rememberAudio = (video: HTMLVideoElement) => {
    setMutedPreference(video.muted ? '1' : '0')
    try { localStorage.setItem('streamhub-volume', String(video.volume)) } catch { /* Storage may be unavailable. */ }
  }

  /** While behind the live edge, let hls.js keep downloading ahead so nothing is lost (timeshift). */
  const setRecordingAhead = (enabled: boolean) => {
    const hls = hlsRef.current
    if (!hls) return
    hls.config.maxBufferLength = enabled ? 600 : 30
    hls.config.maxMaxBufferLength = enabled ? 900 : 60
  }

  const leaveLiveEdge = () => {
    if (!isLiveRef.current) return
    followLiveRef.current = false
    setRecordingAhead(true)
  }

  const goLive = () => {
    const video = videoRef.current
    if (!video) return
    followLiveRef.current = true
    setRecordingAhead(false)
    const sync = hlsRef.current?.liveSyncPosition
    if (sync !== null && sync !== undefined && Number.isFinite(sync)) video.currentTime = sync
    else if (video.buffered.length) video.currentTime = Math.max(0, video.buffered.end(video.buffered.length - 1) - 2)
    if (video.paused) safePlay(video)
  }

  const seekTo = (target: number) => {
    const video = videoRef.current
    if (!video) return
    const live = isLiveRef.current
    const { start, end } = readTimeline(video, hlsRef.current, live)
    if (live && end - target < LIVE_EDGE_TOLERANCE) { goLive(); return }
    let time = Math.max(start, Math.min(end, target))
    if (live) {
      leaveLiveEdge()
      // MPEG-TS can only seek inside what the browser has kept.
      if (!hlsRef.current && video.buffered.length) {
        const first = video.buffered.start(0)
        if (time < first) time = first + 0.5
      }
    }
    video.currentTime = time
  }

  const seekBy = (delta: number) => {
    const video = videoRef.current
    if (!video) return
    seekTo(video.currentTime + delta)
  }

  const togglePlay = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) safePlay(video)
    else { leaveLiveEdge(); video.pause() }
  }
  const toggleMute = () => { const video = videoRef.current; if (!video) return; if (video.volume === 0) { video.volume = 0.5; video.muted = false } else video.muted = !video.muted; rememberAudio(video) }
  const setPlayerVolume = (value: number) => { const video = videoRef.current; if (!video) return; video.volume = Math.max(0, Math.min(1, value)); if (value > 0) video.muted = false; rememberAudio(video) }
  const toggleFullscreen = async () => { const root = rootRef.current; if (!root) return; try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.requestFullscreen() } catch { /* unsupported/rejected */ } }
  const togglePiP = async () => { const video = videoRef.current as HTMLVideoElement & { requestPictureInPicture?: () => Promise<PictureInPictureWindow> }; if (!video?.requestPictureInPicture) return; try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await video.requestPictureInPicture() } catch { /* unsupported/rejected */ } }
  const retry = () => { setUsingFallback(false); setRetryKey((value) => value + 1) }
  const selectVariant = (variant: ChannelVariant) => { setVariantId(variant.id); setUsingFallback(false); setSettingsOpen(false); setRetryKey((value) => value + 1) }
  const selectHlsQuality = (value: number) => { const hls = hlsRef.current; if (!hls) return; hls.currentLevel = value; hlsQualityRef.current = value; setHlsQuality(value); setSettingsOpen(false) }
  const selectPlaybackRate = (next: (typeof PLAYBACK_RATES)[number]) => {
    const video = videoRef.current
    requestedRateRef.current = next
    if (video) { video.defaultPlaybackRate = Number(next); video.playbackRate = Number(next) }
    setPlaybackRate(next)
    setSettingsOpen(false)
  }

  // A tap on a touch screen while the controls are hidden only reveals them (like YouTube).
  const handlePointerDown = (event: ReactPointerEvent) => {
    tapRevealRef.current = event.pointerType !== 'mouse' && !controlsVisible
    showControls()
  }
  const handleVideoClick = () => {
    if (tapRevealRef.current) { tapRevealRef.current = false; return }
    togglePlay()
  }

  // Seek bar (drag + hover preview)
  const span = Math.max(0.001, timeline.end - timeline.start)
  const timeAt = (clientX: number) => {
    const rect = progressRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return timeline.start
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    return timeline.start + ratio * span
  }
  const onProgressDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setScrubTime(timeAt(event.clientX))
  }
  const onProgressMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = progressRef.current?.getBoundingClientRect()
    const time = timeAt(event.clientX)
    if (rect) setHoverPoint({ x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)), time })
    if (scrubTime !== null) setScrubTime(time)
  }
  const onProgressUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scrubTime === null) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    seekTo(timeAt(event.clientX))
    setScrubTime(null)
  }

  if (!channel) return <div className="empty-player"><strong>Selecione um canal para assistir</strong><span>Escolha um canal da sua biblioteca abaixo</span></div>

  const displayTime = scrubTime ?? currentTime
  const playedRatio = Math.max(0, Math.min(1, (displayTime - timeline.start) / span))
  const bufferedRatio = Number.isFinite(timeline.bufferedEnd) ? Math.max(0, Math.min(1, (timeline.bufferedEnd - timeline.start) / span)) : 0
  const behindLive = isLive ? Math.max(0, timeline.end - currentTime) : 0
  const atLive = isLive && isPlaying && behindLive < LIVE_EDGE_TOLERANCE && followLiveRef.current
  const canSeek = isLive ? timeline.end - timeline.start > 5 : timeline.end > 0
  const labelFor = (time: number) => {
    if (!isLive) return formatTime(time)
    const behind = timeline.end - time
    return behind < LIVE_EDGE_TOLERANCE ? 'Ao vivo' : `-${formatTime(behind)}`
  }

  const selectedLevel = hlsLevels.find((level) => level.index === hlsQuality)
  const qualityValue = hlsLevels.length > 1
    ? (selectedLevel ? `${selectedLevel.height}p` : `Automático${activeHeight ? ` (${activeHeight}p)` : ''}`)
    : variants.length > 1 ? (activeVariant ?? variants[0]).quality : 'Única'
  const badgeHeight = selectedLevel?.height || activeHeight
  const qualityText = activeVariant?.quality ?? (variants.length ? variants[0].quality : '')
  const qualityBadge = badgeHeight >= 2160 || /4k|uhd/i.test(qualityText) ? '4K' : badgeHeight >= 720 || /hd/i.test(qualityText) ? 'HD' : ''
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2

  return <div ref={rootRef} className={`video-wrapper player-modern ${controlsVisible || !isPlaying ? 'controls-visible' : 'controls-hidden'}`} onFocusCapture={showControls} onPointerDown={handlePointerDown} onMouseMove={showControls} onMouseLeave={scheduleHideControls} onDoubleClick={() => void toggleFullscreen()}>
    <video ref={videoRef} controls={false} playsInline preload="auto" style={{ objectFit: screenFit }} onClick={handleVideoClick} />
    <div className="now-playing"><div><strong>{channel.name}</strong><span>{groupLabel(channel.group)}</span></div><small>{activeVariant?.quality || (usingFallback ? 'MPEG-TS' : isMpegTs(activeUrl) ? 'MPEG-TS' : 'HLS')}</small></div>
    {!isPlaying && !error && <button className="player-center-play" onClick={togglePlay} onDoubleClick={(event) => event.stopPropagation()} aria-label="Reproduzir"><Play size={30} fill="currentColor" /></button>}
    {notice && <div className="player-notice" role="status"><span>{notice.text}</span>{notice.action && <button onClick={notice.action.run}>{notice.action.label}</button>}</div>}
    {error && <div className="video-error"><span>{error}</span><button onClick={retry}><RefreshCw size={14} /> Tentar novamente</button></div>}
    <div className="shp-controls" onDoubleClick={(event) => event.stopPropagation()}>
      {canSeek && <div ref={progressRef} className={`shp-progress ${scrubTime !== null ? 'dragging' : ''}`} role="slider" aria-label={isLive ? 'Linha do tempo do ao vivo' : 'Posição'} aria-valuemin={0} aria-valuemax={Math.round(span)} aria-valuenow={Math.round(displayTime - timeline.start)} aria-valuetext={labelFor(displayTime)} tabIndex={-1} onPointerDown={onProgressDown} onPointerMove={onProgressMove} onPointerUp={onProgressUp} onPointerCancel={() => setScrubTime(null)} onPointerLeave={() => setHoverPoint(null)}>
        <div className="shp-progress-track">
          <div className="shp-progress-buffered" style={{ width: `${bufferedRatio * 100}%` }} />
          <div className="shp-progress-played" style={{ width: `${playedRatio * 100}%` }} />
          <div className="shp-progress-thumb" style={{ left: `${playedRatio * 100}%` }} />
        </div>
        {(hoverPoint || scrubTime !== null) && <div className="shp-progress-tooltip" style={{ left: scrubTime !== null ? `${playedRatio * 100}%` : hoverPoint!.x }}>{labelFor(scrubTime ?? hoverPoint!.time)}</div>}
      </div>}
      <div className="shp-bar">
        <button className="shp-btn" onClick={togglePlay} title={isPlaying ? 'Pausar (k)' : 'Reproduzir (k)'} aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}>{isPlaying ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
        {canSeek && <button className="shp-btn shp-hide-sm" onClick={() => seekBy(-10)} title="Voltar 10 segundos (j)" aria-label="Voltar 10 segundos"><RotateCcw size={19} /></button>}
        {canSeek && <button className="shp-btn shp-hide-sm" onClick={() => seekBy(10)} title="Avançar 10 segundos (l)" aria-label="Avançar 10 segundos" disabled={isLive && atLive}><RotateCw size={19} /></button>}
        <div className="shp-volume-group">
          <button className="shp-btn" onClick={toggleMute} title={isMuted ? 'Ativar som (m)' : 'Desativar som (m)'} aria-label={isMuted ? 'Ativar som' : 'Desativar som'}><VolumeIcon size={21} /></button>
          <input className="shp-volume" aria-label="Volume" type="range" min={0} max={1} step={0.01} value={isMuted ? 0 : volume} aria-valuetext={`${Math.round((isMuted ? 0 : volume) * 100)}%`} onChange={(event) => setPlayerVolume(Number(event.target.value))} style={{ ['--vol' as string]: `${(isMuted ? 0 : volume) * 100}%` }} />
        </div>
        {isLive
          ? <>
            {!atLive && behindLive >= LIVE_EDGE_TOLERANCE && <span className="shp-time">-{formatTime(behindLive)}</span>}
            <button className={`shp-live ${atLive ? 'is-live' : ''}`} onClick={goLive} title={atLive ? 'Você está assistindo ao vivo' : 'Ir para o ao vivo'} aria-label={atLive ? 'Ao vivo' : 'Ir para o ao vivo'}><span className="shp-live-dot" />Ao vivo</button>
          </>
          : <span className="shp-time">{formatTime(displayTime)} / {formatTime(timeline.end)}</span>}
        <span className="shp-spacer" />
        <div className="shp-settings" ref={settingsWrapRef}>
          <button className="shp-btn" onClick={() => { setSettingsOpen((value) => !value); showControls() }} title="Configurações" aria-label="Configurações" aria-expanded={settingsOpen}><Settings size={21} className={settingsOpen ? 'shp-spin' : ''} />{qualityBadge && <span className="shp-badge">{qualityBadge}</span>}</button>
          {settingsOpen && <div className="shp-menu" role="menu">
            {menuPanel === 'main' && <>
              <button className="shp-menu-item" role="menuitem" onClick={() => setMenuPanel('quality')}><SlidersHorizontal size={18} /><span className="shp-menu-label">Qualidade</span><span className="shp-menu-value">{qualityValue}<ChevronRight size={16} /></span></button>
              <button className="shp-menu-item" role="menuitem" onClick={() => setMenuPanel('speed')}><Gauge size={18} /><span className="shp-menu-label">Velocidade da reprodução</span><span className="shp-menu-value">{playbackRate === '1' ? 'Normal' : `${playbackRate}x`}<ChevronRight size={16} /></span></button>
              <button className="shp-menu-item" role="menuitem" onClick={() => setMenuPanel('fit')}><Scan size={18} /><span className="shp-menu-label">Formato da imagem</span><span className="shp-menu-value">{SCREEN_FIT_LABELS[screenFit]}<ChevronRight size={16} /></span></button>
            </>}
            {menuPanel !== 'main' && <button className="shp-menu-item shp-menu-head" onClick={() => setMenuPanel('main')}><ChevronLeft size={18} /><span className="shp-menu-label">{menuPanel === 'quality' ? 'Qualidade' : menuPanel === 'speed' ? 'Velocidade da reprodução' : 'Formato da imagem'}</span></button>}
            {menuPanel === 'quality' && <>
              {variants.length > 1 && <>
                <div className="shp-menu-section">Versão do canal</div>
                {variants.map((variant) => { const active = variant.id === (activeVariant?.id ?? variants[0].id); return <button key={variant.id} className="shp-menu-item" role="menuitemradio" aria-checked={active} onClick={() => selectVariant(variant)}><span className="shp-check">{active && <Check size={17} />}</span><span className="shp-menu-label">{variant.quality}</span><span className="shp-menu-value">{variant.name}</span></button> })}
              </>}
              {hlsLevels.length > 1 && <>
                {variants.length > 1 && <div className="shp-menu-section">Resolução</div>}
                {hlsLevels.slice().sort((a, b) => b.height - a.height).map((level) => <button key={level.index} className="shp-menu-item" role="menuitemradio" aria-checked={hlsQuality === level.index} onClick={() => selectHlsQuality(level.index)}><span className="shp-check">{hlsQuality === level.index && <Check size={17} />}</span><span className="shp-menu-label">{level.height ? `${level.height}p` : 'Qualidade'}{level.height >= 720 && <sup className="shp-sup">HD</sup>}</span><span className="shp-menu-value">{level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : ''}</span></button>)}
                <button className="shp-menu-item" role="menuitemradio" aria-checked={hlsQuality === -1} onClick={() => selectHlsQuality(-1)}><span className="shp-check">{hlsQuality === -1 && <Check size={17} />}</span><span className="shp-menu-label">Automático{activeHeight ? ` (${activeHeight}p)` : ''}</span></button>
              </>}
              {variants.length <= 1 && hlsLevels.length <= 1 && <div className="shp-menu-note">Este canal não oferece outras qualidades.</div>}
            </>}
            {menuPanel === 'speed' && PLAYBACK_RATES.map((rate) => <button key={rate} className="shp-menu-item" role="menuitemradio" aria-checked={playbackRate === rate} onClick={() => selectPlaybackRate(rate)}><span className="shp-check">{playbackRate === rate && <Check size={17} />}</span><span className="shp-menu-label">{rate === '1' ? 'Normal' : `${rate}x`}</span></button>)}
            {menuPanel === 'fit' && <>
              {SCREEN_FITS.map((fit) => <button key={fit} className="shp-menu-item" role="menuitemradio" aria-checked={screenFit === fit} onClick={() => { setScreenFit(fit); setSettingsOpen(false) }}><span className="shp-check">{screenFit === fit && <Check size={17} />}</span><span className="shp-menu-label">{SCREEN_FIT_LABELS[fit]}</span><span className="shp-menu-value">{SCREEN_FIT_HINTS[fit]}</span></button>)}
              <div className="shp-menu-note">Salvo automaticamente neste navegador.</div>
            </>}
          </div>}
        </div>
        {onToggleTheater && <button className={`shp-btn shp-hide-sm ${theaterMode ? 'active' : ''}`} onClick={onToggleTheater} title={theaterMode ? 'Visualização padrão (t)' : 'Modo teatro (t)'} aria-label={theaterMode ? 'Visualização padrão' : 'Modo teatro'} aria-pressed={theaterMode}><RectangleHorizontal size={theaterMode ? 18 : 22} /></button>}
        <button className="shp-btn shp-hide-xs" onClick={() => void togglePiP()} title={isPictureInPicture ? 'Sair do miniplayer' : 'Miniplayer (Picture-in-Picture)'} aria-label="Picture-in-Picture"><PictureInPicture2 size={19} /></button>
        <button className="shp-btn" onClick={() => void toggleFullscreen()} title={isFullscreen ? 'Sair da tela cheia (f)' : 'Tela cheia (f)'} aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}>{isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}</button>
      </div>
    </div>
  </div>
}
