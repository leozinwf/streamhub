import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Upload, Play, Star, Tv, X, Link, LoaderCircle, Server, Eye, EyeOff } from 'lucide-react'
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

function Player({ channel }: { channel: Channel | null }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !channel) return

    setError(null)
    let hls: Hls | null = null
    let tsPlayer: ReturnType<typeof mpegts.createPlayer> | null = null

    if (isMpegTs(channel.url) && mpegts.getFeatureList().mseLivePlayback) {
      tsPlayer = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: channel.url })
      tsPlayer.attachMediaElement(video)
      tsPlayer.on(mpegts.Events.ERROR, () => {
        setError('Não foi possível reproduzir o MPEG-TS. Verifique CORS, codec e disponibilidade da fonte.')
      })
      tsPlayer.load()
      void tsPlayer.play().catch(() => undefined)
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = channel.url
      video.addEventListener('error', () => setError('Não foi possível reproduzir este stream. Verifique a disponibilidade da fonte.'))
      void video.play().catch(() => undefined)
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true })
      hls.loadSource(channel.url)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => undefined))
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError('Não foi possível reproduzir este HLS. Verifique CORS, HTTPS e disponibilidade da fonte.')
      })
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
  }, [channel])

  if (!channel) return <div className="empty-player"><Play size={30} /><span>Selecione um canal para começar</span></div>

  return (
    <div className="video-wrapper">
      <video ref={videoRef} controls playsInline />
      <div className="now-playing"><span>{channel.name}</span><small>{isMpegTs(channel.url) ? 'MPEG-TS' : 'HLS'}</small></div>
      {error && <div className="video-error">{error}</div>}
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
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadPlaylist().then((stored) => { setPlaylist(stored); setReady(true) })
  }, [])

  const groups = useMemo(() => playlist ? ['Todos', ...Array.from(new Set(playlist.channels.map((c) => c.group))).sort()] : [], [playlist])
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
    try {
      new URL(url)
    } catch {
      setUrlError('Informe uma URL válida.')
      return
    }

    setUrlLoading(true)
    setUrlError(null)
    try {
      const response = await fetch(`/api/playlist?url=${encodeURIComponent(url)}`)
      if (!response.ok) throw new Error(await response.text())
      const content = await response.text()
      const name = new URL(url).hostname || 'Playlist por URL'
      await importContent(name, content)
      setPlaylistUrl('')
    } catch {
      setUrlError('Não foi possível importar esta URL. Verifique o endereço e se o servidor da playlist está disponível.')
    } finally {
      setUrlLoading(false)
    }
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

      const liveResponse = await fetch(`${base}&action=get_live_streams`)
      if (!liveResponse.ok) throw new Error('Não foi possível carregar os canais.')
      const liveStreams = await liveResponse.json() as Array<{
        stream_id?: number | string
        name?: string
        category_name?: string
        stream_icon?: string
      }>

      const channels: Channel[] = liveStreams
        .filter((stream) => stream.stream_id != null && stream.name)
        .map((stream, index) => ({
          id: `xtream-${stream.stream_id}-${index}`,
          name: stream.name || 'Canal sem nome',
          url: `${normalizedServer}/live/${encodeURIComponent(username.trim())}/${encodeURIComponent(password)}/${stream.stream_id}.m3u8`,
          group: stream.category_name || 'TV ao vivo',
          logo: stream.stream_icon || undefined,
        }))

      if (!channels.length) throw new Error('A conta foi conectada, mas nenhum canal ao vivo foi encontrado.')

      const next = createPlaylist(`${normalizedServer.replace(/^https?:\/\//, '')} — IPTV`, channels)
      await savePlaylist(next)
      setPlaylist(next)
      setSelectedGroup('Todos')
      setSelectedChannel(null)
    } catch (error) {
      setUrlError(error instanceof Error ? error.message : 'Não foi possível conectar ao serviço IPTV.')
    } finally {
      setUrlLoading(false)
    }
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
        <div className="privacy-note">As credenciais não são enviadas para um banco do StreamHub. A conexão é feita sob demanda e a playlist fica armazenada localmente neste navegador.</div>
      </section>
    </main>
  )

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><Tv size={20} /> StreamHub</div>
        <div className="search-wrap"><Search size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar canal..." /></div>
        <button className="ghost-button" onClick={() => fileRef.current?.click()} title="Importar outra playlist"><Upload size={18} /></button>
        <button className="ghost-button" onClick={reset} title="Remover playlist"><X size={18} /></button>
        <input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} />
      </header>
      <div className="layout">
        <aside className="sidebar">
          <div className="playlist-title">{playlist.name}<span>{playlist.channels.length} canais</span></div>
          <nav>{groups.map((group) => <button key={group} className={selectedGroup === group ? 'nav-item active' : 'nav-item'} onClick={() => setSelectedGroup(group)}>{group === 'Todos' ? <Tv size={16} /> : <Star size={16} />}<span>{group}</span></button>)}</nav>
        </aside>
        <main className="content">
          <section className="player-card"><div className="player-screen"><Player channel={selectedChannel} /></div></section>
          <section className="channels-section">
            <div className="section-heading"><div><span className="eyebrow">BIBLIOTECA</span><h2>{selectedGroup}</h2></div><span className="count">{channels.length} canais</span></div>
            <div className="channel-grid">{channels.map((channel) => <button className="channel-card" key={channel.id} onClick={() => setSelectedChannel(channel)}><div className="channel-logo">{channel.logo ? <img src={channel.logo} alt="" /> : <Tv size={23} />}</div><div className="channel-info"><strong>{channel.name}</strong><span>{channel.group}</span></div></button>)}</div>
            {!channels.length && <div className="empty-list">Nenhum canal corresponde à sua busca.</div>}
          </section>
        </main>
      </div>
    </div>
  )
}
