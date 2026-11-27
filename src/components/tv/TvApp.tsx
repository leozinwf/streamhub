import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Clapperboard, Film, Play, Radio, Settings, Star, Tv } from 'lucide-react'
import type { Channel, MediaItem, XtreamConnection } from '../../types'
import { isAdultChannel } from '../../lib/channelStore'
import { cleanCategoryLabel, isAdult } from '../../lib/mediaCatalog'
import { formatRemaining, useWatchState } from '../../lib/watchState'
import { EpgNowLine } from '../EpgGuide'
import MediaDetails from '../MediaDetails'
import { TvGrid, TvList } from './TvList'

/**
 * Fire TV interface, in the style of IPTV apps: a main menu (TV ao vivo,
 * Filmes, Séries), the provider's own categories, and full screen once a
 * channel or title is chosen. The web interface is not used on the TV.
 */

export type TvCategory = { id: string; label: string; count: number }
const FAVORITES = '__favoritos'
const RECENTS = '__recentes'

/** Provider categories in the provider's order; adult ones at the end. */
function liveCategories(channels: Channel[]) {
  const map = new Map<string, Channel[]>()
  for (const channel of channels) {
    const id = channel.sourceGroup || channel.group || 'Outros'
    const list = map.get(id)
    if (list) list.push(channel)
    else map.set(id, [channel])
  }
  const entries = Array.from(map.entries())
  const adult = (id: string, list: Channel[]) => isAdultChannel(list[0]) || /\b(adult|xxx|\+ ?18|18 ?\+)/i.test(id)
  return {
    map,
    categories: [...entries.filter(([id, list]) => !adult(id, list)), ...entries.filter(([id, list]) => adult(id, list))]
      .map(([id, list]) => ({ id, label: cleanCategoryLabel(id), count: list.length })),
  }
}

function mediaCategories(items: MediaItem[]) {
  const map = new Map<string, MediaItem[]>()
  for (const item of items) {
    const list = map.get(item.category)
    if (list) list.push(item)
    else map.set(item.category, [item])
  }
  const entries = Array.from(map.entries())
  return {
    map,
    categories: [...entries.filter(([, list]) => !isAdult(list[0])), ...entries.filter(([, list]) => isAdult(list[0]))]
      .map(([id, list]) => ({ id, label: cleanCategoryLabel(id), count: list.length })),
  }
}

type LiveBrowserProps = {
  categories: TvCategory[]
  channelsOf: (category: string) => Channel[]
  current: Channel | null
  initialCategory?: string
  onPlay: (channel: Channel, list: Channel[]) => void
  overlay?: boolean
}

/** Categories on the left, channels in the middle, the selected channel's programme on the right. */
export function TvLiveBrowser({ categories, channelsOf, current, initialCategory, onPlay, overlay }: LiveBrowserProps) {
  const startCategory = Math.max(0, categories.findIndex((category) => category.id === initialCategory))
  const [categoryIndex, setCategoryIndex] = useState(startCategory)
  const category = categories[categoryIndex]
  const channels = useMemo(() => category ? channelsOf(category.id) : [], [category?.id, channelsOf])
  const playingIndex = current ? channels.findIndex((channel) => channel.id === current.id || channel.url === current.url || channel.variants?.some((variant) => variant.id === current.id)) : -1
  const [channelIndex, setChannelIndex] = useState(Math.max(0, playingIndex))
  const channelsRef = useRef<HTMLDivElement>(null)
  const selected = channels[Math.min(channelIndex, channels.length - 1)]

  useEffect(() => { setChannelIndex(Math.max(0, playingIndex)) }, [category?.id])
  // Opening over the video: start on the channel list, at the channel playing.
  useEffect(() => { if (overlay) window.setTimeout(() => channelsRef.current?.querySelector<HTMLElement>('.tv-list')?.focus({ preventScroll: true }), 0) }, [])

  return <div className={overlay ? 'tv-browser tv-browser-overlay' : 'tv-browser'}>
    <TvList label="Categorias" className="tv-col-categories" items={categories} rowHeight={52} index={categoryIndex} onIndex={setCategoryIndex} autoFocus={!overlay}
      onSelect={() => channelsRef.current?.querySelector<HTMLElement>('.tv-list')?.focus({ preventScroll: true })}
      render={(item) => <><span className="tv-row-label">{item.label}</span><small>{item.count}</small></>} />
    <div className="tv-col-channels" ref={channelsRef}>
      <TvList label="Canais" items={channels} rowHeight={64} index={channelIndex} onIndex={setChannelIndex} onSelect={(channel) => onPlay(channel, channels)}
        render={(channel, index) => <>
          <em>{index + 1}</em>
          {channel.logo ? <img src={channel.logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} /> : <span className="tv-logo-fallback">{channel.name.slice(0, 2)}</span>}
          <span className="tv-row-label">{channel.name}</span>
          {index === playingIndex && <Play size={16} fill="currentColor" className="tv-playing" />}
        </>} />
    </div>
    <aside className="tv-col-preview">
      {selected ? <>
        <div className="tv-preview-logo">{selected.logo ? <img src={selected.logo} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} /> : <Tv size={48} />}</div>
        <strong>{selected.name}</strong>
        <span>{category?.label}</span>
        <EpgNowLine key={selected.id} channel={selected} />
        <small>OK assiste · ← categorias{overlay ? ' · Voltar fecha' : ' · Voltar menu'}</small>
      </> : <span>Escolha uma categoria.</span>}
    </aside>
  </div>
}

type Screen = 'home' | 'live' | 'movie' | 'series'

type Props = {
  playlistName: string
  channels: Channel[]
  media: MediaItem[]
  favorites: Channel[]
  recents: Channel[]
  connection: XtreamConnection | null
  current: Channel | null
  watching: boolean
  onPlayChannel: (channel: Channel, list: Channel[]) => void
  onPlayMedia: (channel: Channel, queue?: Channel[]) => void
  onSettings: () => void
  /** The app's back button asks this first while nothing is playing. */
  backRef: MutableRefObject<() => boolean>
}

export default function TvApp({ playlistName, channels, media, favorites, recents, connection, current, watching, onPlayChannel, onPlayMedia, onSettings, backRef }: Props) {
  const watch = useWatchState()
  const [screen, setScreen] = useState<Screen>('home')
  const [details, setDetails] = useState<MediaItem | null>(null)
  const [mediaState, setMediaState] = useState<Record<'movie' | 'series', { category: number; item: number }>>({ movie: { category: 0, item: 0 }, series: { category: 0, item: 0 } })
  const [clock, setClock] = useState(() => new Date())
  const lastFocusRef = useRef<HTMLElement | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 30000); return () => window.clearInterval(timer) }, [])

  const { categories: liveCats, channelsOf, categoryOf } = useTvLiveCatalog(channels, favorites, recents)

  const movies = useMemo(() => mediaCategories(media.filter((item) => item.kind === 'movie')), [media])
  const series = useMemo(() => mediaCategories(media.filter((item) => item.kind === 'series')), [media])
  const byId = useMemo(() => new Map(media.map((item) => [item.id, item])), [media])
  const resume = useMemo(() => {
    const seen = new Set<string>()
    return Object.values(watch.progress).sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((entry) => byId.has(entry.mediaId) && !seen.has(entry.mediaId) && seen.add(entry.mediaId)).slice(0, 8)
  }, [watch.progress, byId])

  // Back: details → grid, section → main menu; on the main menu the app offers to exit.
  backRef.current = () => {
    if (details) { setDetails(null); return true }
    if (screen !== 'home') { setScreen('home'); return true }
    return false
  }

  // Coming back from full screen, or after a page change: put the focus where it makes sense.
  const hadDetailsRef = useRef(false)
  useEffect(() => {
    const closedDetails = hadDetailsRef.current && !details
    hadDetailsRef.current = Boolean(details)
    if (watching) return
    window.setTimeout(() => {
      const target = lastFocusRef.current
      if (target && target.isConnected && !closedDetails && !(details && !target.closest('.tv-details'))) { target.focus({ preventScroll: true }); return }
      const root = rootRef.current
      const order = details ? ['.md-play', 'button'] : closedDetails ? ['.tv-grid', '.tv-list'] : ['.tv-autofocus', '.tv-list', 'button']
      order.map((selector) => root?.querySelector<HTMLElement>(selector)).find(Boolean)?.focus({ preventScroll: true })
    }, 0)
  }, [watching, screen, details])

  const tiles: Array<{ id: Screen | 'settings' | 'favorites'; label: string; sub: string; icon: JSX.Element; hidden?: boolean }> = [
    { id: 'live', label: 'TV ao vivo', sub: `${channels.length.toLocaleString('pt-BR')} canais`, icon: <Radio size={44} /> },
    { id: 'movie', label: 'Filmes', sub: `${movies.categories.reduce((sum, category) => sum + category.count, 0).toLocaleString('pt-BR')} títulos`, icon: <Film size={44} />, hidden: !movies.categories.length },
    { id: 'series', label: 'Séries', sub: `${series.categories.reduce((sum, category) => sum + category.count, 0).toLocaleString('pt-BR')} títulos`, icon: <Clapperboard size={44} />, hidden: !series.categories.length },
    { id: 'favorites', label: 'Favoritos', sub: `${favorites.length} canais`, icon: <Star size={44} />, hidden: !favorites.length },
    { id: 'settings', label: 'Configurações', sub: 'Lista e conta', icon: <Settings size={44} /> },
  ]

  const openTile = (id: string) => {
    if (id === 'settings') { onSettings(); return }
    setScreen(id === 'favorites' ? 'live' : id as Screen)
    setDetails(null)
  }

  const mediaScreen = (kind: 'movie' | 'series') => {
    const data = kind === 'movie' ? movies : series
    const state = mediaState[kind]
    const category = data.categories[state.category]
    const items = category ? data.map.get(category.id) || [] : []
    const update = (patch: Partial<{ category: number; item: number }>) => setMediaState((current) => ({ ...current, [kind]: { ...current[kind], ...patch } }))
    if (details) return <div className="tv-details"><MediaDetails item={details} connection={connection} backLabel={kind === 'movie' ? 'Voltar aos filmes' : 'Voltar às séries'} onBack={() => setDetails(null)} onPlay={onPlayMedia} /></div>
    return <div className="tv-browser tv-browser-media">
      <TvList label="Categorias" className="tv-col-categories" items={data.categories} rowHeight={52} index={state.category} onIndex={(index) => update({ category: index, item: 0 })} autoFocus
        onSelect={() => rootRef.current?.querySelector<HTMLElement>('.tv-grid')?.focus({ preventScroll: true })}
        render={(item) => <><span className="tv-row-label">{item.label}</span><small>{item.count}</small></>} />
      <TvGrid label={kind === 'movie' ? 'Filmes' : 'Séries'} className="tv-col-posters" items={items} columns={5} rowHeight={290} index={state.item} onIndex={(index) => update({ item: index })} onSelect={(item) => setDetails(item)}
        render={(item) => {
          const progress = watch.progress[item.id]
          return <div className="tv-poster">
            <div className="tv-poster-img">{item.poster ? <img src={item.poster} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} /> : <span>{item.name.slice(0, 2)}</span>}
              {progress && <span className="tv-poster-bar"><span style={{ width: `${(progress.position / progress.duration) * 100}%` }} /></span>}</div>
            <strong>{item.name}</strong>
          </div>
        }} />
    </div>
  }

  const titles: Record<Screen, string> = { home: playlistName, live: 'TV ao vivo', movie: 'Filmes', series: 'Séries' }

  return <div className="tv-app" ref={rootRef} onFocusCapture={(event) => { lastFocusRef.current = event.target as HTMLElement }}>
    <header className="tv-header">
      <span className="tv-brand"><Tv size={26} /> StreamHub</span>
      <h1>{titles[screen]}</h1>
      <time>{clock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time>
    </header>
    {screen === 'home' && <main className="tv-home">
      <div className="tv-tiles">
        {tiles.filter((tile) => !tile.hidden).map((tile, index) => <button key={tile.id} className={index === 0 ? 'tv-tile tv-autofocus' : 'tv-tile'} onClick={() => openTile(tile.id)}>{tile.icon}<strong>{tile.label}</strong><span>{tile.sub}</span></button>)}
      </div>
      {resume.length > 0 && <section className="tv-row-section">
        <h2>Continuar assistindo</h2>
        <div className="tv-mini-row">{resume.map((entry) => {
          const item = byId.get(entry.mediaId)!
          return <button key={entry.id} className="tv-mini" onClick={() => { setScreen(item.kind); setDetails(item) }}>
            {item.poster ? <img src={item.poster} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{item.name.slice(0, 2)}</span>}
            <strong>{item.name}</strong><small>{entry.label ? `${entry.label} · ` : ''}{formatRemaining(entry)}</small>
          </button>
        })}</div>
      </section>}
      {recents.length > 0 && <section className="tv-row-section">
        <h2>Canais vistos recentemente</h2>
        <div className="tv-mini-row">{recents.slice(0, 8).map((channel) => <button key={channel.id} className="tv-mini tv-mini-channel" onClick={() => onPlayChannel(channel, recents)}>
          {channel.logo ? <img src={channel.logo} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{channel.name.slice(0, 2)}</span>}
          <strong>{channel.name}</strong>
        </button>)}</div>
      </section>}
      <p className="tv-hint">Setas para navegar · OK para abrir · Voltar para sair</p>
    </main>}
    {screen === 'live' && <TvLiveBrowser key="live" categories={liveCats} channelsOf={channelsOf} current={current} onPlay={onPlayChannel}
      initialCategory={current ? categoryOf(current) : favorites.length ? FAVORITES : undefined} />}
    {screen === 'movie' && mediaScreen('movie')}
    {screen === 'series' && mediaScreen('series')}
  </div>
}

/** Used by the app for the channel menu over the video and for zapping. */
export function useTvLiveCatalog(channels: Channel[], favorites: Channel[], recents: Channel[]) {
  const live = useMemo(() => liveCategories(channels), [channels])
  const cache = useRef(new Map<string, Channel[]>())
  useEffect(() => { cache.current.clear() }, [channels])
  const channelsOf = useMemo(() => (id: string) => {
    if (id === FAVORITES) return favorites
    if (id === RECENTS) return recents
    const cached = cache.current.get(id)
    if (cached) return cached
    // Each quality stays as its own line, as the provider lists it ([FHD], [HD], [SD]…).
    const list = live.map.get(id) || []
    cache.current.set(id, list)
    return list
  }, [live, favorites, recents])
  const categories = useMemo(() => [
    ...(favorites.length ? [{ id: FAVORITES, label: '★ Favoritos', count: favorites.length }] : []),
    ...(recents.length ? [{ id: RECENTS, label: 'Vistos recentemente', count: recents.length }] : []),
    ...live.categories,
  ], [live, favorites.length, recents.length])
  /** Category that contains the channel (its own provider category first). */
  const categoryOf = (channel: Channel) => {
    const own = channel.sourceGroup || channel.group
    if (own && live.map.has(own)) return own
    return categories.find((category) => channelsOf(category.id).some((item) => item.id === channel.id))?.id
  }
  return { categories, channelsOf, categoryOf }
}
