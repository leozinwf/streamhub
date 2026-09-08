import { useMemo, useRef, useState } from 'react'
import { Search, Upload, Play, Star, Tv, X } from 'lucide-react'
import { parseM3U } from './lib/m3u'
import { clearPlaylist, loadPlaylist, savePlaylist } from './lib/storage'
import type { Channel, Playlist } from './types'

function createPlaylist(name: string, channels: Channel[]): Playlist {
  return {
    id: crypto.randomUUID(),
    name,
    channels,
    importedAt: new Date().toISOString(),
  }
}

export default function App() {
  const [playlist, setPlaylist] = useState<Playlist | null>(() => loadPlaylist())
  const [selectedGroup, setSelectedGroup] = useState('Todos')
  const [query, setQuery] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const groups = useMemo(() => {
    if (!playlist) return []
    return ['Todos', ...Array.from(new Set(playlist.channels.map((channel) => channel.group))).sort()]
  }, [playlist])

  const channels = useMemo(() => {
    if (!playlist) return []
    return playlist.channels.filter((channel) => {
      const groupMatch = selectedGroup === 'Todos' || channel.group === selectedGroup
      const searchMatch = channel.name.toLowerCase().includes(query.toLowerCase())
      return groupMatch && searchMatch
    })
  }, [playlist, query, selectedGroup])

  async function importFile(file: File) {
    const content = await file.text()
    importContent(file.name.replace(/\.[^.]+$/, '') || 'Minha playlist', content)
  }

  function importContent(name: string, content: string) {
    const channels = parseM3U(content)
    if (!channels.length) {
      window.alert('Nenhum canal válido foi encontrado nessa playlist.')
      return
    }
    const next = createPlaylist(name, channels)
    savePlaylist(next)
    setPlaylist(next)
    setSelectedGroup('Todos')
    setSelectedChannel(null)
  }

  function reset() {
    clearPlaylist()
    setPlaylist(null)
    setSelectedChannel(null)
    setSelectedGroup('Todos')
    setQuery('')
  }

  if (!playlist) {
    return (
      <main className="landing">
        <section className="import-card">
          <div className="brand-mark"><Tv size={26} /></div>
          <span className="eyebrow">STREAMHUB</span>
          <h1>Sua playlist.<br /><span>Seu player.</span></h1>
          <p>Importe uma playlist M3U e organize seus canais em um único player web.</p>
          <button className="primary-button" onClick={() => fileRef.current?.click()}>
            <Upload size={18} /> Importar playlist M3U
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".m3u,.m3u8,text/plain"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importFile(file)
              event.target.value = ''
            }}
          />
          <div className="privacy-note">Sua playlist fica armazenada localmente neste navegador.</div>
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><Tv size={20} /> StreamHub</div>
        <div className="search-wrap">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar canal..." />
        </div>
        <button className="ghost-button" onClick={() => fileRef.current?.click()} title="Importar outra playlist">
          <Upload size={18} />
        </button>
        <button className="ghost-button" onClick={reset} title="Remover playlist">
          <X size={18} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".m3u,.m3u8,text/plain"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importFile(file)
            event.target.value = ''
          }}
        />
      </header>

      <div className="layout">
        <aside className="sidebar">
          <div className="playlist-title">{playlist.name}<span>{playlist.channels.length} canais</span></div>
          <nav>
            {groups.map((group) => (
              <button
                key={group}
                className={selectedGroup === group ? 'nav-item active' : 'nav-item'}
                onClick={() => setSelectedGroup(group)}
              >
                {group === 'Todos' ? <Tv size={16} /> : <Star size={16} />}
                <span>{group}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="content">
          <section className="player-card">
            <div className="player-screen">
              {selectedChannel ? (
                <div className="selected-channel">
                  <div className="channel-logo large">
                    {selectedChannel.logo ? <img src={selectedChannel.logo} alt="" /> : <Tv size={34} />}
                  </div>
                  <h2>{selectedChannel.name}</h2>
                  <p>Player será conectado à fonte selecionada.</p>
                </div>
              ) : (
                <div className="empty-player">
                  <Play size={30} />
                  <span>Selecione um canal para começar</span>
                </div>
              )}
            </div>
          </section>

          <section className="channels-section">
            <div className="section-heading">
              <div><span className="eyebrow">BIBLIOTECA</span><h2>{selectedGroup}</h2></div>
              <span className="count">{channels.length} canais</span>
            </div>
            <div className="channel-grid">
              {channels.map((channel) => (
                <button className="channel-card" key={channel.id} onClick={() => setSelectedChannel(channel)}>
                  <div className="channel-logo">
                    {channel.logo ? <img src={channel.logo} alt="" /> : <Tv size={23} />}
                  </div>
                  <div className="channel-info">
                    <strong>{channel.name}</strong>
                    <span>{channel.group}</span>
                  </div>
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
