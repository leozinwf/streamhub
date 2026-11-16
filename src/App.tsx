import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Upload, Play, Star, Tv, X, Link, LoaderCircle, Server, Eye, EyeOff, Menu, Home, Radio, RefreshCw, Clock3, Trash2, Theater, List, LayoutGrid, Film, Clapperboard, ChevronLeft, ChevronDown, PanelRightOpen, CalendarDays, Download, Settings, LogOut, LayoutDashboard } from 'lucide-react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { parseM3U } from './lib/m3u'
import { clearPlaylist, loadPlaylist, savePlaylist } from './lib/storage'
import type { Channel, MediaItem, Playlist, XtreamConnection } from './types'
import ModernPlayer from './components/Player'
import HomeFeed, { ChannelCard, MediaCard } from './components/HomeFeed'
import Mosaic, { MOSAIC_LAYOUTS, MOSAIC_LIMIT, layoutCapacity, layoutLabel, type MosaicLayout } from './components/Mosaic'
import { usePreference } from './lib/preferences'
import { groupLabel } from './lib/groupLabel'
import { recommendChannels } from './lib/recommend'
import { collapseChannelVariants, compareChannelNames, normalizeChannelKey } from './lib/channelVariants'
import { categorizeChannel, categorizeChannels, compareCategories, isForeignGroup } from './lib/categorize'

const RECENT_STORAGE_KEY = 'streamhub-recent-channels'
const FAVORITES_STORAGE_KEY = 'streamhub-favorite-channels'
const MAX_RECENT_CHANNELS = 20
const THEATER_STORAGE_KEY = 'streamhub-theater-mode'
const LAST_LIVE_STORAGE_KEY = 'streamhub-last-live-channel'
const FAVORITE_GROUPS_STORAGE_KEY = 'streamhub-favorite-groups'
const MOSAIC_STORAGE_KEY = 'streamhub-mosaic-channels'

function createPlaylist(name: string, channels: Channel[]): Playlist {
  return { id: crypto.randomUUID(), name, channels, importedAt: new Date().toISOString() }
}

function fetchXtream(connection: XtreamConnection, action?: string, parameters: Record<string, string> = {}) {
  return fetch('/api/xtream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...connection, action, ...parameters }),
  })
}

function inferXtreamConnection(channels: Channel[]): XtreamConnection | null {
  for (const channel of channels) {
    try {
      const url = new URL(channel.url)
      const match = url.pathname.match(/^\/live\/([^/]+)\/([^/]+)\//)
      if (match) return { server: url.origin, username: decodeURIComponent(match[1]), password: decodeURIComponent(match[2]) }
    } catch { /* try the next channel */ }
  }
  return null
}

async function loadMediaCatalog(connection: XtreamConnection): Promise<MediaItem[]> {
  const [vodCategoriesResponse, vodResponse, seriesCategoriesResponse, seriesResponse] = await Promise.all([
    fetchXtream(connection, 'get_vod_categories'),
    fetchXtream(connection, 'get_vod_streams'),
    fetchXtream(connection, 'get_series_categories'),
    fetchXtream(connection, 'get_series'),
  ])
  const vodCategories = vodCategoriesResponse.ok ? await vodCategoriesResponse.json() as Array<{ category_id?: string | number; category_name?: string }> : []
  const seriesCategories = seriesCategoriesResponse.ok ? await seriesCategoriesResponse.json() as Array<{ category_id?: string | number; category_name?: string }> : []
  const vodCategoryMap = new Map(vodCategories.map((item) => [String(item.category_id), item.category_name || 'Filmes']))
  const seriesCategoryMap = new Map(seriesCategories.map((item) => [String(item.category_id), item.category_name || 'Séries']))
  const movies = vodResponse.ok ? await vodResponse.json() as Array<{ stream_id?: string | number; name?: string; category_id?: string | number; stream_icon?: string; container_extension?: string }> : []
  const series = seriesResponse.ok ? await seriesResponse.json() as Array<{ series_id?: string | number; name?: string; category_id?: string | number; cover?: string }> : []
  const movieItems: MediaItem[] = movies.filter((item) => item.stream_id != null && item.name).map((item) => ({
    id: `movie-${item.stream_id}`,
    name: item.name || 'Filme sem nome',
    kind: 'movie',
    category: vodCategoryMap.get(String(item.category_id)) || 'Filmes',
    poster: item.stream_icon || undefined,
    streamUrl: `${connection.server}/movie/${encodeURIComponent(connection.username)}/${encodeURIComponent(connection.password)}/${item.stream_id}.${String(item.container_extension || 'mp4').replace(/^\./, '')}`,
  }))
  const seriesItems: MediaItem[] = series.filter((item) => item.series_id != null && item.name).map((item) => ({
    id: `series-${item.series_id}`,
    name: item.name || 'Série sem nome',
    kind: 'series',
    category: seriesCategoryMap.get(String(item.category_id)) || 'Séries',
    poster: item.cover || undefined,
    seriesId: String(item.series_id),
  }))
  return [...movieItems, ...seriesItems]
}

type EpgProgram = { title: string; description: string; start: number; end: number }
type EpgStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'no-guide' | 'error'
type EpgListing = { title?: string; description?: string; start_timestamp?: string | number; stop_timestamp?: string | number }

function parseEpgListings(listings: EpgListing[] | undefined, now = Date.now()) {
  const seen = new Set<number>()
  return (listings || []).map((item) => ({
    title: decodeEpgText(item.title) || 'Programa sem título',
    description: decodeEpgText(item.description),
    start: Number(item.start_timestamp || 0),
    end: Number(item.stop_timestamp || 0),
  }))
    .filter((item) => item.start > 0 && item.end > item.start && item.end * 1000 >= now && !seen.has(item.start) && seen.add(item.start))
    .sort((a, b) => a.start - b.start)
}

function formatClock(seconds: number) {
  return new Date(seconds * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`
}

function decodeEpgText(value?: string) {
  if (!value) return ''
  try { return decodeURIComponent(escape(atob(value))) } catch { return value }
}

function channelStreamId(channel: Channel) {
  if (channel.streamId) return channel.streamId
  try { return new URL(channel.url).pathname.match(/\/([^/]+)\.[^.]+$/)?.[1] || '' } catch { return '' }
}

function PlaylistSettings({ playlist, categoryCount, showPassword, onTogglePassword, onClose, onExport }: { playlist: Playlist; categoryCount: number; showPassword: boolean; onTogglePassword: () => void; onClose: () => void; onExport: () => void }) {
  const access = playlist.xtream || inferXtreamConnection(playlist.channels)
  return <div className="settings-overlay" role="presentation" onMouseDown={onClose}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}><button className="settings-close" onClick={onClose} aria-label="Fechar"><X size={18} /></button><span className="eyebrow">INFORMAÇÕES DA LISTA</span><h2 id="settings-title">{playlist.name}</h2><dl><div><dt>Canais ao vivo</dt><dd>{playlist.channels.length.toLocaleString('pt-BR')}</dd></div><div><dt>Filmes</dt><dd>{playlist.media?.filter((item) => item.kind === 'movie').length.toLocaleString('pt-BR') || 0}</dd></div><div><dt>Séries</dt><dd>{playlist.media?.filter((item) => item.kind === 'series').length.toLocaleString('pt-BR') || 0}</dd></div><div><dt>Categorias</dt><dd>{categoryCount.toLocaleString('pt-BR')}</dd></div><div><dt>Adicionada em</dt><dd>{new Date(playlist.importedAt).toLocaleDateString('pt-BR')}</dd></div>{access ? <><div><dt>URL de acesso</dt><dd title={access.server}>{access.server}</dd></div><div><dt>Usuário</dt><dd className="access-value">{access.username}</dd></div><div><dt>Senha</dt><dd className="password-value"><span>{showPassword ? access.password : '••••••••'}</span><button onClick={onTogglePassword} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={15} /> : <Eye size={15} />}</button></dd></div></> : <div><dt>Origem</dt><dd>Lista M3U</dd></div>}</dl><button className="settings-export" onClick={onExport}><Download size={17} /> Exportar lista completa</button></section></div>
}

function canonicalChannelKey(channel: Channel) {
  return `${channel.group.toLocaleLowerCase('pt-BR')}::${normalizeChannelKey(channel.name)}`
}

function readStoredList(key: string): string[] {
  try { const parsed = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [] } catch { return [] }
}

function isAdultGroup(group: string) {
  return /adult|xxx|porn|sexo|sex\b|erotic|erótic|18\+|18 anos|privat|hot|sensual/i.test(group)
}

function isAdultChannel(channel: Channel) {
  return isAdultGroup(channel.group) || /\b(?:xxx|porn|pornô|sexo|sex|adult|18\+|erotic|erótico|hot)\b/i.test(channel.name)
}

function readStoredChannels(key: string, limit?: number): Channel[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Channel[]
    if (!Array.isArray(parsed)) return []
    return limit ? parsed.slice(0, limit) : parsed
  } catch { return [] }
}

function writeStoredChannels(key: string, channels: Channel[], limit?: number) {
  try { localStorage.setItem(key, JSON.stringify(limit ? channels.slice(0, limit) : channels)) } catch { /* ignore storage errors */ }
}

function normalizeServer(value: string) {
  const raw = value.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(raw)) return raw ? `http://${raw}` : ''
  return raw
}

function xtreamTsFallback(url: string) {
  if (!/\/live\//i.test(url) || !/\.m3u8(?:$|\?)/i.test(url)) return null
  return url.replace(/\.m3u8(?=$|\?)/i, '.ts')
}

type PlayerMode = 'hls' | 'mpegts' | 'native'

type DebugState = {
  mode: PlayerMode | '—'
  manifest: '—' | 'carregando' | 'ok' | 'erro'
  firstSegment: '—' | 'carregando' | 'ok' | 'erro'
  lastError: string
  elapsed: number
}

function Player({ channel }: { channel: Channel | null }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const tsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [usingFallback, setUsingFallback] = useState(false)
  const [debug, setDebug] = useState<DebugState>({ mode: '—', manifest: '—', firstSegment: '—', lastError: '', elapsed: 0 })

  useEffect(() => {
    const video = videoRef.current
    if (!video || !channel) return
    setError(null)
    setUsingFallback(false)
    setDebug({ mode: '—', manifest: '—', firstSegment: '—', lastError: '', elapsed: 0 })
    let disposed = false
    let mediaRecoveryAttempts = 0
    let networkRecoveryAttempts = 0
    let progressTimer: ReturnType<typeof setInterval> | null = null
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null
    let lastCurrentTime = 0
    let sourceStartedAt = Date.now()

    const stopTimers = () => {
      if (progressTimer) clearInterval(progressTimer)
      if (watchdogTimer) clearTimeout(watchdogTimer)
      progressTimer = null
      watchdogTimer = null
    }
    const cleanupVideo = () => { stopTimers(); video.pause(); video.removeAttribute('src'); video.load() }
    const destroyPlayers = () => { try { hlsRef.current?.destroy() } catch {} try { tsRef.current?.destroy() } catch {}; hlsRef.current = null; tsRef.current = null }
    const markError = (message: string) => { if (disposed) return; setDebug((current) => ({ ...current, lastError: message, elapsed: Math.round((Date.now() - sourceStartedAt) / 1000) })); setError(message) }
    const startWatchdog = () => {
      stopTimers()
      sourceStartedAt = Date.now()
      lastCurrentTime = video.currentTime || 0
      progressTimer = setInterval(() => {
        if (disposed) return
        const elapsed = Math.round((Date.now() - sourceStartedAt) / 1000)
        const currentTime = video.currentTime || 0
        if (currentTime > lastCurrentTime + 0.15) setDebug((current) => ({ ...current, firstSegment: 'ok', elapsed }))
        lastCurrentTime = currentTime
        setDebug((current) => ({ ...current, elapsed }))
      }, 1000)
      watchdogTimer = setTimeout(() => { if (!disposed && (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.currentTime < 0.5)) markError('O manifesto carregou, mas o vídeo não recebeu dados suficientes para iniciar.') }, 10000)
    }
    const startMpegTs = (url: string) => {
      if (disposed || !mpegts.getFeatureList().mseLivePlayback) return false
      try {
        tsRef.current?.destroy()
        setDebug((current) => ({ ...current, mode: 'mpegts', manifest: 'ok', firstSegment: 'carregando' }))
        const player = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: `/api/stream?url=${encodeURIComponent(url)}`, cors: true, liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 8, liveBufferLatencyMinRemain: 2 } as any)
        tsRef.current = player
        player.attachMediaElement(video)
        player.on(mpegts.Events.ERROR, (_type, detail) => markError(`Falha MPEG-TS: ${String(detail || 'erro desconhecido')}`))
        player.load(); startWatchdog(); void Promise.resolve(player.play()).catch(() => undefined); return true
      } catch (cause) { markError(`Não foi possível iniciar MPEG-TS: ${String(cause)}`); return false }
    }
    const sourceUrl = usingFallback ? xtreamTsFallback(channel.url) || channel.url : channel.url
    if (/\.(?:ts|m2ts)(?:$|\?)/i.test(sourceUrl)) {
      if (!startMpegTs(sourceUrl)) markError('O navegador não conseguiu iniciar a reprodução MPEG-TS deste canal.')
    } else if (Hls.isSupported()) {
      setDebug((current) => ({ ...current, mode: 'hls', manifest: 'carregando', firstSegment: 'carregando' }))
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, startPosition: -1, backBufferLength: 20, maxBufferLength: 12, maxMaxBufferLength: 24, liveSyncDurationCount: 3, liveMaxLatencyDurationCount: 8, manifestLoadingMaxRetry: 2, manifestLoadingRetryDelay: 1000, levelLoadingMaxRetry: 2, levelLoadingRetryDelay: 1000, fragLoadingMaxRetry: 2, fragLoadingRetryDelay: 1000, appendErrorMaxRetry: 2 })
      hlsRef.current = hls; hls.attachMedia(video)
      hls.on(Hls.Events.MEDIA_ATTACHED, () => { if (!disposed) hls.loadSource(`/api/stream?url=${encodeURIComponent(sourceUrl)}`) })
      hls.on(Hls.Events.MANIFEST_LOADING, () => { if (!disposed) setDebug((current) => ({ ...current, manifest: 'carregando' })) })
      hls.on(Hls.Events.MANIFEST_PARSED, () => { if (!disposed) { setDebug((current) => ({ ...current, manifest: 'ok', firstSegment: 'carregando' })); video.muted = true; startWatchdog(); void video.play().catch(() => undefined) } })
      hls.on(Hls.Events.FRAG_LOADING, () => { if (!disposed) setDebug((current) => ({ ...current, firstSegment: 'carregando' })) })
      hls.on(Hls.Events.FRAG_LOADED, () => { if (!disposed) setDebug((current) => ({ ...current, firstSegment: 'ok' })) })
      hls.on(Hls.Events.FRAG_PARSED, () => { if (!disposed) setDebug((current) => ({ ...current, firstSegment: 'ok' })) })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (disposed) return
        const details = data.details || 'erro desconhecido'; const status = data.response?.code ? ` HTTP ${data.response.code}` : ''; const message = `${details}${status}`
        setDebug((current) => ({ ...current, lastError: message, elapsed: Math.round((Date.now() - sourceStartedAt) / 1000) })); if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { if (networkRecoveryAttempts < 1) { networkRecoveryAttempts += 1; hls.startLoad(); return }; const fallback = xtreamTsFallback(channel.url); if (fallback && !usingFallback) { setUsingFallback(true); setRetryKey((value) => value + 1); return }; markError(`Falha de rede no HLS (${message}).`); return }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { if (mediaRecoveryAttempts === 0) { mediaRecoveryAttempts += 1; hls.recoverMediaError(); return }; if (mediaRecoveryAttempts === 1) { mediaRecoveryAttempts += 1; try { hls.swapAudioCodec() } catch {}; hls.recoverMediaError(); return }; const fallback = xtreamTsFallback(channel.url); if (fallback && !usingFallback) { setUsingFallback(true); setRetryKey((value) => value + 1); return }; markError(`Falha de mídia no HLS (${message}).`); return }
        markError(`O HLS não pôde ser reproduzido (${message}).`)
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = `/api/stream?url=${encodeURIComponent(sourceUrl)}`
      const onLoaded = () => { startWatchdog(); void video.play().catch(() => undefined) }
      const onError = () => markError('O player nativo não conseguiu carregar o HLS.')
      video.addEventListener('loadedmetadata', onLoaded); video.addEventListener('error', onError)
      return () => { disposed = true; video.removeEventListener('loadedmetadata', onLoaded); video.removeEventListener('error', onError); cleanupVideo() }
    } else markError('Este navegador não oferece suporte ao formato deste stream.')
    return () => { disposed = true; stopTimers(); destroyPlayers(); cleanupVideo() }
  }, [channel, retryKey, usingFallback])

  if (!channel) return <div className="empty-player"><div className="empty-player-icon"><Play size={28} /></div><strong>Selecione um canal para assistir</strong><span>Escolha um canal da sua biblioteca abaixo</span></div>
  return <div className="video-wrapper"><video ref={videoRef} controls playsInline preload="auto" /><div className="now-playing"><div><strong>{channel.name}</strong><span>{channel.group}</span></div><small>{usingFallback ? 'MPEG-TS' : /\.(?:ts|m2ts)(?:$|\?)/i.test(channel.url) ? 'MPEG-TS' : 'HLS'}</small></div>{error && <div className="video-error"><span>{error}</span><button onClick={() => { setUsingFallback(false); setRetryKey((value) => value + 1) }}><RefreshCw size={14} /> Tentar novamente</button></div>}</div>
}

export default function App() {
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [ready, setReady] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState('Todos')
  const [selectedSubgroup, setSelectedSubgroup] = useState('Todos')
  const [contentMode, setContentMode] = usePreference('streamhub-library', 'home', ['home', 'live', 'movie', 'series'] as const)
  const [categoryStyle, setCategoryStyle] = usePreference('streamhub-category-style', 'smart', ['smart', 'provider'] as const)
  const [selectedMediaCategory, setSelectedMediaCategory] = useState('Todos')
  const [selectedSeries, setSelectedSeries] = useState<MediaItem | null>(null)
  const [seriesEpisodes, setSeriesEpisodes] = useState<Channel[]>([])
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [epgPrograms, setEpgPrograms] = useState<EpgProgram[]>([])
  const [epgLoading, setEpgLoading] = useState(false)
  const [epgStatus, setEpgStatus] = useState<EpgStatus>('idle')
  const [epgReload, setEpgReload] = useState(0)
  const [clock, setClock] = useState(() => Date.now())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showAccessPassword, setShowAccessPassword] = useState(false)
  const [libraryLoading, setLibraryLoading] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null)
  const [recentChannels, setRecentChannels] = useState<Channel[]>([])
  const [favoriteChannels, setFavoriteChannels] = useState<Channel[]>([])
  const [mode, setMode] = usePreference('streamhub-connection-mode', 'm3u', ['m3u', 'xtream'] as const)
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [theaterMode, setTheaterMode] = useState(false)
  // The left navigation starts closed on the watch pages (like YouTube); ☰ opens it.
  const [navCollapsed, setNavCollapsed] = useState(true)
  const [groupPickerOpen, setGroupPickerOpen] = useState(false)
  const [channelPanelHidden, setChannelPanelHidden] = useState(false)
  const groupPickerRef = useRef<HTMLDivElement>(null)
  const autoRecommendRef = useRef(true)
  const [channelLimit, setChannelLimit] = useState(120)
  const [mediaLimit, setMediaLimit] = useState(120)
  const [channelView, setChannelView] = usePreference('streamhub-channel-view', 'grid', ['grid', 'list'] as const)
  const [miniPlayer, setMiniPlayer] = useState(false)
  const [favoriteGroups, setFavoriteGroups] = useState<string[]>(() => readStoredList(FAVORITE_GROUPS_STORAGE_KEY))
  const [categoryQuery, setCategoryQuery] = useState('')
  const [mosaicMode, setMosaicMode] = usePreference('streamhub-mosaic-mode', '0', ['0', '1'] as const)
  const [mosaicChannels, setMosaicChannels] = useState<Channel[]>(() => readStoredChannels(MOSAIC_STORAGE_KEY, MOSAIC_LIMIT))
  const [mosaicNotice, setMosaicNotice] = useState<string | null>(null)
  const mosaicActive = mosaicMode === '1' && contentMode === 'live'
  const [mosaicLayout, setMosaicLayout] = usePreference<MosaicLayout>('streamhub-mosaic-layout', 'auto', MOSAIC_LAYOUTS)
  const mosaicCapacity = layoutCapacity(mosaicLayout)
  const playerSlotRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const slot = playerSlotRef.current
    if (!slot || (!selectedChannel && !mosaicActive) || theaterMode) { setMiniPlayer(false); return }
    const observer = new IntersectionObserver(([entry]) => {
      setMiniPlayer(!entry.isIntersecting && entry.boundingClientRect.top < 0)
    }, { rootMargin: '-64px 0px 0px 0px' })
    observer.observe(slot)
    return () => observer.disconnect()
  }, [ready, playlist !== null, selectedChannel !== null, theaterMode, contentMode, mosaicActive])

  function changeChannelView(view: 'grid' | 'list') {
    setChannelView(view)
  }

  function changeCategoryStyle(style: 'smart' | 'provider') {
    setCategoryStyle(style)
    setSelectedGroup('Todos')
    setSelectedSubgroup('Todos')
  }

  useEffect(() => {
    setRecentChannels(readStoredChannels(RECENT_STORAGE_KEY, MAX_RECENT_CHANNELS).map(categorizeChannel))
    setFavoriteChannels(readStoredChannels(FAVORITES_STORAGE_KEY).map(categorizeChannel))
    try { setTheaterMode(localStorage.getItem(THEATER_STORAGE_KEY) === '1') } catch {}
    void loadPlaylist().then(async (stored) => {
      if (stored) {
        const categorized = { ...stored, channels: categorizeChannels(stored.channels) }
        setPlaylist(categorized)
        try {
          const last = JSON.parse(localStorage.getItem(LAST_LIVE_STORAGE_KEY) || 'null')
          if (last?.playlistId === categorized.id && typeof last.channelId === 'string') {
            const restored = collapseChannelVariants(categorized.channels).find((channel) =>
              channel.id === last.channelId || channel.variants?.some((variant) => variant.id === last.channelId))
            if (restored) {
              setSelectedChannel(restored)
              setContentMode('live')
            }
          }
        } catch { /* Ignore invalid or unavailable saved preferences. */ }
        await savePlaylist(categorized).catch(() => undefined)
        const connection = categorized.xtream || inferXtreamConnection(categorized.channels)
        if (connection && !categorized.media?.length) {
          void loadMediaCatalog(connection).then(async (media) => {
            const enriched = { ...categorized, xtream: connection, media }
            setPlaylist(enriched)
            await savePlaylist(enriched).catch(() => undefined)
          }).catch(() => undefined)
        }
      }
      setReady(true)
    })
  }, [])

  useEffect(() => {
    // Wait for playlist hydration before updating the saved selection.
    if (!ready) return
    try {
      const belongsToPlaylist = playlist?.channels.some((channel) =>
        channel.id === selectedChannel?.id || channel.variants?.some((variant) => variant.id === selectedChannel?.id))
      if (playlist && selectedChannel && belongsToPlaylist && (!selectedChannel.kind || selectedChannel.kind === 'live')) {
        localStorage.setItem(LAST_LIVE_STORAGE_KEY, JSON.stringify({ playlistId: playlist.id, channelId: selectedChannel.id }))
      } else {
        localStorage.removeItem(LAST_LIVE_STORAGE_KEY)
      }
    } catch { /* Storage may be unavailable. */ }
  }, [ready, playlist, selectedChannel])

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const connection = playlist?.xtream || inferXtreamConnection(playlist?.channels || [])
    const streamId = selectedChannel ? channelStreamId(selectedChannel) : ''
    if (contentMode !== 'live' || !connection || !streamId) { setEpgPrograms([]); setEpgStatus('idle'); return }
    let cancelled = false
    setEpgLoading(true)
    setEpgStatus('loading')
    const load = async (action: string, extra: Record<string, string>) => {
      const response = await fetchXtream(connection, action, { stream_id: streamId, ...extra })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as { epg_listings?: EpgListing[] }
      return parseEpgListings(data?.epg_listings)
    }
    ;(async () => {
      try {
        // 1) guia curto; 2) muitos painéis só preenchem o guia completo do dia.
        let programs = await load('get_short_epg', { limit: '12' }).catch(() => [] as EpgProgram[])
        if (!programs.length) programs = await load('get_simple_data_table', {})
        if (cancelled) return
        setEpgPrograms(programs.slice(0, 12))
        // tvgId === '' significa que o IPTV informou que não há guia associado ao canal.
        setEpgStatus(programs.length ? 'ok' : selectedChannel?.tvgId === '' ? 'no-guide' : 'empty')
      } catch {
        if (!cancelled) { setEpgPrograms([]); setEpgStatus('error') }
      } finally {
        if (!cancelled) setEpgLoading(false)
      }
    })()
    // Recarrega a cada 10 minutos para a grade não ficar velha.
    const refresh = window.setTimeout(() => setEpgReload((value) => value + 1), 10 * 60 * 1000)
    return () => { cancelled = true; window.clearTimeout(refresh) }
  }, [selectedChannel?.url, contentMode, playlist?.xtream, epgReload])

  const favoriteKeys = useMemo(() => new Set(favoriteChannels.map(canonicalChannelKey)), [favoriteChannels])
  const favoritePlaylistChannels = useMemo(() => playlist?.channels.filter((channel) => favoriteKeys.has(canonicalChannelKey(channel))) ?? [], [playlist, favoriteKeys])
  const regularPlaylistChannels = useMemo(() => playlist?.channels.filter((channel) => !isAdultChannel(channel)) ?? [], [playlist])
  const adultPlaylistChannels = useMemo(() => playlist?.channels.filter(isAdultChannel) ?? [], [playlist])
  const groupName = (channel: Channel) => categoryStyle === 'provider' ? channel.sourceGroup || channel.group : channel.group
  const groups = useMemo(() => Array.from(new Set(regularPlaylistChannels.map(groupName).filter(Boolean))).sort(categoryStyle === 'smart' ? compareCategories : (a, b) => Number(isForeignGroup(a)) - Number(isForeignGroup(b)) || a.localeCompare(b, 'pt-BR')), [regularPlaylistChannels, categoryStyle])
  const subgroups = useMemo(() => selectedGroup === 'Todos' || selectedGroup === 'Recomendados' || selectedGroup === 'Recentes' || selectedGroup === 'Favoritos'
    ? []
    : categoryStyle === 'provider' ? [] : Array.from(new Set(regularPlaylistChannels.filter((channel) => channel.group === selectedGroup).map((channel) => channel.subgroup).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
  [regularPlaylistChannels, selectedGroup, categoryStyle])
  // Filtra categoria/subcategoria nos canais originais e só depois junta as
  // versões (HD/FHD), para que nenhum canal suma da categoria a que pertence.
  const filteredRegularChannels = useMemo(() => collapseChannelVariants(regularPlaylistChannels.filter((channel) => {
    if ((selectedGroup === 'Todos' || selectedGroup === 'Recomendados') && !query.trim() && channel.group === 'Internacionais') return false
    const groupMatch = selectedGroup === 'Todos' || selectedGroup === 'Recomendados' || selectedGroup === 'Recentes' || selectedGroup === 'Favoritos' || selectedGroup === '+18' || groupName(channel) === selectedGroup
    const subgroupMatch = selectedSubgroup === 'Todos' || channel.subgroup === selectedSubgroup
    return groupMatch && subgroupMatch
  })).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(a.group === 'Internacionais') - Number(b.group === 'Internacionais') || compareChannelNames(a, b)), [regularPlaylistChannels, query, selectedGroup, selectedSubgroup, categoryStyle])
  const recentCollapsed = useMemo(() => collapseChannelVariants(recentChannels).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase())), [recentChannels, query])
  const favoriteCollapsed = useMemo(() => collapseChannelVariants(favoritePlaylistChannels.filter((channel) => !isAdultChannel(channel))).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase())).sort(compareChannelNames), [favoritePlaylistChannels, query])
  const adultCollapsed = useMemo(() => collapseChannelVariants(adultPlaylistChannels).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase())).sort(compareChannelNames), [adultPlaylistChannels, query])
  // Home feed (YouTube-style): every regular channel plus unfiltered favorites/recents.
  const homeChannels = useMemo(() => collapseChannelVariants(regularPlaylistChannels).sort(compareChannelNames), [regularPlaylistChannels])
  const homeFavorites = useMemo(() => collapseChannelVariants(favoritePlaylistChannels.filter((channel) => !isAdultChannel(channel))).sort(compareChannelNames), [favoritePlaylistChannels])
  useEffect(() => {
    if (!groupPickerOpen) return
    const close = (event: PointerEvent) => { if (!groupPickerRef.current?.contains(event.target as Node)) setGroupPickerOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setGroupPickerOpen(false) }
    document.addEventListener('pointerdown', close, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', close, true); document.removeEventListener('keydown', onKey) }
  }, [groupPickerOpen])
  useEffect(() => {
    if (contentMode === 'live' && selectedChannel && autoRecommendRef.current && selectedGroup === 'Todos') setSelectedGroup('Recomendados')
  }, [selectedChannel?.id, contentMode])
  useEffect(() => { setChannelLimit(120) }, [selectedGroup, selectedSubgroup, query, categoryStyle, contentMode])
  useEffect(() => { setMediaLimit(120) }, [selectedMediaCategory, query, contentMode])
  const homeRecents = useMemo(() => collapseChannelVariants(recentChannels.filter((channel) => !isAdultChannel(channel))), [recentChannels])
  // "A seguir": channels similar to the one being watched (same brand, then same kind).
  const recommendations = useMemo(() => selectedChannel && (!selectedChannel.kind || selectedChannel.kind === 'live') ? recommendChannels(selectedChannel, homeChannels) : null, [selectedChannel?.id, homeChannels])
  const recommendedChannels = useMemo(() => {
    if (!recommendations) return null
    const list = [...recommendations.sameBrand, ...recommendations.related]
    const key = query.trim().toLowerCase()
    return key ? list.filter((channel) => channel.name.toLowerCase().includes(key)) : list
  }, [recommendations, query])
  const showingRecommendations = selectedGroup === 'Recomendados' && recommendedChannels !== null
  const channels = showingRecommendations ? recommendedChannels : selectedGroup === 'Recentes' ? recentCollapsed : selectedGroup === 'Favoritos' ? favoriteCollapsed : selectedGroup === '+18' ? adultCollapsed : filteredRegularChannels
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const channel of regularPlaylistChannels) { const name = groupName(channel); counts.set(name, (counts.get(name) || 0) + 1) }
    return counts
  }, [regularPlaylistChannels, categoryStyle])
  const groupKey = (group: string) => `${categoryStyle}::${group}`
  const categoryFilter = (group: string) => normalizeChannelKey(group).includes(normalizeChannelKey(categoryQuery))
  const favoriteGroupList = groups.filter((group) => favoriteGroups.includes(groupKey(group)))
  const visibleGroups = groups.filter(categoryFilter)
  const isFavoriteChannel = (channel: Channel) => favoriteKeys.has(canonicalChannelKey(channel))
  const isActiveChannel = (channel: Channel) => mosaicActive
    ? mosaicChannels.some((item) => item.id === channel.id || item.url === channel.url)
    : selectedChannel?.url === channel.url
  const mediaItems = useMemo(() => (playlist?.media || []).filter((item) => item.kind === contentMode), [playlist?.media, contentMode])
  const mediaCategories = useMemo(() => Array.from(new Set(mediaItems.map((item) => item.category))).sort((a, b) => a.localeCompare(b, 'pt-BR')), [mediaItems])
  const filteredMedia = useMemo(() => mediaItems.filter((item) => (selectedMediaCategory === 'Todos' || item.category === selectedMediaCategory) && item.name.toLowerCase().includes(query.toLowerCase())), [mediaItems, selectedMediaCategory, query])

  function addRecent(channel: Channel) {
    setRecentChannels((current) => {
      const next = [channel, ...current.filter((item) => canonicalChannelKey(item) !== canonicalChannelKey(channel))].slice(0, MAX_RECENT_CHANNELS)
      writeStoredChannels(RECENT_STORAGE_KEY, next, MAX_RECENT_CHANNELS); return next
    })
  }
  function removeRecent(channel: Channel) {
    setRecentChannels((current) => { const next = current.filter((item) => canonicalChannelKey(item) !== canonicalChannelKey(channel)); writeStoredChannels(RECENT_STORAGE_KEY, next, MAX_RECENT_CHANNELS); return next })
  }
  function toggleFavoriteGroup(group: string) {
    const key = groupKey(group)
    setFavoriteGroups((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
      try { localStorage.setItem(FAVORITE_GROUPS_STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }
  function updateMosaic(next: Channel[]) { setMosaicChannels(next); writeStoredChannels(MOSAIC_STORAGE_KEY, next, MOSAIC_LIMIT) }
  function flashMosaicNotice(message: string) { setMosaicNotice(message); window.setTimeout(() => setMosaicNotice(null), 3200) }
  function changeMosaicLayout(next: MosaicLayout) {
    setMosaicLayout(next)
    const capacity = layoutCapacity(next)
    if (mosaicChannels.length > capacity) {
      const removed = mosaicChannels.slice(capacity)
      updateMosaic(mosaicChannels.slice(0, capacity))
      flashMosaicNotice(`${removed.map((item) => item.name).join(', ')} ${removed.length > 1 ? 'saíram' : 'saiu'} do mosaico para caber no layout.`)
    }
  }
  function removeFromMosaic(channel: Channel) { updateMosaic(mosaicChannels.filter((item) => item.id !== channel.id)) }
  function toggleMosaic() {
    if (mosaicMode === '1') {
      setMosaicMode('0')
      if (mosaicChannels[0]) setSelectedChannel(mosaicChannels[0])
      return
    }
    if (!mosaicChannels.length && selectedChannel && (!selectedChannel.kind || selectedChannel.kind === 'live')) updateMosaic([selectedChannel])
    setMosaicMode('1')
  }
  function selectChannel(channel: Channel) {
    if (mosaicActive && (!channel.kind || channel.kind === 'live')) {
      if (mosaicChannels.some((item) => item.id === channel.id || item.url === channel.url)) { removeFromMosaic(channel); setSidebarOpen(false); return }
      if (mosaicChannels.length >= mosaicCapacity) { flashMosaicNotice(`O layout “${layoutLabel(mosaicLayout)}” comporta ${mosaicCapacity} canais. Remova um ou escolha outro layout.`); return }
      updateMosaic([...mosaicChannels, channel])
      addRecent(channel)
      setSidebarOpen(false)
      return
    }
    setSelectedChannel(channel)
    addRecent(channel)
    setSidebarOpen(false)
  }
  function toggleFavorite(channel: Channel) { const key = canonicalChannelKey(channel); setFavoriteChannels((current) => { const exists = current.some((item) => canonicalChannelKey(item) === key); const next = exists ? current.filter((item) => canonicalChannelKey(item) !== key) : [channel, ...current]; writeStoredChannels(FAVORITES_STORAGE_KEY, next); return next }) }
  function clearRecents() { setRecentChannels([]); try { localStorage.removeItem(RECENT_STORAGE_KEY) } catch {}; if (selectedGroup === 'Recentes') setSelectedGroup('Todos') }
  function selectGroup(group: string) { autoRecommendRef.current = group === 'Recomendados'; setSelectedGroup(group); setSelectedSubgroup('Todos'); setSidebarOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  function selectContentMode(nextMode: 'home' | 'live' | 'movie' | 'series') { setContentMode(nextMode); setSelectedMediaCategory('Todos'); setSelectedSeries(null); setSidebarOpen(false) }
  async function openLibrary(nextMode: 'live' | 'movie' | 'series') {
    const labels = { live: 'TV ao vivo', movie: 'filmes', series: 'séries' }
    setLibraryLoading(`Carregando ${labels[nextMode]}...`)
    await new Promise((resolve) => setTimeout(resolve, 450))
    selectContentMode(nextMode)
    setLibraryLoading(null)
  }
  function playMovie(item: MediaItem) { if (item.streamUrl) selectChannel({ kind: 'movie', id: item.id, name: item.name, url: item.streamUrl, group: 'Filmes', subgroup: item.category, logo: item.poster }) }
  async function openSeries(item: MediaItem) {
    const connection = playlist?.xtream || inferXtreamConnection(playlist?.channels || [])
    if (!connection || !item.seriesId) return
    setSelectedSeries(item); setSeriesEpisodes([]); setSeriesLoading(true)
    try {
      const response = await fetchXtream(connection, 'get_series_info', { series_id: item.seriesId })
      if (!response.ok) throw new Error('Não foi possível carregar os episódios.')
      const data = await response.json() as { episodes?: Record<string, Array<{ id?: string | number; episode_num?: number; title?: string; container_extension?: string; info?: { movie_image?: string } }>> }
      const episodes = Object.entries(data.episodes || {}).flatMap(([season, items]) => items.map((episode, index) => ({
        kind: 'series' as const,
        id: `episode-${item.seriesId}-${episode.id || `${season}-${index}`}`,
        name: episode.title || `${item.name} · T${season} E${episode.episode_num || index + 1}`,
        url: `${connection.server}/series/${encodeURIComponent(connection.username)}/${encodeURIComponent(connection.password)}/${episode.id}.${String(episode.container_extension || 'mp4').replace(/^\./, '')}`,
        group: 'Séries', subgroup: `${item.name} · Temporada ${season}`, logo: episode.info?.movie_image || item.poster,
      })))
      setSeriesEpisodes(episodes)
    } catch { setSeriesEpisodes([]) } finally { setSeriesLoading(false) }
  }
  function toggleNav() {
    if (window.matchMedia('(max-width: 800px)').matches) { setSidebarOpen((value) => !value); return }
    setNavCollapsed((value) => !value)
  }
  function toggleTheater() { setTheaterMode((current) => { const next = !current; try { localStorage.setItem(THEATER_STORAGE_KEY, next ? '1' : '0') } catch {}; return next }) }
  function exportM3u() {
    if (!playlist?.channels.length) return
    const connection = playlist.xtream || inferXtreamConnection(playlist.channels)
    if (connection) {
      const link = document.createElement('a')
      link.href = `/api/export?server=${encodeURIComponent(connection.server)}&username=${encodeURIComponent(connection.username)}&password=${encodeURIComponent(connection.password)}`
      link.download = 'streamhub-completo.m3u'
      link.click()
      return
    }
    const escapeAttribute = (value: string) => value.replace(/"/g, "'")
    const lines = ['#EXTM3U', ...playlist.channels.flatMap((channel) => {
      const attributes = [
        channel.tvgId ? `tvg-id="${escapeAttribute(channel.tvgId)}"` : '',
        channel.tvgName ? `tvg-name="${escapeAttribute(channel.tvgName)}"` : '',
        channel.logo ? `tvg-logo="${escapeAttribute(channel.logo)}"` : '',
        `group-title="${escapeAttribute(channel.sourceGroup || channel.group)}"`,
      ].filter(Boolean).join(' ')
      return [`#EXTINF:-1 ${attributes},${channel.name}`, channel.url]
    })]
    const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${playlist.name.replace(/[^a-z0-9áàâãéêíóôõúç _-]/gi, '').trim() || 'streamhub'}.m3u`
    link.click()
    URL.revokeObjectURL(url)
  }
  async function importFile(file: File) { await importContent(file.name.replace(/\.[^.]+$/, '') || 'Minha playlist', await file.text()) }
  async function importContent(name: string, content: string) { const channels = parseM3U(content); if (!channels.length) return window.alert('Nenhum canal válido foi encontrado nessa playlist.'); const next = createPlaylist(name, channels); await savePlaylist(next); setPlaylist(next); setSelectedGroup('Todos'); setUrlError(null) }
  async function importUrl() { const url = playlistUrl.trim(); if (!url) return; try { new URL(url) } catch { setUrlError('Informe uma URL válida.'); return }; setUrlLoading(true); setUrlError(null); try { const response = await fetch(`/api/playlist?url=${encodeURIComponent(url)}`); if (!response.ok) throw new Error(await response.text()); await importContent(new URL(url).hostname || 'Playlist por URL', await response.text()); setPlaylistUrl('') } catch (cause) { setUrlError(cause instanceof Error ? cause.message : 'Não foi possível importar esta URL.') } finally { setUrlLoading(false) } }
  async function connectXtream() {
    const normalizedServer = normalizeServer(server)
    if (!normalizedServer || !username.trim() || !password.trim()) { setUrlError('Informe servidor, usuário e senha.'); return }
    setUrlLoading(true); setUrlError(null)
    try {
      const connection = { server: normalizedServer, username: username.trim(), password }
      const authResponse = await fetchXtream(connection)
      if (!authResponse.ok) { const data = await authResponse.json().catch(() => null) as { error?: string } | null; throw new Error(data?.error || 'Não foi possível autenticar.') }
      const auth = await authResponse.json() as { user_info?: { auth?: number; status?: string } }
      if (auth.user_info && (auth.user_info.auth === 0 || auth.user_info.status === 'Disabled')) throw new Error('A conta IPTV não está autorizada.')
      const [categoriesResponse, liveResponse] = await Promise.all([fetchXtream(connection, 'get_live_categories'), fetchXtream(connection, 'get_live_streams')]); if (!liveResponse.ok) throw new Error('Não foi possível carregar os canais.')
      const categories = categoriesResponse.ok ? await categoriesResponse.json() as Array<{ category_id?: string | number; category_name?: string }> : []
      const categoryMap = new Map(categories.map((category) => [String(category.category_id), category.category_name || 'Outros']))
      const liveStreams = await liveResponse.json() as Array<{ stream_id?: number | string; name?: string; category_id?: number | string; category_name?: string; stream_icon?: string; container_extension?: string; epg_channel_id?: string | null }>
      const channels: Channel[] = categorizeChannels(liveStreams.filter((stream) => stream.stream_id != null && stream.name).map((stream, index) => { const extension = String(stream.container_extension || 'm3u8').toLowerCase().replace(/^\./, ''); const safeExtension = extension === 'ts' || extension === 'm3u8' ? extension : 'm3u8'; const originalGroup = categoryMap.get(String(stream.category_id)) || stream.category_name || 'Outros'; return { id: `xtream-${stream.stream_id}-${index}`, streamId: String(stream.stream_id), name: stream.name || 'Canal sem nome', url: `${normalizedServer}/live/${encodeURIComponent(username.trim())}/${encodeURIComponent(password)}/${stream.stream_id}.${safeExtension}`, group: originalGroup, sourceGroup: originalGroup, logo: stream.stream_icon || undefined, tvgId: String(stream.epg_channel_id ?? '').trim() } }))
      if (!channels.length) throw new Error('A conta foi conectada, mas nenhum canal ao vivo foi encontrado.')
      const media = await loadMediaCatalog(connection).catch(() => [])
      const next = { ...createPlaylist(`${normalizedServer.replace(/^https?:\/\//, '')} — IPTV`, channels), xtream: connection, media }
      await savePlaylist(next); setPlaylist(next); setSelectedGroup('Todos'); setContentMode('home')
    } catch (cause) { setUrlError(cause instanceof Error ? cause.message : 'Não foi possível conectar ao serviço IPTV.') } finally { setUrlLoading(false) }
  }
  function reset() { void clearPlaylist(); clearRecents(); setFavoriteChannels([]); try { localStorage.removeItem(FAVORITES_STORAGE_KEY) } catch {}; setPlaylist(null); setSelectedChannel(null); setSelectedGroup('Todos'); setQuery('') }
  function logout() { if (window.confirm('Sair e remover a lista salva deste aparelho?')) reset() }

  if (!ready) return <div className="loading-screen">Carregando StreamHub...</div>
  if (!playlist) return <main className="landing"><section className="import-card"><div className="brand-mark"><Tv size={26} /></div><span className="eyebrow">STREAMHUB</span><h1>Sua playlist.<br /><span>Seu player.</span></h1><p>Conecte sua lista M3U ou seus acessos IPTV e organize seus canais em um único player web.</p><div className="connection-tabs"><button className={mode === 'm3u' ? 'connection-tab active' : 'connection-tab'} onClick={() => { setMode('m3u'); setUrlError(null) }}><Link size={15} /> M3U</button><button className={mode === 'xtream' ? 'connection-tab active' : 'connection-tab'} onClick={() => { setMode('xtream'); setUrlError(null) }}><Server size={15} /> Acesso IPTV</button></div>{mode === 'm3u' ? <><button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={18} /> Importar arquivo M3U</button><input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} /><div className="url-import"><div className="url-label"><Link size={15} /> Ou importar por URL</div><div className="url-row"><input value={playlistUrl} onChange={(e) => { setPlaylistUrl(e.target.value); setUrlError(null) }} onKeyDown={(e) => { if (e.key === 'Enter') void importUrl() }} placeholder="http://servidor/playlist.m3u" /><button className="url-button" disabled={urlLoading || !playlistUrl.trim()} onClick={() => void importUrl()}>{urlLoading ? <LoaderCircle className="spin" size={17} /> : 'Importar'}</button></div></div></> : <div className="xtream-form"><label>Servidor IPTV<input value={server} onChange={(e) => { setServer(e.target.value); setUrlError(null) }} placeholder="http://servidor:porta" /></label><label>Usuário<input value={username} onChange={(e) => { setUsername(e.target.value); setUrlError(null) }} placeholder="Seu usuário" autoComplete="username" /></label><label>Senha<div className="password-input"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => { setPassword(e.target.value); setUrlError(null) }} placeholder="Sua senha" autoComplete="current-password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label><button className="primary-button" disabled={urlLoading} onClick={() => void connectXtream()}>{urlLoading ? <LoaderCircle className="spin" size={18} /> : <Server size={18} />} {urlLoading ? 'Conectando...' : 'Conectar IPTV'}</button></div>}{urlError && <div className="url-error">{urlError}</div>}<div className="privacy-note">A conexão é feita sob demanda. Os dados não são enviados para um banco do StreamHub.</div></section></main>

  if (contentMode === 'home') return <>
    <HomeFeed
      channels={homeChannels}
      favorites={homeFavorites}
      recents={homeRecents}
      media={playlist.media || []}
      groups={groups}
      groupCounts={groupCounts}
      groupOf={groupName}
      isFavorite={isFavoriteChannel}
      onPlay={(channel) => { selectContentMode('live'); setSelectedGroup('Todos'); setSelectedSubgroup('Todos'); setMosaicMode('0'); selectChannel(channel); window.scrollTo({ top: 0 }) }}
      onPlayMovie={(item) => { selectContentMode('movie'); playMovie(item); window.scrollTo({ top: 0 }) }}
      onOpenSeries={(item) => { selectContentMode('series'); void openSeries(item); window.scrollTo({ top: 0 }) }}
      onOpenLibrary={(nextMode) => void openLibrary(nextMode)}
      onToggleFavorite={toggleFavorite}
      onClearRecents={clearRecents}
      onRemoveRecent={removeRecent}
      onImport={() => fileRef.current?.click()}
      onExport={exportM3u}
      onSettings={() => setSettingsOpen(true)}
      onLogout={logout}
    />
    <input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} />
    {settingsOpen && <PlaylistSettings playlist={playlist} categoryCount={groups.length} showPassword={showAccessPassword} onTogglePassword={() => setShowAccessPassword((value) => !value)} onClose={() => setSettingsOpen(false)} onExport={exportM3u} />}
    {libraryLoading && <div className="library-loading" role="status" aria-live="polite"><div><LoaderCircle className="spin" size={34} /><strong>{libraryLoading}</strong><span>Preparando sua biblioteca e seus dados de acesso</span></div></div>}
  </>

  const favorite = selectedChannel ? favoriteKeys.has(canonicalChannelKey(selectedChannel)) : false
  const recommendationHeading = (index: number) => {
    if (!showingRecommendations || !recommendations || query.trim()) return null
    if (index === 0 && recommendations.sameBrand.length) return <div className="yt-reco-head">Mais de {recommendations.brand}</div>
    if (index === recommendations.sameBrand.length && recommendations.related.length) return <div className="yt-reco-head">Outros canais de {groupLabel(recommendations.category).toLowerCase()}</div>
    return null
  }
  const renderGroup = (group: string, section: 'fav' | 'all') => {
    const isFav = favoriteGroups.includes(groupKey(group))
    return <div key={`${section}-${group}`} className="nav-row">
      <button className={selectedGroup === group ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup(group)}>{isFav ? <Star size={16} fill="currentColor" className="nav-fav-icon" /> : <Radio size={17} />}<span>{groupLabel(group)}</span><small>{groupCounts.get(group) || 0}</small></button>
      <button className={isFav ? 'nav-fav active' : 'nav-fav'} aria-pressed={isFav} aria-label={isFav ? `Remover ${group} das categorias favoritas` : `Favoritar a categoria ${group}`} title={isFav ? 'Remover dos favoritos' : 'Favoritar categoria'} onClick={() => toggleFavoriteGroup(group)}><Star size={14} fill={isFav ? 'currentColor' : 'none'} /></button>
    </div>
  }
  return <div className={`app-shell yt-skin ${theaterMode ? 'theater-mode' : ''} ${navCollapsed ? 'nav-collapsed' : ''}`}>
    <header className="topbar yt-topbar">
      <div className="yt-topbar-start"><button className="yt-icon-btn" onClick={toggleNav} aria-label="Menu" title="Menu"><Menu size={22} /></button><button className="yt-logo" onClick={() => selectContentMode('home')} title="Início do StreamHub"><span className="yt-logo-mark"><Tv size={16} /></span><span>StreamHub</span></button></div>
      <form className="yt-search" role="search" onSubmit={(event) => { event.preventDefault(); (document.activeElement as HTMLElement | null)?.blur() }}><div className="yt-search-box"><Search size={17} className="yt-search-icon" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={contentMode === 'movie' ? 'Pesquisar filmes' : contentMode === 'series' ? 'Pesquisar séries' : 'Pesquisar canais'} aria-label="Pesquisar" />{query && <button className="yt-search-clear" type="button" aria-label="Limpar pesquisa" onClick={() => setQuery('')}><X size={18} /></button>}</div><button type="submit" className="yt-search-btn" aria-label="Pesquisar" title="Pesquisar"><Search size={20} /></button></form>
      <div className="yt-topbar-end">{contentMode === 'live' && <button className={mosaicActive ? 'yt-icon-btn yt-hide-sm active' : 'yt-icon-btn yt-hide-sm'} onClick={toggleMosaic} title={mosaicActive ? 'Sair do mosaico' : 'Mosaico: assistir até 4 canais'} aria-pressed={mosaicActive}><LayoutDashboard size={18} /></button>}<button className={theaterMode ? 'yt-icon-btn yt-hide-sm active' : 'yt-icon-btn yt-hide-sm'} onClick={toggleTheater} title={theaterMode ? 'Sair do modo teatro' : 'Modo teatro'} aria-pressed={theaterMode}><Theater size={19} /></button><button className="yt-icon-btn yt-hide-sm" onClick={exportM3u} title="Exportar canais em M3U"><Download size={19} /></button><button className="yt-icon-btn yt-hide-sm" onClick={() => fileRef.current?.click()} title="Importar outra playlist"><Upload size={19} /></button><button className="yt-icon-btn" onClick={() => setSettingsOpen(true)} title="Configurações e acesso"><Settings size={19} /></button><button className="yt-icon-btn" onClick={logout} title="Sair e remover a lista deste aparelho"><LogOut size={19} /></button></div>
      <input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} /></header>
    <div className="layout"><main className="content"><section className="watch-area"><div className="player-card"><div ref={playerSlotRef} className="player-slot"><div className={`player-screen ${miniPlayer ? 'mini-player' : ''}`}>{mosaicActive ? <Mosaic channels={mosaicChannels} onRemove={removeFromMosaic} notice={mosaicNotice} layout={mosaicLayout} onLayoutChange={changeMosaicLayout} /> : <ModernPlayer channel={selectedChannel} theaterMode={theaterMode} onToggleTheater={toggleTheater} />}{miniPlayer && <button className="mini-return" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title="Voltar ao player">Expandir</button>}</div></div>{selectedChannel && !mosaicActive && <div className="video-meta"><div className="video-meta-logo">{selectedChannel.logo ? <img src={selectedChannel.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <Tv size={20} />}</div><div className="video-meta-info"><h1>{selectedChannel.name}</h1><p>{groupLabel(selectedChannel.group)} · transmissão ao vivo</p></div><button className={favorite ? 'yt-subscribe active' : 'yt-subscribe'} onClick={() => toggleFavorite(selectedChannel)} title={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} aria-pressed={favorite}><Star size={17} fill={favorite ? 'currentColor' : 'none'} />{favorite ? 'Favoritado' : 'Favoritar'}</button>{contentMode === 'live' && channelPanelHidden && <button className="yt-subscribe active yt-show-panel" onClick={() => setChannelPanelHidden(false)} title="Mostrar lista de canais"><PanelRightOpen size={17} />Mostrar canais</button>}</div>}</div></section>
      {contentMode === 'live' && selectedChannel && !mosaicActive && epgStatus !== 'idle' && (() => {
        const nowSeconds = clock / 1000
        const current = epgPrograms.find((program) => program.start <= nowSeconds && program.end > nowSeconds)
        const upcoming = epgPrograms.filter((program) => program !== current && program.start > nowSeconds).slice(0, 6)
        const progress = current ? Math.min(100, Math.max(0, ((nowSeconds - current.start) / (current.end - current.start)) * 100)) : 0
        const remaining = current ? Math.max(1, Math.round((current.end - nowSeconds) / 60)) : 0
        const emptyMessage = epgStatus === 'no-guide'
          ? 'O seu IPTV não associa um guia de programação a este canal. É comum em canais de eventos, como os de streaming (Disney+, Max, Prime) e pay-per-view.'
          : epgStatus === 'error'
            ? 'Não foi possível consultar a programação agora.'
            : 'O IPTV não enviou programação para este canal. Em canais de eventos (Disney+, Max, Prime, pay-per-view) isso é normal: eles só exibem conteúdo quando há transmissão.'
        return <section className="epg-guide">
          <header className="epg-head"><CalendarDays size={16} /><strong>Programação</strong><span>{new Date(clock).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' })}</span><button onClick={() => setEpgReload((value) => value + 1)} disabled={epgLoading} title="Atualizar programação" aria-label="Atualizar programação"><RefreshCw size={14} className={epgLoading ? 'spin' : ''} /></button></header>
          {epgStatus === 'loading' ? <div className="epg-skeleton"><span /><span /><span /></div>
            : current || upcoming.length ? <div className="epg-body">
              {current ? <article className="epg-now">
                <div className="epg-now-top"><em>AGORA</em><time>{formatClock(current.start)} – {formatClock(current.end)}</time></div>
                <h3>{current.title}</h3>
                {current.description && <p>{current.description}</p>}
                <div className="epg-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Andamento do programa"><span style={{ width: `${progress}%` }} /></div>
                <small>{remaining <= 1 ? 'Termina em instantes' : `Termina em ${formatDuration(remaining)}`}</small>
              </article> : <article className="epg-now epg-now-empty"><em>AGORA</em><h3>Sem informação do programa atual</h3></article>}
              {upcoming.length > 0 && <div className="epg-next">
                <h4>A seguir</h4>
                <ol>{upcoming.map((program) => <li key={program.start} title={program.description || program.title}><time>{formatClock(program.start)}</time><span><strong>{program.title}</strong>{program.description && <small>{program.description}</small>}</span><em>{formatDuration(Math.round((program.end - program.start) / 60))}</em></li>)}</ol>
              </div>}
            </div>
            : <div className={epgStatus === 'error' ? 'epg-empty-state error' : 'epg-empty-state'}><CalendarDays size={20} /><p>{emptyMessage}</p>{epgStatus === 'error' && <button onClick={() => setEpgReload((value) => value + 1)}><RefreshCw size={13} /> Tentar de novo</button>}</div>}
        </section>
      })()}
      {contentMode === 'live' ? channelPanelHidden ? null : <section className="channels-section">
        <div className="section-heading yt-panel-head">
          <div className="yt-panel-picker" ref={groupPickerRef}>
            <button className="yt-panel-title" onClick={() => setGroupPickerOpen((value) => !value)} aria-haspopup="menu" aria-expanded={groupPickerOpen} title="Escolher o que listar">{showingRecommendations ? <>Recomendados <small className="yt-panel-sub">parecidos com {selectedChannel?.name}</small></> : selectedGroup === '+18' ? 'Área +18' : selectedGroup === 'Todos' || selectedGroup === 'Recomendados' ? 'Todos os canais' : groupLabel(selectedGroup)}<ChevronDown size={18} /></button>
            {groupPickerOpen && <div className="yt-panel-menu" role="menu">
              {recommendations && <button role="menuitemradio" aria-checked={selectedGroup === 'Recomendados'} className={selectedGroup === 'Recomendados' ? 'active' : ''} onClick={() => { selectGroup('Recomendados'); setGroupPickerOpen(false) }}><span>Recomendados · parecidos com {selectedChannel?.name}</span></button>}
              {[['Todos', 'Todos os canais', null], ['Recentes', 'Vistos recentemente', recentChannels.length], ['Favoritos', 'Favoritos', favoriteChannels.length]].map(([id, label, count]) => <button key={String(id)} role="menuitemradio" aria-checked={selectedGroup === id} className={selectedGroup === id ? 'active' : ''} onClick={() => { selectGroup(String(id)); setGroupPickerOpen(false) }}><span>{label}</span>{count !== null && <small>{Number(count)}</small>}</button>)}
              <div className="yt-panel-menu-title">Categorias</div>
              {groups.filter((group) => group !== 'Internacionais' && !isForeignGroup(group)).map((group) => <button key={group} role="menuitemradio" aria-checked={selectedGroup === group} className={selectedGroup === group ? 'active' : ''} onClick={() => { selectGroup(group); setGroupPickerOpen(false) }}><span>{groupLabel(group)}</span><small>{(groupCounts.get(group) || 0).toLocaleString('pt-BR')}</small></button>)}
              {groups.some((group) => group === 'Internacionais' || isForeignGroup(group)) && <div className="yt-panel-menu-title">Internacionais</div>}
              {groups.filter((group) => group === 'Internacionais' || isForeignGroup(group)).map((group) => <button key={group} role="menuitemradio" aria-checked={selectedGroup === group} className={selectedGroup === group ? 'active' : ''} onClick={() => { selectGroup(group); setGroupPickerOpen(false) }}><span>🌎 {groupLabel(group)}</span><small>{(groupCounts.get(group) || 0).toLocaleString('pt-BR')}</small></button>)}
            </div>}
          </div>
          <div className="library-actions">{selectedGroup === 'Recentes' && recentChannels.length > 0 && <button className="heading-action" onClick={clearRecents} title="Apagar todo o histórico de canais vistos"><Trash2 size={14} /> Limpar histórico</button>}{mosaicActive && <span className="mosaic-hint"><LayoutDashboard size={13} /> Mosaico {mosaicChannels.length}/{mosaicCapacity} · clique para adicionar</span>}<span className="count">{channels.length.toLocaleString('pt-BR')} canais</span><div className="view-toggle" role="group" aria-label="Visualização dos canais"><button aria-label="Quadrados" title="Quadrados" aria-pressed={channelView === 'grid'} onClick={() => changeChannelView('grid')}><LayoutGrid size={18} /></button><button aria-label="Lista" title="Lista" aria-pressed={channelView === 'list'} onClick={() => changeChannelView('list')}><List size={18} /></button></div><button className="yt-icon-btn yt-panel-close" onClick={() => setChannelPanelHidden(true)} title="Ocultar lista de canais" aria-label="Ocultar lista de canais"><X size={20} /></button></div>
        </div>
        
        {subgroups.length > 0 && <div className="subcategory-strip"><button className={selectedSubgroup === 'Todos' ? 'active' : ''} onClick={() => setSelectedSubgroup('Todos')}>Todos</button>{subgroups.map((subgroup) => <button key={subgroup} className={selectedSubgroup === subgroup ? 'active' : ''} onClick={() => setSelectedSubgroup(subgroup)}>{subgroup}</button>)}</div>}
        {channelView === 'list' && channels.length ? <div className="recent-list">{channels.slice(0, channelLimit).map((channel, index) => <Fragment key={channel.id}>{recommendationHeading(index)}<div className={isActiveChannel(channel) ? 'recent-row selected' : 'recent-row'}><button className="recent-main" onClick={() => selectChannel(channel)}><div className="channel-logo-mini">{channel.logo ? <img src={channel.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <Tv size={18} />}</div><div><strong>{channel.name}</strong><span>{groupLabel(channel.subgroup || channel.group)} · transmissão ao vivo</span></div></button><button className={isFavoriteChannel(channel) ? 'row-fav active' : 'row-fav'} aria-pressed={isFavoriteChannel(channel)} aria-label={isFavoriteChannel(channel) ? `Remover ${channel.name} dos favoritos` : `Favoritar ${channel.name}`} title={isFavoriteChannel(channel) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} onClick={() => toggleFavorite(channel)}><Star size={15} fill={isFavoriteChannel(channel) ? 'currentColor' : 'none'} /></button>{selectedGroup === 'Recentes' && <button className="recent-remove" aria-label={`Remover ${channel.name} dos recentes`} title="Remover dos recentes" onClick={() => removeRecent(channel)}><X size={15} /></button>}</div></Fragment>)}</div> : channels.length ? <><div className={selectedGroup === '+18' ? 'yt-grid yt-channel-grid adult-area' : 'yt-grid yt-channel-grid'}>{channels.slice(0, channelLimit).map((channel, index) => <Fragment key={channel.id}>{recommendationHeading(index)}<ChannelCard channel={channel} group={channel.subgroup || groupName(channel)} favorite={isFavoriteChannel(channel)} active={isActiveChannel(channel)} onPlay={() => selectChannel(channel)} onToggleFavorite={() => toggleFavorite(channel)} extra={selectedGroup === 'Recentes' ? <button className="yt-card-remove" aria-label={`Remover ${channel.name} dos recentes`} title="Remover dos recentes" onClick={() => removeRecent(channel)}><X size={16} /></button> : undefined} /></Fragment>)}</div>{channels.length > channelLimit && <div className="yt-sentinel"><button onClick={() => setChannelLimit((value) => value + 120)}>Carregar mais ({(channels.length - channelLimit).toLocaleString('pt-BR')} restantes)</button></div>}</> : <div className="empty-list">{selectedGroup === '+18' ? 'Nenhum canal +18 encontrado.' : 'Nenhum canal encontrado.'}</div>}
      </section> : <section className="channels-section media-library">
        <div className="section-heading"><div><span className="eyebrow">{contentMode === 'movie' ? 'FILMES' : 'SÉRIES'}</span><h2>{selectedSeries?.name || (contentMode === 'movie' ? 'Catálogo de filmes' : 'Catálogo de séries')}</h2></div><span className="count">{selectedSeries ? seriesEpisodes.length : filteredMedia.length} títulos</span></div>
        {selectedSeries ? <><button className="series-back" onClick={() => { setSelectedSeries(null); setSeriesEpisodes([]) }}><ChevronLeft size={16} /> Voltar às séries</button>{seriesLoading ? <div className="empty-list"><LoaderCircle className="spin" size={22} /> Carregando episódios...</div> : seriesEpisodes.length ? <div className="episode-list">{seriesEpisodes.map((episode) => <button key={episode.id} onClick={() => selectChannel(episode)}><Play size={15} /><span><strong>{episode.name}</strong><small>{episode.subgroup}</small></span></button>)}</div> : <div className="empty-list">Nenhum episódio encontrado.</div>}</> : <>{mediaCategories.length > 1 && <div className="subcategory-strip media-categories"><button className={selectedMediaCategory === 'Todos' ? 'active' : ''} onClick={() => setSelectedMediaCategory('Todos')}>Todos</button>{mediaCategories.map((category) => <button key={category} className={selectedMediaCategory === category ? 'active' : ''} onClick={() => setSelectedMediaCategory(category)}>{category}</button>)}</div>}<div className="yt-grid yt-media-grid">{filteredMedia.slice(0, mediaLimit).map((item) => <MediaCard key={item.id} item={item} onOpen={() => item.kind === 'movie' ? playMovie(item) : void openSeries(item)} />)}</div>{filteredMedia.length > mediaLimit && <div className="yt-sentinel"><button onClick={() => setMediaLimit((value) => value + 120)}>Carregar mais ({(filteredMedia.length - mediaLimit).toLocaleString('pt-BR')} restantes)</button></div>}{!filteredMedia.length && <div className="empty-list">Nenhum título encontrado.</div>}</>}
      </section>}
    </main><aside className={sidebarOpen ? 'sidebar open' : 'sidebar'}>
      <div className="yt-side-main">
        <button className="yt-nav" onClick={() => selectContentMode('home')}><Home size={20} /><span className="yt-nav-label">Início</span></button>
        <button className={contentMode === 'live' ? 'yt-nav active' : 'yt-nav'} onClick={() => selectContentMode('live')}><Radio size={20} /><span className="yt-nav-label">TV ao vivo</span></button>
        {playlist.media?.some((item) => item.kind === 'movie') && <button className={contentMode === 'movie' ? 'yt-nav active' : 'yt-nav'} onClick={() => selectContentMode('movie')}><Film size={20} /><span className="yt-nav-label">Filmes</span></button>}
        {playlist.media?.some((item) => item.kind === 'series') && <button className={contentMode === 'series' ? 'yt-nav active' : 'yt-nav'} onClick={() => selectContentMode('series')}><Clapperboard size={20} /><span className="yt-nav-label">Séries</span></button>}
      </div>
      <div className="playlist-title"><strong>{playlist.name}</strong><span>{playlist.channels.length.toLocaleString('pt-BR')} canais · {playlist.media?.length || 0} títulos</span></div>
      <nav>
        {contentMode === 'live' && <><button className={selectedGroup === 'Todos' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Todos')}><Radio size={18} /><span>Todos os canais</span></button><button className={selectedGroup === 'Recentes' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Recentes')}><Clock3 size={18} /><span>Recentes</span>{recentChannels.length > 0 && <small>{recentChannels.length}</small>}</button><button className={selectedGroup === 'Favoritos' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Favoritos')}><Star size={18} /><span>Favoritos</span>{favoriteChannels.length > 0 && <small>{favoriteChannels.length}</small>}</button><div className="nav-divider" /><div className="sidebar-category-mode" role="group" aria-label="Organização das categorias"><button className={categoryStyle === 'smart' ? 'active' : ''} aria-pressed={categoryStyle === 'smart'} onClick={() => changeCategoryStyle('smart')}>Inteligente</button><button className={categoryStyle === 'provider' ? 'active' : ''} aria-pressed={categoryStyle === 'provider'} onClick={() => changeCategoryStyle('provider')}>Lista IPTV</button></div><div className="category-search"><Search size={14} /><input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="Buscar categoria" aria-label="Buscar categoria" />{categoryQuery && <button type="button" aria-label="Limpar busca de categoria" onClick={() => setCategoryQuery('')}><X size={13} /></button>}</div>{favoriteGroupList.filter(categoryFilter).length > 0 && <><div className="nav-heading">CATEGORIAS FAVORITAS</div>{favoriteGroupList.filter(categoryFilter).map((group) => renderGroup(group, 'fav'))}<div className="nav-divider" /></>}<div className="nav-heading">{categoryStyle === 'smart' ? 'CATEGORIAS INTELIGENTES' : 'CATEGORIAS DO IPTV'}</div>{visibleGroups.filter((group) => group !== 'Internacionais' && !isForeignGroup(group)).map((group) => renderGroup(group, 'all'))}{visibleGroups.some((group) => group === 'Internacionais' || isForeignGroup(group)) && <><div className="nav-divider" /><div className="nav-heading">INTERNACIONAIS</div>{visibleGroups.filter((group) => group === 'Internacionais' || isForeignGroup(group)).map((group) => renderGroup(group, 'all'))}</>}{visibleGroups.length === 0 && <div className="nav-empty">Nenhuma categoria com “{categoryQuery}”.</div>}{adultCollapsed.length > 0 && <><div className="nav-divider" /><button className={selectedGroup === '+18' ? 'nav-item active adult-nav-item' : 'nav-item adult-nav-item'} onClick={() => selectGroup('+18')}><span className="adult-nav-icon">+18</span><span>Área +18</span></button></>}</>}
        {(contentMode === 'movie' || contentMode === 'series') && <><button className="nav-item" onClick={() => selectContentMode(contentMode === 'movie' ? 'live' : 'movie')}>{contentMode === 'movie' ? <Radio size={18} /> : <Film size={18} />}<span>{contentMode === 'movie' ? 'TV ao vivo' : 'Filmes'}</span></button><button className="nav-item" onClick={() => selectContentMode(contentMode === 'series' ? 'live' : 'series')}>{contentMode === 'series' ? <Radio size={18} /> : <Clapperboard size={18} />}<span>{contentMode === 'series' ? 'TV ao vivo' : 'Séries'}</span></button><div className="nav-divider" /><div className="nav-heading">CATEGORIAS</div><button className={selectedMediaCategory === 'Todos' ? 'nav-item active' : 'nav-item'} onClick={() => setSelectedMediaCategory('Todos')}><LayoutGrid size={17} /><span>Todos</span></button>{mediaCategories.map((category) => <button key={category} className={selectedMediaCategory === category ? 'nav-item active' : 'nav-item'} onClick={() => { setSelectedMediaCategory(category); setSelectedSeries(null); setSidebarOpen(false) }}><Film size={17} /><span>{category}</span></button>)}</>}
      </nav>
    </aside>{sidebarOpen && <button className="sidebar-overlay" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} />}</div>
    {settingsOpen && <PlaylistSettings playlist={playlist} categoryCount={groups.length} showPassword={showAccessPassword} onTogglePassword={() => setShowAccessPassword((value) => !value)} onClose={() => setSettingsOpen(false)} onExport={exportM3u} />}
  </div>
}
