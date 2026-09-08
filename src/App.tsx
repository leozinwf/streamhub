import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Upload, Play, Star, Tv, X, Link, LoaderCircle, Server, Eye, EyeOff, Menu, Home, LayoutGrid, Radio, RefreshCw } from 'lucide-react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { parseM3U } from './lib/m3u'
import { clearPlaylist, loadPlaylist, savePlaylist } from './lib/storage'
import type { Channel, Playlist } from './types'

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

function Player({ channel }: { channel: Channel | null }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !channel) return

    setError(null)
    let hls: Hls | null = null
    let tsPlayer: ReturnType<typeof mpegts.createPlayer> | null = null
    const source = proxyStreamUrl(channel.url)

    if (isMpegTs(channel.url) && mpegts.getFeatureList().mseLivePlayback) {
      tsPlayer = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: source })
      tsPlayer.attachMediaElement(video)
      tsPlayer.on(mpegts.Events.ERROR, () => {
        setError('Não foi possível reproduzir este canal. A fonte pode estar indisponível ou exigir um formato diferente.')
      })
      tsPlayer.load()
      void tsPlayer.play().catch(() => undefined)
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 })
      hls.loadSource(source)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => undefined))
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setError('Falha de rede ao carregar o canal. Tente novamente.')
          hls?.startLoad()
        } else {
          setError('Não foi possível reproduzir este HLS. Verifique a disponibilidade da fonte.')
        }
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source
      const onError = () => setError('Não foi possível reproduzir este stream. Verifique a disponibilidade da fonte.')
      video.addEventListener('error', onError)
      void video.play().catch(() => undefined)
      return () => {
        video.removeEventListener('error', onError)
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
    } else {
      setError('Este navegador não oferece suporte ao formato deste stream.')
    }

    return () => {
      hls?.destroy()
      tsPlayer?.destroy()
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [channel, retryKey])

  if (!channel) {
    return (
      <div className="empty-player">
        <div className="empty-player-icon"><Play size={28} /></div>
        <strong>Selecione um canal para assistir</strong>
        <span>Escolha um canal da sua biblioteca abaixo</span>
      </div>
    )
  }

  return (
    <div className="video-wrapper">
      <video ref={videoRef} controls playsInline />
      <div className="now-playing">
        <div><strong>{channel.name}</strong><span>{channel.group}</span></div>
        <small>{isMpegTs(channel.url) ? 'MPEG-TS' : 'HLS'}</small>
      </div>
      {error && (
        <div className="video-error">
          <span>{error}</span>
          <button onClick={() => setRetryKey((value) => value + 1)}><RefreshCw size={14} /> Tentar novamente</button>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [ready, setReady] = useState(false)
  const [selectedGroup, setSelectedGroup] = useState('Todos')
  const [query, setQuery] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null)
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
    void loadPlaylist().then((stored) => { setPlaylist(stored); setReady(true) })
  }, [])

  const groups = useMemo(() => playlist ? ['Todos', ...Array.from(new Set(playlist.channels.map((c) => c.group).filter(Boolean))).sort((a, b) => a.localeCompare(b))] : [], [playlist])
  const channels = useMemo(() => playlist?.channels.filter((channel) => {
    const groupMatch = selectedGroup === 'Todos' || channel.group === selectedGroup
    return groupMatch && channel.name.toLowerCase().includes(query.toLowerCase())
  }) ?? [], [playlist, query, selectedGroup])

  async function importFile(file: File) {
    await importContent(file.name.replace(/\.[^.]+$/, '') || 'Minha playlist', await file.text())
  }

  async function importContent(name: string, content: string) {
    const channels = parseM3U(content)
    if (!channels.length) return window.alert('Nenhum canal válido foi encontrado nessa playlist.')
    const next = createPlaylist(name, channels)
    await savePlaylist(next)
    setPlaylist(next)
    setSelectedGroup('Todos')
    setSelectedChannel(null)
    setUrlError(null)
  }

  async function importUrl() {
    const url = playlistUrl.trim()
    if (!url) return
    try { new URL(url) } catch { setUrlError('Informe uma URL válida.'); return }

    setUrlLoading(true)
    setUrlError(null)
    try {
      const response = await fetch(`/api/playlist?url=${encodeURIComponent(url)}`)
      if (!response.ok) throw new Error(await response.text())
      const content = await response.text()
      await importContent(new URL(url).hostname || 'Playlist por URL', content)
      setPlaylistUrl('')
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : 'Não foi possível importar esta URL.')
    } finally { setUrlLoading(false) }
  }

  async function connectXtream() {
    const normalizedServer = normalizeServer(server)
    if (!normalizedServer || !username.trim() || !password.trim()) {
      setUrlError('Informe servidor, usuário e senha.')
      return
    }

    setUrlLoading(true)
    setUrlError(null)
    try {
      const base = `/api/xtream?server=${encodeURIComponent(normalizedServer)}&username=${encodeURIComponent(username.trim())}&password=${encodeURIComponent(password)}`
      const authResponse = await fetch(base)
      if (!authResponse.ok) {
        const data = await authResponse.json().catch(() => null) as { error?: string } | null
        throw new Error(data?.error || 'Não foi possível autenticar.')
      }

      const auth = await authResponse.json() as { user_info?: { auth?: number; status?: string } }
      if (auth.user_info && (auth.user_info.auth === 0 || auth.user_info.status === 'Disabled')) {
        throw new Error('A conta IPTV não está autorizada.')
      }

      const [categoriesResponse, liveResponse] = await Promise.all([
        fetch(`${base}&action=get_live_categories`),
        fetch(`${base}&action=get_live_streams`),
      ])

      if (!liveResponse.ok) throw new Error('Não foi possível carregar os canais.')

      const categories = categoriesResponse.ok
        ? await categoriesResponse.json() as Array<{ category_id?: string | number; category_name?: string }>
        : []
      const categoryMap = new Map(categories.map((category) => [String(category.category_id), category.category_name || 'Outros']))

      const liveStreams = await liveResponse.json() as Array<{
        stream_id?: number | string
        name?: string
        category_id?: number | string
        category_name?: string
        stream_icon?: string
        container_extension?: string
      }>

      const channels: Channel[] = liveStreams
        .filter((stream) => stream.stream_id != null && stream.name)
        .map((stream, index) => {
          const extension = String(stream.container_extension || 'm3u8').toLowerCase().replace(/^\./, '')
          const safeExtension = extension === 'ts' || extension === 'm3u8' ? extension : 'm3u8'
          return {
            id: `xtream-${stream.stream_id}-${index}`,
            name: stream.name || 'Canal sem nome',
            url: `${normalizedServer}/live/${encodeURIComponent(username.trim())}/${encodeURIComponent(password)}/${stream.stream_id}.${safeExtension}`,
            group: categoryMap.get(String(stream.category_id)) || stream.category_name || 'Outros',
            logo: stream.stream_icon || undefined,
          }
        })

      if (!channels.length) throw new Error('A conta foi conectada, mas nenhum canal ao vivo foi encontrado.')

      const next = createPlaylist(`${normalizedServer.replace(/^https?:\/\//, '')} — IPTV`, channels)
      await savePlaylist(next)
      setPlaylist(next)
      setSelectedGroup('Todos')
      setSelectedChannel(null)
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : 'Não foi possível conectar ao serviço IPTV.')
    } finally { setUrlLoading(false) }
  }

  function selectGroup(group: string) {
    setSelectedGroup(group)
    setSelectedChannel(null)
    setSidebarOpen(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function reset() {
    void clearPlaylist()
    setPlaylist(null)
    setSelectedChannel(null)
    setSelectedGroup('Todos')
    setQuery('')
  }

  if (!ready) return <div className="loading-screen">Carregando StreamHub...</div>

  if (!playlist) return (
    <main className="landing">
      <section className="import-card">
        <div className="brand-mark"><Tv size={26} /></div>
        <span className="eyebrow">STREAMHUB</span>
        <h1>Sua playlist.<br /><span>Seu player.</span></h1>
        <p>Conecte sua lista M3U ou seus acessos IPTV e organize seus canais em um único player web.</p>

        <div className="connection-tabs">
          <button className={mode === 'm3u' ? 'connection-tab active' : 'connection-tab'} onClick={() => { setMode('m3u'); setUrlError(null) }}><Link size={15} /> M3U</button>
          <button className={mode === 'xtream' ? 'connection-tab active' : 'connection-tab'} onClick={() => { setMode('xtream'); setUrlError(null) }}><Server size={15} /> Acesso IPTV</button>
        </div>

        {mode === 'm3u' ? (
          <>
            <button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={18} /> Importar arquivo M3U</button>
            <input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} />
            <div className="url-import">
              <div className="url-label"><Link size={15} /> Ou importar por URL</div>
              <div className="url-row">
                <input value={playlistUrl} onChange={(e) => { setPlaylistUrl(e.target.value); setUrlError(null) }} onKeyDown={(e) => { if (e.key === 'Enter') void importUrl() }} placeholder="http://servidor/playlist.m3u" />
                <button className="url-button" disabled={urlLoading || !playlistUrl.trim()} onClick={() => void importUrl()}>{urlLoading ? <LoaderCircle className="spin" size={17} /> : 'Importar'}</button>
              </div>
            </div>
          </>
        ) : (
          <div className="xtream-form">
            <label>Servidor IPTV<input value={server} onChange={(e) => { setServer(e.target.value); setUrlError(null) }} placeholder="http://servidor:porta" /></label>
            <label>Usuário<input value={username} onChange={(e) => { setUsername(e.target.value); setUrlError(null) }} placeholder="Seu usuário" autoComplete="username" /></label>
            <label>Senha<div className="password-input"><input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => { setPassword(e.target.value); setUrlError(null) }} placeholder="Sua senha" autoComplete="current-password" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label>
            <button className="primary-button" disabled={urlLoading} onClick={() => void connectXtream()}>{urlLoading ? <LoaderCircle className="spin" size={18} /> : <Server size={18} />} {urlLoading ? 'Conectando...' : 'Conectar IPTV'}</button>
          </div>
        )}

        {urlError && <div className="url-error">{urlError}</div>}
        <div className="privacy-note">A conexão é feita sob demanda. Os dados não são enviados para um banco do StreamHub.</div>
      </section>
    </main>
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="mobile-menu" onClick={() => setSidebarOpen((value) => !value)} aria-label="Abrir categorias"><Menu size={21} /></button>
        <div className="brand"><Tv size={21} /> <span>StreamHub</span></div>
        <div className="search-wrap"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar canais" /></div>
        <button className="ghost-button" onClick={() => fileRef.current?.click()} title="Importar outra playlist"><Upload size={18} /></button>
        <button className="ghost-button" onClick={reset} title="Remover playlist"><X size={18} /></button>
        <input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} />
      </header>

      <div className="layout">
        <aside className={sidebarOpen ? 'sidebar open' : 'sidebar'}>
          <div className="playlist-title"><strong>{playlist.name}</strong><span>{playlist.channels.length.toLocaleString('pt-BR')} canais</span></div>
          <nav>
            <button className={selectedGroup === 'Todos' ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup('Todos')}><Home size={18} /><span>Início</span></button>
            <button className={selectedGroup === 'Favoritos' ? 'nav-item active' : 'nav-item'}><Star size={18} /><span>Favoritos</span></button>
            <div className="nav-divider" />
            <div className="nav-heading">CATEGORIAS</div>
            {groups.filter((group) => group !== 'Todos').map((group) => <button key={group} className={selectedGroup === group ? 'nav-item active' : 'nav-item'} onClick={() => selectGroup(group)}><Radio size={16} /><span>{group}</span></button>)}
          </nav>
        </aside>
        {sidebarOpen && <button className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu" />}

        <main className="content">
          <section className="watch-area">
            <div className="player-card"><div className="player-screen"><Player channel={selectedChannel} /></div></div>
            {selectedChannel && (
              <div className="video-meta">
                <div className="video-meta-logo">{selectedChannel.logo ? <img src={selectedChannel.logo} alt="" /> : <Tv size={25} />}</div>
                <div className="video-meta-info"><h1>{selectedChannel.name}</h1><p>{selectedChannel.group} · transmissão ao vivo</p></div>
              </div>
            )}
          </section>

          <div className="category-strip">
            <button className={selectedGroup === 'Todos' ? 'category-chip active' : 'category-chip'} onClick={() => selectGroup('Todos')}><LayoutGrid size={15} /> Todos</button>
            {groups.filter((group) => group !== 'Todos').map((group) => <button key={group} className={selectedGroup === group ? 'category-chip active' : 'category-chip'} onClick={() => selectGroup(group)}>{group}</button>)}
          </div>

          <section className="channels-section">
            <div className="section-heading"><div><span className="eyebrow">BIBLIOTECA</span><h2>{selectedGroup}</h2></div><span className="count">{channels.length.toLocaleString('pt-BR')} canais</span></div>
            <div className="channel-grid">
              {channels.map((channel) => (
                <button className={selectedChannel?.id === channel.id ? 'channel-card selected' : 'channel-card'} key={channel.id} onClick={() => { setSelectedChannel(channel); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
                  <div className="channel-thumb">
                    {channel.logo ? <img src={channel.logo} alt="" loading="lazy" /> : <Tv size={34} />}
                    <span className="live-badge">AO VIVO</span>
                    <span className="thumb-play"><Play size={18} fill="currentColor" /></span>
                  </div>
                  <div className="channel-info"><div className="channel-logo-mini">{channel.logo ? <img src={channel.logo} alt="" loading="lazy" /> : <Tv size={18} />}</div><div><strong>{channel.name}</strong><span>{channel.group}</span></div></div>
                </button>
              ))}
            </div>
            {!channels.length && <div className="empty-list">Nenhum canal corresponde à sua busca.</div>}
          </section>
        </main>
      </div>
    </div>
  )
}
