import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Upload, Play, Star, Tv, X } from 'lucide-react'
import Hls from 'hls.js'
import { parseM3U } from './lib/m3u'
import { clearPlaylist, loadPlaylist, savePlaylist } from './lib/storage'
import type { Channel, Playlist } from './types'

function createPlaylist(name: string, channels: Channel[]): Playlist {
  return { id: crypto.randomUUID(), name, channels, importedAt: new Date().toISOString() }
}

function Player({ channel }: { channel: Channel | null }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !channel) return

    setError(null)
    let hls: Hls | null = null

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = channel.url
      void video.play().catch(() => undefined)
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true })
      hls.loadSource(channel.url)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => void video.play().catch(() => undefined))
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setError('Não foi possível reproduzir este stream no navegador. Verifique CORS e o suporte do formato.')
      })
    } else {
      setError('Este navegador não oferece suporte a HLS.')
    }

    return () => {
      hls?.destroy()
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [channel])

  if (!channel) return <div className="empty-player"><Play size={30} /><span>Selecione um canal para começar</span></div>

  return (
    <div className="video-wrapper">
      <video ref={videoRef} controls playsInline />
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
        <p>Importe uma playlist M3U e organize seus canais em um único player web.</p>
        <button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={18} /> Importar playlist M3U</button>
        <input ref={fileRef} type="file" accept=".m3u,.m3u8,text/plain" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = '' }} />
        <div className="privacy-note">Sua playlist é armazenada localmente neste navegador.</div>
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
