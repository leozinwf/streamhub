import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Upload, Play, Star, Tv, X, Link, LoaderCircle, Server, Eye, EyeOff, Menu, Home, Radio, RefreshCw, Clock3, Trash2 } from 'lucide-react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { parseM3U } from './lib/m3u'
import { clearPlaylist, loadPlaylist, savePlaylist } from './lib/storage'
import type { Channel, Playlist } from './types'

const RECENT_STORAGE_KEY = 'streamhub-recent-channels'
const FAVORITES_STORAGE_KEY = 'streamhub-favorite-channels'
const MAX_RECENT_CHANNELS = 20

function createPlaylist(name: string, channels: Channel[]): Playlist {
  return { id: crypto.randomUUID(), name, channels, importedAt: new Date().toISOString() }
}

function isMpegTs(url: string) {
  const value = url.toLowerCase().split('?')[0]
  return value.endsWith('.ts') || value.endsWith('.m2ts')
}

function normalizeServer(value: string) {
  const raw = value.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(raw)) return raw ? `http://${raw}` : ''
  return raw
}

function proxyStreamUrl(url: string) {
  return `/api/stream?url=${encodeURIComponent(url)}`
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

function xtreamTsFallback(url: string) {
  if (!/\/live\//i.test(url) || !/\.m3u8(?:$|\?)/i.test(url)) return null
  return url.replace(/\.m3u8(?=$|\?)/i, '.ts')
}

function Player({ channel }: { channel: Channel | null }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [usingFallback, setUsingFallback] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !channel) return

    setError(null)
    setUsingFallback(false)
    let hls: Hls | null = null
    let tsPlayer: ReturnType<typeof mpegts.createPlayer> | null = null
    let mediaRecoveryAttempts = 0
    let networkRecoveryAttempts = 0
    let disposed = false

    const cleanupVideo = () => {
      video.pause()
      video.removeAttribute('src')
      video.load()
    }

    const startMpegTs = (url: string) => {
      if (disposed || !mpegts.getFeatureList().mseLivePlayback) return false
      try {
        tsPlayer?.destroy()
        tsPlayer = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: proxyStreamUrl(url),
          cors: true,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 8,
          liveBufferLatencyMinRemain: 2,
        } as any)
        tsPlayer.attachMediaElement(video)
        tsPlayer.on(mpegts.Events.ERROR, (_type, detail) => {
          if (!disposed) setError(`Não foi possível reproduzir este canal (${String(detail || 'erro MPEG-TS')}).`)
        })
        tsPlayer.load()
        video.muted = true
        void tsPlayer.play().catch(() => undefined)
        return true
      } catch {
        return false
      }
    }

    const sourceUrl = usingFallback ? xtreamTsFallback(channel.url) || channel.url : channel.url

    if (isMpegTs(sourceUrl)) {
      if (!startMpegTs(sourceUrl)) setError('O navegador não conseguiu iniciar a reprodução MPEG-TS deste canal.')
    } else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 20,
        maxMaxBufferLength: 40,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        manifestLoadingMaxRetry: 4,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 5,
        fragLoadingRetryDelay: 1000,
        appendErrorMaxRetry: 3,
      })

      hls.attachMedia(video)
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        if (!disposed) hls?.loadSource(proxyStreamUrl(sourceUrl))
      })
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (disposed) return
        video.muted = true
        void video.play().catch(() => undefined)
      })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (disposed || !data.fatal) return

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (networkRecoveryAttempts < 2) {
            networkRecoveryAttempts += 1
            hls?.startLoad()
            return
          }

          const fallback = xtreamTsFallback(channel.url)
          if (fallback && !usingFallback) {
            setUsingFallback(true)
            setRetryKey((value) => value + 1)
            return
          }

          setError(`Falha de rede no HLS (${data.details || 'erro de carregamento'}).`)
          return
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (mediaRecoveryAttempts === 0) {
            mediaRecoveryAttempts += 1
            hls?.recoverMediaError()
            return
          }
          if (mediaRecoveryAttempts === 1) {
            mediaRecoveryAttempts += 1
            try { hls?.swapAudioCodec() } catch { /* ignore */ }
            hls?.recoverMediaError()
            return
          }

          const fallback = xtreamTsFallback(channel.url)
          if (fallback && !usingFallback) {
            setUsingFallback(true)
            setRetryKey((value) => value + 1)
            return
          }

          setError(`Falha de mídia no HLS (${data.details || 'formato não suportado'}).`)
          return
        }

        const fallback = xtreamTsFallback(channel.url)
        if (fallback && !usingFallback) {
          setUsingFallback(true)
          setRetryKey((value) => value + 1)
        } else {
          setError(`O HLS não pôde ser reproduzido (${data.details || 'erro desconhecido'}).`)
        }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = proxyStreamUrl(sourceUrl)
      const onLoaded = () => { video.muted = true; void video.play().catch(() => undefined) }
      const onError = () => setError('Não foi possível reproduzir este stream HLS.')
      video.addEventListener('loadedmetadata', onLoaded)
      video.addEventListener('error', onError)
      return () => {
        disposed = true
        video.removeEventListener('loadedmetadata', onLoaded)
        video.removeEventListener('error', onError)
        cleanupVideo()
      }
    } else {
      setError('Este navegador não oferece suporte ao formato deste stream.')
    }

    return () => {
      disposed = true
      hls?.destroy()
      tsPlayer?.destroy()
      cleanupVideo()
    }
  }, [channel, retryKey, usingFallback])

  if (!channel) return <div className="empty-player"><div className="empty-player-icon"><Play size={28} /></div><strong>Selecione um canal para assistir</strong><span>Escolha um canal da sua biblioteca abaixo</span></div>

  return <div className="video-wrapper">
    <video ref={videoRef} controls playsInline preload="auto" />
    <div className="now-playing"><div><strong>{channel.name}</strong><span>{channel.group}</span></div><small>{usingFallback ? 'MPEG-TS' : isMpegTs(channel.url) ? 'MPEG-TS' : 'HLS'}</small></div>
    {error && <div className="video-error"><span>{error}</span><button onClick={() => { setUsingFallback(false); setRetryKey((value) => value + 1) }}><RefreshCw size={14} /> Tentar novamente</button></div>}
  </div>
}

export default function App() {
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [ready, setReady] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState('Todos')
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
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRecentChannels(readStoredChannels(RECENT_STORAGE_KEY, MAX_RECENT_CHANNELS))
    setFavoriteChannels(readStoredChannels(FAVORITES_STORAGE_KEY))
    void loadPlaylist().then((stored) => { setPlaylist(stored); setReady(true) })
  }, [])

  const groups = useMemo(() => playlist ? Array.from(new Set(playlist.channels.map((c) => c.group).filter(Boolean))).sort((a, b) => a.localeCompare(b)) : [], [playlist])
  const filteredChannels = useMemo(() => playlist?.channels.filter((channel) => {
    const groupMatch = selectedGroup === 'Todos' || selectedGroup === 'Recentes' || selectedGroup === 'Favoritos' || channel.group === selectedGroup
    return groupMatch && channel.name.toLowerCase().includes(query.toLowerCase())
  }) ?? [], [playlist, query, selectedGroup])
  const channels = selectedGroup === 'Recentes'
    ? recentChannels.filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase()))
    : selectedGroup === 'Favoritos'
      ? favoriteChannels.filter((channel) => channel.name.toLowerCase().includes(query.toLowerCase()))
      : filteredChannels

  function addRecent(channel: Channel) {
    setRecentChannels((current) => {
      const next = [channel, ...current.filter((item) => item.id !== channel.id)].slice(0, MAX_RECENT_CHANNELS)
      writeStoredChannels(RECENT_STORAGE_KEY, next, MAX_RECENT_CHANNELS)
      return next
    })
  }

  function selectChannel(channel: Channel) {
    setSelectedChannel(channel)
    addRecent(channel)
    setSidebarOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function toggleFavorite(channel: Channel) {
    setFavoriteChannels((current) => {
      const exists = current.some((item) => item.id === channel.id)
      const next = exists ? current.filter((item) => item.id !== channel.id) : [channel, ...current]
      writeStoredChannels(FAVORITES_STORAGE_KEY, next)
      return next
    })
  }

  function clearRecents() {
    setRecentChannels([])
    try { localStorage.removeItem(RECENT_STORAGE_KEY) } catch { /* ignore storage errors */ }
    if (selectedGroup === 'Recentes') setSelectedGroup('Todos')
  }

  async function importFile(file: File) { await importContent(file.name.replace(/\.[^.]+$/, '') || 'Minha playlist', await file.text()) }

  async function importContent(name: string, content: string) {
    const channels = parseM3U(content)
    if (!channels.length) return window.alert('Nenhum canal válido foi encontrado nessa playlist.')
    const next = createPlaylist(name, channels)
    await savePlaylist(next)
    setPlaylist(next); setSelectedGroup('Todos'); setSelectedChannel(null); setUrlError(null)
  }

  async function importUrl() {
    const url = playlistUrl.trim()
    if (!url) return
    try { new URL(url) } catch { setUrlError('Informe uma URL válida.'); return }
    setUrlLoading(true); setUrlError(null)
    try {
      const response = await fetch(`/api/playlist?url=${encodeURIComponent(url)}`)
      if (!response.ok) throw new Error(await response.text())
      await importContent(new URL(url).hostname || 'Playlist por URL', await response.text())
      setPlaylistUrl('')
    } catch (error) { setUrlError(error instanceof Error ? error.message : 'Não foi possível importar esta URL.') }
    finally { setUrlLoading(false) }
  }

  async function connectXtream() {
    const normalizedServer = normalizeServer(server)
    if (!normalizedServer || !username.trim() || !password.trim()) { setUrlError('Informe servidor, usuário e senha.'); return }
    setUrlLoading(true); setUrlError(null)
    try {
      const base = `/api/xtream?server=${encodeURIComponent(normalizedServer)}&username=${encodeURIComponent(username.trim())}&password=${encodeURIComponent(password)}`
      const authResponse = await fetch(base)
      if (!authResponse.ok) {
        const data = await authResponse.json().catch(() => null) as { error?: string } | null
        throw new Error(data?.error || 'Não foi possível autenticar.')
      }
      const auth = await authResponse.json() as { user_info?: { auth?: number; status?: string } }
      if (auth.user_info && (auth.user_info.auth === 0 || auth.user_info.status === 'Disabled')) throw new Error('A conta IPTV não está autorizada.')
      const [categoriesResponse, liveResponse] = await Promise.all([fetch(`${base}&action=get_live_categories`), fetch(`${base}&action=get_live_streams`)])
      if (!liveResponse.ok) throw new Error('Não foi possível carregar os canais.')
      const categories = categoriesResponse.ok ? await categoriesResponse.json() as Array<{ category_id?: string | number; category_name?: string }> : []
      const categoryMap = new Map(categories.map((category) => [String(category.category_id), category.category_name || 'Outros']))
      const liveStreams = await liveResponse.json() as Array<{ stream_id?: number | string; name?: string; category_id?: number | string; category_name?: string; stream_icon?: string; container_extension?: string }>
      const channels: Channel[] = liveStreams.filter((stream) => stream.stream_id != null && stream.name).map((stream, index) => {
        const extension = String(stream.container_extension || 'm3u8').toLowerCase().replace(/^\./, '')
        const safeExtension = extension === 'ts' || extension === 'm3u8' ? extension : 'm3u8'
        return { id: `xtream-${stream.stream_id}-${index}`, name: stream.name || 'Canal sem nome', url: `${normalizedServer}/live/${encodeURIComponent(username.trim())}/${encodeURIComponent(password)}/${stream.stream_id}.${safeExtension}`, group: categoryMap.get(String(stream.category_id)) || stream.category_name || 'Outros', logo: stream.stream_icon || undefined }
      })
      if (!channels.length) throw new Error('A conta foi conectada, mas nenhum canal ao vivo foi encontrado.')
      const next = createPlaylist(`${normalizedServer.replace(/^https?:\/\//, '')} — IPTV`, channels)
      await savePlaylist(next); setPlaylist(next); setSelectedGroup('Todos'); setSelectedChannel(null)
    } catch (error) { setUrlError(error instanceof Error ? error.message : 'Não foi possível conectar ao serviço IPTV.') }
    finally { setUrlLoading(false) }
  }

  function selectGroup(group: string) {
    setSelectedGroup(group); setSelectedChannel(null); setSidebarOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function reset() {
    void clearPlaylist(); clearRecents(); setPlaylist(null); setSelectedChannel(null); setSelectedGroup('Todos'); setQuery('')
  }

  if (!ready) return <div className="loading-screen">Carregando StreamHub...</div>
  if (!playlist) return <main className="landing"><section className="import-card">
    <div className="brand-mark"><Tv size={26} /></div><span className="eyebrow">STREAMHUB</span><h1>Sua playlist.<br /><span>Seu player.</span></h1><p>Conecte sua lista M3U ou seus acessos IPTV e organize seus canais em um único player web.</p>
    <div className="connection-tabs"><button className={mode === 'm3u' ? 'connection-tab active' : 'connection-tab'} onClick={() => { setMode('m3u'); setUrlError(null) }}><Link size={15} /> M3U</button><button className={mode === 'xtream' ? 'connection-tab active' : 'connection-tab'} onClick={() => { setMode('xtream'); setUrlError(null) }}><Server size={15} /> Acesso IPTV</button></div>
    {mode === 'm3u' ? <><button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={18} /> Importar arquivo M3U</button><input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} /><div className="url-import"><div className="url-label"><Link size={15} /> Ou importar por URL</div><div className="url-row"><input value={playlistUrl} onChange={(e) => { setPlaylistUrl(e.target.value); setUrlError(null) }} onKeyDown={(e) => { if (e.key === 'Enter') void importUrl() }} placeholder="http://servidor/playlist.m3u" /><button className="url-button" disabled={urlLoading || !playlistUrl.trim()} onClick={() => void importUrl()}>{urlLoading ? <LoaderCircle className="spin" size={17} /> : 'Importar'}</button></div></div></> : <div className="xtream-form"><label>Servidor IPTV<input value={server} onChange={(e) => { setServer(e.target.value); setUrlError(null) }} placeholder="http://servidor:porta" /></label><label>Usuário<input value={username} onChange={(e) => { setUsername(e.target.value); setUrlError(null) }} placeholder="Seu usuário" autoComplete="username" /></label><label>Senha<div className="password-input"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => { setPassword(e.target.value); setUrlError(null) }} placeholder="Sua senha" autoComplete="current-password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label><button className="primary-button" disabled={urlLoading} onClick={() => void connectXtream()}>{urlLoading ? <LoaderCircle className="spin" size={18} /> : <Server size={18} />} {urlLoading ? 'Conectando...' : 'Conectar IPTV'}</button></div>}
    {urlError && <div className="url-error">{urlError}</div>}<div className="privacy-note">A conexão é feita sob demanda. Os dados não são enviados para um banco do StreamHub.</div>
  </section></main>

  const favorite = selectedChannel ? favoriteChannels.some((item) => item.id === selectedChannel.id) : false

  return <div className="app-shell">
    <header className="topbar"><button className="mobile-menu" onClick={() => setSidebarOpen((value) => !value)} aria-label="Abrir menu"><Menu size={21} /></button><div className="brand"><Tv size={21} /><span>StreamHub</span></div><div className="search-wrap"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar canais" /></div><button className="ghost-button" onClick={() => fileRef.current?.click()} title="Importar outra playlist"><Upload size={18} /></button><button className="ghost-button" onClick={reset} title="Remover playlist"><X size={18} /></button><input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} /></header>
    <div className="layout">
      <main className="content">
        <section className="watch-area"><div className="player-card"><div className="player-screen"><Player channel={selectedChannel} /></div>{selectedChannel && <div className="video-meta"><div className="video-meta-logo">{selectedChannel.logo ? <img src={selectedChannel.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <Tv size={20} />}</div><div className="video-meta-info"><h1>{selectedChannel.name}</h1><p>{selectedChannel.group} · transmissão ao vivo</p></div><button className="ghost-button" onClick={() => toggleFavorite(selectedChannel)} title={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}><Star size={19} fill={favorite ? 'currentColor' : 'none'} /></button></div>}</div></section>
        <div className="category-strip"><button className={selectedGroup === 'Todos' ? 'category-chip active' : 'category-chip'} onClick={() => selectGroup('Todos')}>Todos</button><button className={selectedGroup === 'Recentes' ? 'category-chip active' : 'category-chip'} onClick={() => selectGroup('Recentes')}><Clock3 size={14} /> Recentes</button><button className={selectedGroup === 'Favoritos' ? 'category-chip active' : 'category-chip'} onClick={() => selectGroup('Favoritos')}><Star size={14} /> Favoritos</button>{groups.map((group) => <button key={group} className={selectedGroup === group ? 'category-chip active' : 'category-chip'} onClick={() => selectGroup(group)}>{group}</button>)}</div>
        <section className="channels-section"><div className="section-heading"><div><span className="eyebrow">BIBLIOTECA</span><h2>{selectedGroup === 'Todos' ? 'Todos os canais' : selectedGroup}</h2></div><span className="count">{channels.length} canais</span></div>{channels.length ? <div className="channel-grid">{channels.map((channel) => <button key={channel.id} className={selectedChannel?.id === channel.id ? 'channel-card selected' : 'channel-card'} onClick={() => selectChannel(channel)}><div className="channel-thumb">{channel.logo ? <img src={channel.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <Tv size={42} />}<span className="live-badge">AO VIVO</span><span className="thumb-play"><Play size={15} fill="currentColor" /></span></div><div className="channel-info"><div className="channel-logo-mini">{channel.logo ? <img src={channel.logo} alt="" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : <Tv size={17} />}</div><div><strong>{channel.name}</strong><span>{channel.group} · transmissão ao vivo</span></div></div></button>)}</div> : <div className="empty-list">Nenhum canal encontrado.</div>}</section>
      </main>
      <aside className={sidebarOpen ? 'sidebar open' : 'sidebar'}><div className="playlist-title"><strong>{playlist.name}</strong><span>{playlist.channels.length.toLocaleString('pt-BR')} canais</span></div><nav><button className={selectedGroup === 'Todos' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Todos')}><Home size={18} /><span>Início</span></button><button className={selectedGroup === 'Recentes' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Recentes')}><Clock3 size={18} /><span>Recentes</span>{recentChannels.length > 0 && <small>{recentChannels.length}</small>}</button><button className={selectedGroup === 'Favoritos' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Favoritos')}><Star size={18} /><span>Favoritos</span></button><div className="nav-divider" /><div className="nav-heading">CATEGORIAS</div>{groups.map((group) => <button key={group} className={selectedGroup === group ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup(group)}><Radio size={17} /><span>{group}</span></button>)}<div className="nav-divider" /><button className="nav-item" onClick={clearRecents} disabled={!recentChannels.length}><Trash2 size={17} /><span>Limpar recentes</span></button></nav></aside>
      {sidebarOpen && <button className="sidebar-overlay" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} />}
    </div>
  </div>
}
