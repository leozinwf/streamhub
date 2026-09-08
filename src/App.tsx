import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Upload, Play, Star, Tv, X, Link, LoaderCircle, Server, Eye, EyeOff, Menu, Home, Radio, RefreshCw, Clock3, Trash2, Theater, List, LayoutGrid, Film, Clapperboard, ChevronLeft, CalendarDays, Download, Settings, LogOut } from 'lucide-react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { parseM3U } from './lib/m3u'
import { clearPlaylist, loadPlaylist, savePlaylist } from './lib/storage'
import type { Channel, MediaItem, Playlist, XtreamConnection } from './types'
import ModernPlayer from './components/Player'
import { collapseChannelVariants } from './lib/channelVariants'
import { categorizeChannel, categorizeChannels, compareCategories } from './lib/categorize'

const RECENT_STORAGE_KEY = 'streamhub-recent-channels'
const FAVORITES_STORAGE_KEY = 'streamhub-favorite-channels'
const MAX_RECENT_CHANNELS = 20
const THEATER_STORAGE_KEY = 'streamhub-theater-mode'

function createPlaylist(name: string, channels: Channel[]): Playlist {
  return { id: crypto.randomUUID(), name, channels, importedAt: new Date().toISOString() }
}

function xtreamApiBase(connection: XtreamConnection) {
  return `/api/xtream?server=${encodeURIComponent(connection.server)}&username=${encodeURIComponent(connection.username)}&password=${encodeURIComponent(connection.password)}`
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
  const base = xtreamApiBase(connection)
  const [vodCategoriesResponse, vodResponse, seriesCategoriesResponse, seriesResponse] = await Promise.all([
    fetch(`${base}&action=get_vod_categories`),
    fetch(`${base}&action=get_vod_streams`),
    fetch(`${base}&action=get_series_categories`),
    fetch(`${base}&action=get_series`),
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
  const base = channel.name
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(?:full\s*hd|fhd|uhd|4k|2160p|1080p|720p|576p|480p|sd|hd|h[ ._-]?265|265|hevc)\b/gi, ' ')
    .replace(/[|/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('pt-BR')
  return `${channel.group.toLocaleLowerCase('pt-BR')}::${base}`
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
  const [contentMode, setContentMode] = useState<'home' | 'live' | 'movie' | 'series'>('home')
  const [categoryStyle, setCategoryStyle] = useState<'smart' | 'provider'>('smart')
  const [selectedMediaCategory, setSelectedMediaCategory] = useState('Todos')
  const [selectedSeries, setSelectedSeries] = useState<MediaItem | null>(null)
  const [seriesEpisodes, setSeriesEpisodes] = useState<Channel[]>([])
  const [seriesLoading, setSeriesLoading] = useState(false)
  const [epgPrograms, setEpgPrograms] = useState<EpgProgram[]>([])
  const [epgLoading, setEpgLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [showAccessPassword, setShowAccessPassword] = useState(false)
  const [libraryLoading, setLibraryLoading] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null)
  const [recentChannels, setRecentChannels] = useState<Channel[]>([])
  const [favoriteChannels, setFavoriteChannels] = useState<Channel[]>([])
  const [mode, setMode] = useState<'m3u' | 'xtream'>('m3u')
  const [playlistUrl, setPlaylistUrl] = useState('')
  const [server, setServer] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [urlLoading, setUrlLoading] = useState(false)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [theaterMode, setTheaterMode] = useState(false)
  const [channelView, setChannelView] = useState<'grid' | 'list'>(() => {
    try { return localStorage.getItem('streamhub-channel-view') === 'list' ? 'list' : 'grid' } catch { return 'grid' }
  })
  const [miniPlayer, setMiniPlayer] = useState(false)
  const playerSlotRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const slot = playerSlotRef.current
    if (!slot || !selectedChannel) { setMiniPlayer(false); return }
    const observer = new IntersectionObserver(([entry]) => {
      setMiniPlayer(!entry.isIntersecting && entry.boundingClientRect.top < 0)
    }, { rootMargin: '-64px 0px 0px 0px' })
    observer.observe(slot)
    return () => observer.disconnect()
  }, [ready, playlist !== null, selectedChannel !== null])

  function changeChannelView(view: 'grid' | 'list') {
    setChannelView(view)
    try { localStorage.setItem('streamhub-channel-view', view) } catch {}
  }

  useEffect(() => {
    setRecentChannels(readStoredChannels(RECENT_STORAGE_KEY, MAX_RECENT_CHANNELS).map(categorizeChannel))
    setFavoriteChannels(readStoredChannels(FAVORITES_STORAGE_KEY).map(categorizeChannel))
    try { setTheaterMode(localStorage.getItem(THEATER_STORAGE_KEY) === '1') } catch {}
    void loadPlaylist().then(async (stored) => {
      if (stored) {
        const categorized = { ...stored, channels: categorizeChannels(stored.channels) }
        setPlaylist(categorized)
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
    const connection = playlist?.xtream || inferXtreamConnection(playlist?.channels || [])
    const streamId = selectedChannel ? channelStreamId(selectedChannel) : ''
    if (contentMode !== 'live' || !connection || !streamId) { setEpgPrograms([]); return }
    let cancelled = false
    setEpgLoading(true)
    fetch(`${xtreamApiBase(connection)}&action=get_short_epg&stream_id=${encodeURIComponent(streamId)}&limit=8`)
      .then(async (response) => response.ok ? response.json() : Promise.reject())
      .then((data: { epg_listings?: Array<{ title?: string; description?: string; start_timestamp?: string | number; stop_timestamp?: string | number }> }) => {
        if (cancelled) return
        const programs = (data.epg_listings || []).map((item) => ({
          title: decodeEpgText(item.title) || 'Programa sem título',
          description: decodeEpgText(item.description),
          start: Number(item.start_timestamp || 0),
          end: Number(item.stop_timestamp || 0),
        })).filter((item) => item.end * 1000 >= Date.now()).slice(0, 6)
        setEpgPrograms(programs)
      })
      .catch(() => { if (!cancelled) setEpgPrograms([]) })
      .finally(() => { if (!cancelled) setEpgLoading(false) })
    return () => { cancelled = true }
  }, [selectedChannel?.url, contentMode, playlist?.xtream])

  const favoriteKeys = useMemo(() => new Set(favoriteChannels.map(canonicalChannelKey)), [favoriteChannels])
  const favoritePlaylistChannels = useMemo(() => playlist?.channels.filter((channel) => favoriteKeys.has(canonicalChannelKey(channel))) ?? [], [playlist, favoriteKeys])
  const regularPlaylistChannels = useMemo(() => playlist?.channels.filter((channel) => !isAdultChannel(channel)) ?? [], [playlist])
  const adultPlaylistChannels = useMemo(() => playlist?.channels.filter(isAdultChannel) ?? [], [playlist])
  const groupName = (channel: Channel) => categoryStyle === 'provider' ? channel.sourceGroup || channel.group : channel.group
  const groups = useMemo(() => Array.from(new Set(regularPlaylistChannels.map(groupName).filter(Boolean))).sort(categoryStyle === 'smart' ? compareCategories : (a, b) => a.localeCompare(b, 'pt-BR')), [regularPlaylistChannels, categoryStyle])
  const subgroups = useMemo(() => selectedGroup === 'Todos' || selectedGroup === 'Recentes' || selectedGroup === 'Favoritos'
    ? []
    : categoryStyle === 'provider' ? [] : Array.from(new Set(regularPlaylistChannels.filter((channel) => channel.group === selectedGroup).map((channel) => channel.subgroup).filter((value): value is string => Boolean(value)))).sort((a, b) => a.localeCompare(b, 'pt-BR')),
  [regularPlaylistChannels, selectedGroup, categoryStyle])
  const filteredRegularChannels = useMemo(() => collapseChannelVariants(regularPlaylistChannels).filter((channel) => {
    const groupMatch = selectedGroup === 'Todos' || selectedGroup === 'Recentes' || selectedGroup === 'Favoritos' || selectedGroup === '+18' || groupName(channel) === selectedGroup
    const subgroupMatch = selectedSubgroup === 'Todos' || channel.subgroup === selectedSubgroup
    return groupMatch && subgroupMatch && channel.name.toLowerCase().includes(query.toLowerCase())
  }), [regularPlaylistChannels, query, selectedGroup, selectedSubgroup, categoryStyle])
  const recentCollapsed = useMemo(() => collapseChannelVariants(recentChannels).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase())), [recentChannels, query])
  const favoriteCollapsed = useMemo(() => collapseChannelVariants(favoritePlaylistChannels.filter((channel) => !isAdultChannel(channel))).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase())), [favoritePlaylistChannels, query])
  const adultCollapsed = useMemo(() => collapseChannelVariants(adultPlaylistChannels).filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase())), [adultPlaylistChannels, query])
  const channels = selectedGroup === 'Recentes' ? recentCollapsed : selectedGroup === 'Favoritos' ? favoriteCollapsed : selectedGroup === '+18' ? adultCollapsed : filteredRegularChannels
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
  function selectChannel(channel: Channel) {
    setSelectedChannel(channel)
    addRecent(channel)
    setSidebarOpen(false)
  }
  function toggleFavorite(channel: Channel) { const key = canonicalChannelKey(channel); setFavoriteChannels((current) => { const exists = current.some((item) => canonicalChannelKey(item) === key); const next = exists ? current.filter((item) => canonicalChannelKey(item) !== key) : [channel, ...current]; writeStoredChannels(FAVORITES_STORAGE_KEY, next); return next }) }
  function clearRecents() { setRecentChannels([]); try { localStorage.removeItem(RECENT_STORAGE_KEY) } catch {}; if (selectedGroup === 'Recentes') setSelectedGroup('Todos') }
  function selectGroup(group: string) { setSelectedGroup(group); setSelectedSubgroup('Todos'); setSidebarOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  function selectContentMode(nextMode: 'home' | 'live' | 'movie' | 'series') { setContentMode(nextMode); setSelectedMediaCategory('Todos'); setSelectedSeries(null); setSidebarOpen(false) }
  async function openLibrary(nextMode: 'live' | 'movie' | 'series') {
    const labels = { live: 'TV ao vivo', movie: 'filmes', series: 'séries' }
    setLibraryLoading(`Carregando ${labels[nextMode]}...`)
    await new Promise((resolve) => setTimeout(resolve, 450))
    selectContentMode(nextMode)
    setLibraryLoading(null)
  }
  function playMovie(item: MediaItem) { if (item.streamUrl) selectChannel({ id: item.id, name: item.name, url: item.streamUrl, group: 'Filmes', subgroup: item.category, logo: item.poster }) }
  async function openSeries(item: MediaItem) {
    const connection = playlist?.xtream || inferXtreamConnection(playlist?.channels || [])
    if (!connection || !item.seriesId) return
    setSelectedSeries(item); setSeriesEpisodes([]); setSeriesLoading(true)
    try {
      const response = await fetch(`${xtreamApiBase(connection)}&action=get_series_info&series_id=${encodeURIComponent(item.seriesId)}`)
      if (!response.ok) throw new Error('Não foi possível carregar os episódios.')
      const data = await response.json() as { episodes?: Record<string, Array<{ id?: string | number; episode_num?: number; title?: string; container_extension?: string; info?: { movie_image?: string } }>> }
      const episodes = Object.entries(data.episodes || {}).flatMap(([season, items]) => items.map((episode, index) => ({
        id: `episode-${item.seriesId}-${episode.id || `${season}-${index}`}`,
        name: episode.title || `${item.name} · T${season} E${episode.episode_num || index + 1}`,
        url: `${connection.server}/series/${encodeURIComponent(connection.username)}/${encodeURIComponent(connection.password)}/${episode.id}.${String(episode.container_extension || 'mp4').replace(/^\./, '')}`,
        group: 'Séries', subgroup: `${item.name} · Temporada ${season}`, logo: episode.info?.movie_image || item.poster,
      })))
      setSeriesEpisodes(episodes)
    } catch { setSeriesEpisodes([]) } finally { setSeriesLoading(false) }
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
      const base = `/api/xtream?server=${encodeURIComponent(normalizedServer)}&username=${encodeURIComponent(username.trim())}&password=${encodeURIComponent(password)}`
      const authResponse = await fetch(base)
      if (!authResponse.ok) { const data = await authResponse.json().catch(() => null) as { error?: string } | null; throw new Error(data?.error || 'Não foi possível autenticar.') }
      const auth = await authResponse.json() as { user_info?: { auth?: number; status?: string } }
      if (auth.user_info && (auth.user_info.auth === 0 || auth.user_info.status === 'Disabled')) throw new Error('A conta IPTV não está autorizada.')
      const [categoriesResponse, liveResponse] = await Promise.all([fetch(`${base}&action=get_live_categories`), fetch(`${base}&action=get_live_streams`)]); if (!liveResponse.ok) throw new Error('Não foi possível carregar os canais.')
      const categories = categoriesResponse.ok ? await categoriesResponse.json() as Array<{ category_id?: string | number; category_name?: string }> : []
      const categoryMap = new Map(categories.map((category) => [String(category.category_id), category.category_name || 'Outros']))
      const liveStreams = await liveResponse.json() as Array<{ stream_id?: number | string; name?: string; category_id?: number | string; category_name?: string; stream_icon?: string; container_extension?: string }>
      const channels: Channel[] = categorizeChannels(liveStreams.filter((stream) => stream.stream_id != null && stream.name).map((stream, index) => { const extension = String(stream.container_extension || 'm3u8').toLowerCase().replace(/^\./, ''); const safeExtension = extension === 'ts' || extension === 'm3u8' ? extension : 'm3u8'; const originalGroup = categoryMap.get(String(stream.category_id)) || stream.category_name || 'Outros'; return { id: `xtream-${stream.stream_id}-${index}`, streamId: String(stream.stream_id), name: stream.name || 'Canal sem nome', url: `${normalizedServer}/live/${encodeURIComponent(username.trim())}/${encodeURIComponent(password)}/${stream.stream_id}.${safeExtension}`, group: originalGroup, sourceGroup: originalGroup, logo: stream.stream_icon || undefined } }))
      if (!channels.length) throw new Error('A conta foi conectada, mas nenhum canal ao vivo foi encontrado.')
      const connection = { server: normalizedServer, username: username.trim(), password }
      const media = await loadMediaCatalog(connection).catch(() => [])
      const next = { ...createPlaylist(`${normalizedServer.replace(/^https?:\/\//, '')} — IPTV`, channels), xtream: connection, media }
      await savePlaylist(next); setPlaylist(next); setSelectedGroup('Todos'); setContentMode('home')
    } catch (cause) { setUrlError(cause instanceof Error ? cause.message : 'Não foi possível conectar ao serviço IPTV.') } finally { setUrlLoading(false) }
  }
  function reset() { void clearPlaylist(); clearRecents(); setFavoriteChannels([]); try { localStorage.removeItem(FAVORITES_STORAGE_KEY) } catch {}; setPlaylist(null); setSelectedChannel(null); setSelectedGroup('Todos'); setQuery('') }
  function logout() { if (window.confirm('Sair e remover a lista salva deste aparelho?')) reset() }

  if (!ready) return <div className="loading-screen">Carregando StreamHub...</div>
  if (!playlist) return <main className="landing"><section className="import-card"><div className="brand-mark"><Tv size={26} /></div><span className="eyebrow">STREAMHUB</span><h1>Sua playlist.<br /><span>Seu player.</span></h1><p>Conecte sua lista M3U ou seus acessos IPTV e organize seus canais em um único player web.</p><div className="connection-tabs"><button className={mode === 'm3u' ? 'connection-tab active' : 'connection-tab'} onClick={() => { setMode('m3u'); setUrlError(null) }}><Link size={15} /> M3U</button><button className={mode === 'xtream' ? 'connection-tab active' : 'connection-tab'} onClick={() => { setMode('xtream'); setUrlError(null) }}><Server size={15} /> Acesso IPTV</button></div>{mode === 'm3u' ? <><button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={18} /> Importar arquivo M3U</button><input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} /><div className="url-import"><div className="url-label"><Link size={15} /> Ou importar por URL</div><div className="url-row"><input value={playlistUrl} onChange={(e) => { setPlaylistUrl(e.target.value); setUrlError(null) }} onKeyDown={(e) => { if (e.key === 'Enter') void importUrl() }} placeholder="http://servidor/playlist.m3u" /><button className="url-button" disabled={urlLoading || !playlistUrl.trim()} onClick={() => void importUrl()}>{urlLoading ? <LoaderCircle className="spin" size={17} /> : 'Importar'}</button></div></div></> : <div className="xtream-form"><label>Servidor IPTV<input value={server} onChange={(e) => { setServer(e.target.value); setUrlError(null) }} placeholder="http://servidor:porta" /></label><label>Usuário<input value={username} onChange={(e) => { setUsername(e.target.value); setUrlError(null) }} placeholder="Seu usuário" autoComplete="username" /></label><label>Senha<div className="password-input"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => { setPassword(e.target.value); setUrlError(null) }} placeholder="Sua senha" autoComplete="current-password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label><button className="primary-button" disabled={urlLoading} onClick={() => void connectXtream()}>{urlLoading ? <LoaderCircle className="spin" size={18} /> : <Server size={18} />} {urlLoading ? 'Conectando...' : 'Conectar IPTV'}</button></div>}{urlError && <div className="url-error">{urlError}</div>}<div className="privacy-note">A conexão é feita sob demanda. Os dados não são enviados para um banco do StreamHub.</div></section></main>

  if (contentMode === 'home') return <main className="library-gateway">
    <div className="gateway-brand"><Tv size={23} /><strong>StreamHub</strong></div>
    <div className="gateway-actions"><button onClick={exportM3u} title="Exportar lista completa"><Download size={18} /><span>Exportar</span></button><button onClick={() => setSettingsOpen(true)} title="Informações da lista"><Settings size={18} /><span>Configurações</span></button><button className="logout-button" onClick={logout} title="Sair"><LogOut size={18} /><span>Sair</span></button></div>
    <section className="home-selector"><span className="eyebrow">O QUE VOCÊ QUER ASSISTIR?</span><h1>Escolha uma biblioteca</h1><div><button onClick={() => void openLibrary('live')} disabled={Boolean(libraryLoading)}><Radio size={28} /><strong>TV ao vivo</strong><span>{playlist.channels.length.toLocaleString('pt-BR')} canais</span></button><button onClick={() => void openLibrary('movie')} disabled={Boolean(libraryLoading) || !playlist.media?.some((item) => item.kind === 'movie')}><Film size={28} /><strong>Filmes</strong><span>{playlist.media?.filter((item) => item.kind === 'movie').length || 0} títulos</span></button><button onClick={() => void openLibrary('series')} disabled={Boolean(libraryLoading) || !playlist.media?.some((item) => item.kind === 'series')}><Clapperboard size={28} /><strong>Séries</strong><span>{playlist.media?.filter((item) => item.kind === 'series').length || 0} séries</span></button></div></section>
    {settingsOpen && <PlaylistSettings playlist={playlist} categoryCount={groups.length} showPassword={showAccessPassword} onTogglePassword={() => setShowAccessPassword((value) => !value)} onClose={() => setSettingsOpen(false)} onExport={exportM3u} />}
    {libraryLoading && <div className="library-loading" role="status" aria-live="polite"><div><LoaderCircle className="spin" size={34} /><strong>{libraryLoading}</strong><span>Preparando sua biblioteca e seus dados de acesso</span></div></div>}
  </main>

  const favorite = selectedChannel ? favoriteKeys.has(canonicalChannelKey(selectedChannel)) : false
  return <div className={`app-shell ${theaterMode ? 'theater-mode' : ''}`}>
    <header className="topbar"><button className="mobile-menu" onClick={() => setSidebarOpen((value) => !value)} aria-label="Abrir menu"><Menu size={21} /></button><button className="brand brand-button" onClick={() => selectContentMode('home')} title="Voltar ao início"><Tv size={21} /><span>StreamHub</span></button><div className="search-wrap"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar canais" />{query && <button className="search-clear" type="button" aria-label="Limpar pesquisa" onClick={() => setQuery('')}><X size={15} /></button>}</div><button className="ghost-button home-button" onClick={() => selectContentMode('home')} title="Escolher biblioteca"><Home size={18} /></button><button className="ghost-button settings-button" onClick={() => setSettingsOpen(true)} title="Configurações e acesso"><Settings size={18} /></button><button className={theaterMode ? 'ghost-button active-toggle' : 'ghost-button'} onClick={toggleTheater} title={theaterMode ? 'Sair do modo teatro' : 'Modo teatro'}><Theater size={18} /></button><button className="ghost-button" onClick={exportM3u} title="Exportar canais em M3U"><Download size={18} /></button><button className="ghost-button" onClick={() => fileRef.current?.click()} title="Importar outra playlist"><Upload size={18} /></button><button className="ghost-button" onClick={reset} title="Remover playlist"><X size={18} /></button><input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} /></header>
    <div className="layout"><main className="content"><section className="watch-area"><div className="player-card"><div ref={playerSlotRef} className="player-slot"><div className={`player-screen ${miniPlayer ? 'mini-player' : ''}`}><ModernPlayer channel={selectedChannel} />{miniPlayer && <button className="mini-return" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title="Voltar ao player">Expandir</button>}</div></div>{selectedChannel && <div className="video-meta"><div className="video-meta-logo">{selectedChannel.logo ? <img src={selectedChannel.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <Tv size={20} />}</div><div className="video-meta-info"><h1>{selectedChannel.name}</h1><p>{selectedChannel.group} · transmissão ao vivo</p></div><button className="ghost-button" onClick={() => toggleFavorite(selectedChannel)} title={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}><Star size={19} fill={favorite ? 'currentColor' : 'none'} /></button></div>}</div></section>
      {contentMode === 'live' && selectedChannel && <section className="epg-guide"><div className="epg-title"><CalendarDays size={17} /><strong>Programação</strong></div>{epgLoading ? <span className="epg-empty">Carregando programação...</span> : epgPrograms.length ? <div className="epg-list">{epgPrograms.map((program, index) => <div key={`${program.start}-${index}`} className={index === 0 && program.start * 1000 <= Date.now() ? 'current' : ''}><time>{new Date(program.start * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time><span><strong>{program.title}</strong>{program.description && <small>{program.description}</small>}</span>{index === 0 && program.start * 1000 <= Date.now() && <em>AGORA</em>}</div>)}</div> : <span className="epg-empty">Este canal não forneceu a programação.</span>}</section>}
      {contentMode === 'live' ? <section className="channels-section">
        <div className="section-heading"><div><span className="eyebrow">BIBLIOTECA</span><h2>{selectedGroup === '+18' ? 'Área +18' : selectedGroup === 'Todos' ? 'Todos os canais' : selectedGroup}</h2></div><div className="library-actions"><span className="count">{channels.length} canais</span><div className="view-toggle" role="group" aria-label="Visualização dos canais"><button aria-label="Quadrados" title="Quadrados" aria-pressed={channelView === 'grid'} onClick={() => changeChannelView('grid')}><LayoutGrid size={18} /></button><button aria-label="Lista" title="Lista" aria-pressed={channelView === 'list'} onClick={() => changeChannelView('list')}><List size={18} /></button></div></div></div>
        <div className="category-mode-toggle"><span>Organização:</span><button className={categoryStyle === 'smart' ? 'active' : ''} onClick={() => { setCategoryStyle('smart'); setSelectedGroup('Todos'); setSelectedSubgroup('Todos') }}>Inteligente</button><button className={categoryStyle === 'provider' ? 'active' : ''} onClick={() => { setCategoryStyle('provider'); setSelectedGroup('Todos'); setSelectedSubgroup('Todos') }}>Original do IPTV</button></div>
        {subgroups.length > 0 && <div className="subcategory-strip"><button className={selectedSubgroup === 'Todos' ? 'active' : ''} onClick={() => setSelectedSubgroup('Todos')}>Todos</button>{subgroups.map((subgroup) => <button key={subgroup} className={selectedSubgroup === subgroup ? 'active' : ''} onClick={() => setSelectedSubgroup(subgroup)}>{subgroup}</button>)}</div>}
        {channelView === 'list' && channels.length ? <div className="recent-list">{channels.map((channel) => <div key={channel.id} className={selectedChannel?.url === channel.url ? 'recent-row selected' : 'recent-row'}><button className="recent-main" onClick={() => selectChannel(channel)}><div className="channel-logo-mini">{channel.logo ? <img src={channel.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <Tv size={18} />}</div><div><strong>{channel.name}</strong><span>{channel.subgroup || channel.group} · transmissão ao vivo</span></div></button>{selectedGroup === 'Recentes' && <button className="recent-remove" aria-label={`Remover ${channel.name} dos recentes`} title="Remover dos recentes" onClick={() => removeRecent(channel)}><X size={15} /></button>}</div>)}</div> : channels.length ? <div className={selectedGroup === '+18' ? 'channel-grid adult-area' : 'channel-grid'}>{channels.map((channel) => <button key={channel.id} className={selectedChannel?.url === channel.url ? 'channel-card selected' : 'channel-card'} onClick={() => selectChannel(channel)}><div className="channel-thumb">{channel.logo ? <img src={channel.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <Tv size={42} />}<span className="live-badge">AO VIVO</span><span className="thumb-play"><Play size={15} fill="currentColor" /></span></div><div className="channel-info"><div className="channel-logo-mini">{channel.logo ? <img src={channel.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <Tv size={17} />}</div><div><strong>{channel.name}</strong><span>{channel.subgroup || channel.group} · transmissão ao vivo</span></div></div></button>)}</div> : <div className="empty-list">{selectedGroup === '+18' ? 'Nenhum canal +18 encontrado.' : 'Nenhum canal encontrado.'}</div>}
      </section> : <section className="channels-section media-library">
        <div className="section-heading"><div><span className="eyebrow">{contentMode === 'movie' ? 'FILMES' : 'SÉRIES'}</span><h2>{selectedSeries?.name || (contentMode === 'movie' ? 'Catálogo de filmes' : 'Catálogo de séries')}</h2></div><span className="count">{selectedSeries ? seriesEpisodes.length : filteredMedia.length} títulos</span></div>
        {selectedSeries ? <><button className="series-back" onClick={() => { setSelectedSeries(null); setSeriesEpisodes([]) }}><ChevronLeft size={16} /> Voltar às séries</button>{seriesLoading ? <div className="empty-list"><LoaderCircle className="spin" size={22} /> Carregando episódios...</div> : seriesEpisodes.length ? <div className="episode-list">{seriesEpisodes.map((episode) => <button key={episode.id} onClick={() => selectChannel(episode)}><Play size={15} /><span><strong>{episode.name}</strong><small>{episode.subgroup}</small></span></button>)}</div> : <div className="empty-list">Nenhum episódio encontrado.</div>}</> : <>{mediaCategories.length > 1 && <div className="subcategory-strip media-categories"><button className={selectedMediaCategory === 'Todos' ? 'active' : ''} onClick={() => setSelectedMediaCategory('Todos')}>Todos</button>{mediaCategories.map((category) => <button key={category} className={selectedMediaCategory === category ? 'active' : ''} onClick={() => setSelectedMediaCategory(category)}>{category}</button>)}</div>}<div className="media-grid">{filteredMedia.map((item) => <button key={item.id} className="media-card" onClick={() => item.kind === 'movie' ? playMovie(item) : void openSeries(item)}><div className="media-poster">{item.poster ? <img src={item.poster} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : item.kind === 'movie' ? <Film size={32} /> : <Clapperboard size={32} />}<span className="thumb-play"><Play size={15} fill="currentColor" /></span></div><strong>{item.name}</strong><span>{item.category}</span></button>)}</div>{!filteredMedia.length && <div className="empty-list">Nenhum título encontrado.</div>}</>}
      </section>}
    </main><aside className={sidebarOpen ? 'sidebar open' : 'sidebar'}>
      <div className="playlist-title"><strong>{playlist.name}</strong><span>{playlist.channels.length.toLocaleString('pt-BR')} canais · {playlist.media?.length || 0} títulos</span></div>
      <nav>
        <button className="nav-item" onClick={() => selectContentMode('home')}><Home size={18} /><span>Escolher biblioteca</span></button>
        <button className="nav-item" onClick={exportM3u}><Download size={18} /><span>Exportar M3U</span></button>
        <button className="nav-item" onClick={() => { setSettingsOpen(true); setSidebarOpen(false) }}><Settings size={18} /><span>Configurações e acesso</span></button>
        {contentMode === 'live' && <><button className={selectedGroup === 'Todos' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Todos')}><Radio size={18} /><span>Todos os canais</span></button><button className={selectedGroup === 'Recentes' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Recentes')}><Clock3 size={18} /><span>Recentes</span>{recentChannels.length > 0 && <small>{recentChannels.length}</small>}</button><button className={selectedGroup === 'Favoritos' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Favoritos')}><Star size={18} /><span>Favoritos</span>{favoriteChannels.length > 0 && <small>{favoriteChannels.length}</small>}</button><div className="nav-divider" /><div className="nav-heading">{categoryStyle === 'smart' ? 'CATEGORIAS INTELIGENTES' : 'CATEGORIAS DO IPTV'}</div>{groups.map((group) => <button key={group} className={selectedGroup === group ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup(group)}><Radio size={17} /><span>{group}</span></button>)}{adultCollapsed.length > 0 && <><div className="nav-divider" /><button className={selectedGroup === '+18' ? 'nav-item active adult-nav-item' : 'nav-item adult-nav-item'} onClick={() => selectGroup('+18')}><span className="adult-nav-icon">+18</span><span>Área +18</span></button></>}<div className="nav-divider" /><button className="nav-item" onClick={clearRecents} disabled={!recentChannels.length}><Trash2 size={17} /><span>Limpar recentes</span></button></>}
        {(contentMode === 'movie' || contentMode === 'series') && <><button className="nav-item" onClick={() => selectContentMode(contentMode === 'movie' ? 'live' : 'movie')}>{contentMode === 'movie' ? <Radio size={18} /> : <Film size={18} />}<span>{contentMode === 'movie' ? 'TV ao vivo' : 'Filmes'}</span></button><button className="nav-item" onClick={() => selectContentMode(contentMode === 'series' ? 'live' : 'series')}>{contentMode === 'series' ? <Radio size={18} /> : <Clapperboard size={18} />}<span>{contentMode === 'series' ? 'TV ao vivo' : 'Séries'}</span></button><div className="nav-divider" /><div className="nav-heading">CATEGORIAS</div><button className={selectedMediaCategory === 'Todos' ? 'nav-item active' : 'nav-item'} onClick={() => setSelectedMediaCategory('Todos')}><LayoutGrid size={17} /><span>Todos</span></button>{mediaCategories.map((category) => <button key={category} className={selectedMediaCategory === category ? 'nav-item active' : 'nav-item'} onClick={() => { setSelectedMediaCategory(category); setSelectedSeries(null); setSidebarOpen(false) }}><Film size={17} /><span>{category}</span></button>)}</>}
      </nav>
    </aside>{sidebarOpen && <button className="sidebar-overlay" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} />}</div>
    {settingsOpen && <PlaylistSettings playlist={playlist} categoryCount={groups.length} showPassword={showAccessPassword} onTogglePassword={() => setShowAccessPassword((value) => !value)} onClose={() => setSettingsOpen(false)} onExport={exportM3u} />}
  </div>
}
