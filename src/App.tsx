import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Upload, Play, Star, Tv, X, Link, LoaderCircle } from 'lucide-react'
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
  return value.endsWith('.ts') || value.endsWith('.m2ts') || value.includes('/live/')
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
      tsPlayer = mpegts.createPlayer({
        type: 'mpegts',
        isLive: true,
        url: channel.url,
      })
      tsPlayer.attachMediaElement(video)
      tsPlayer.on(mpegts.Events.ERROR, () => {
        setError('Não foi possível reproduzir o stream MPEG-TS. Verifique CORS, codec e disponibilidade da fonte.')
      })
      tsPlayer.load()
      void tsPlayer.play().catch(() => undefined)
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = channel.url
      void video.play().catch(() => undefined)
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: true })
      hls.loadSource(channel.url)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => undefined))
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError('Não foi possível reproduzir este HLS. Verifique CORS e a disponibilidade da fonte.')
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
  const [playlistUrl, setPlaylistUrl] = useState('')
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
    importContent(file.name.replace(/\.[^.]+$/, '') || 'Minha playlist', await file.text())
  }

  function importContent(name: string, content: string) {
    const channels = parseM3U(content)
    if (!channels.length) return window.alert('Nenhum canal válido foi encontrado nessa playlist.')
    const next = createPlaylist(name, channels)
    void savePlaylist(next)
    setPlaylist(next)
    setSelectedGroup('Todos')
    setSelectedChannel(null)
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
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const content = await response.text()
      const name = new URL(url).hostname || 'Playlist por URL'
      const channels = parseM3U(content)
      if (!channels.length) throw new Error('A URL não retornou uma playlist M3U válida.')
      const next = createPlaylist(name, channels)
      await savePlaylist(next)
      setPlaylist(next)
      setSelectedGroup('Todos')
      setSelectedChannel(null)
      setPlaylistUrl('')
    } catch {
      setUrlError('Não foi possível importar esta URL. O servidor pode bloquear requisições do navegador (CORS). Nesse caso, baixe o M3U e importe o arquivo.')
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
        <p>Importe sua lista M3U HLS ou MPEG-TS e organize seus canais em um único player web.</p>
        <button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={18} /> Importar arquivo M3U</button>
        <input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} />
        <div className="url-import">
          <div className="url-label"><Link size={15} /> Ou importar por URL</div>
          <div className="url-row">
            <input value={playlistUrl} onChange={(e) => { setPlaylistUrl(e.target.value); setUrlError(null) }} onKeyDown={(e) => { if (e.key === 'Enter') void importUrl() }} placeholder="https://servidor.exemplo/playlist.m3u" />
            <button className="url-button" disabled={urlLoading || !playlistUrl.trim()} onClick={() => void importUrl()}>{urlLoading ? <LoaderCircle className="spin" size={17} /> : 'Importar'}</button>
          </div>
          {urlError && <div className="url-error">{urlError}</div>}
        </div>
        <div className="privacy-note">Sua playlist é armazenada localmente neste navegador. O StreamHub não hospeda os streams.</div>
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
