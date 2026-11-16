import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Baby, BookOpen, Trash2, ChevronLeft, ChevronRight, Church, Clapperboard, Clock3, Download, Film, Globe, History, Home, LogOut, Menu, Music, Newspaper, Popcorn, Radio, Search, Settings, Sparkles, Star, Timer, Trophy, Tv, Upload, X } from 'lucide-react'
import type { Channel, MediaItem } from '../types'
import { normalizeChannelKey } from '../lib/channelVariants'
import { isForeignGroup } from '../lib/categorize'
import { groupLabel } from '../lib/groupLabel'

const PAGE_SIZE = 48
const SIDEBAR_GROUP_LIMIT = 8
const DRAWER_STORAGE_KEY = 'streamhub-home-drawer'
const SHELF_SIZE = 12
/** Home shelves, in display order. 'movies'/'series' are the VOD catalogs. */
const SHELF_ORDER = ['TV Aberta', 'Esportes', 'Streaming e Eventos', 'movies', 'series', 'Filmes e Séries', 'Documentários', 'Entretenimento', 'Notícias', 'Infantil', 'Música', 'Canais 24h', 'Religiosos', 'Internacionais'] as const
const SHELF_TITLES: Record<string, string> = { 'TV Aberta': 'TV Aberta', 'Esportes': 'Esportes', 'Streaming e Eventos': 'Streaming e eventos · Disney+, Max, Prime', 'Filmes e Séries': 'Canais de filmes e séries', 'Documentários': 'Documentários', 'Entretenimento': 'Variedades e entretenimento', 'Notícias': 'Notícias', 'Infantil': 'Infantil', 'Música': 'Música', 'Canais 24h': 'Canais 24 horas', 'Religiosos': 'Religiosos', 'Internacionais': 'Canais internacionais' }

type Feed = 'all' | 'favorites' | 'recent' | 'movies' | 'series' | `group:${string}` | `cat:${string}`

type Props = {
  channels: Channel[]
  favorites: Channel[]
  recents: Channel[]
  media: MediaItem[]
  groups: string[]
  groupCounts: Map<string, number>
  groupOf: (channel: Channel) => string
  isFavorite: (channel: Channel) => boolean
  onPlay: (channel: Channel) => void
  onPlayMovie: (item: MediaItem) => void
  onOpenSeries: (item: MediaItem) => void
  onOpenLibrary: (mode: 'live' | 'movie' | 'series') => void
  onToggleFavorite: (channel: Channel) => void
  onClearRecents: () => void
  onRemoveRecent: (channel: Channel) => void
  onImport: () => void
  onExport: () => void
  onSettings: () => void
  onLogout: () => void
}

function searchKey(value: string) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR').trim()
}

/** Stable, pleasant hue per name so cards without artwork still look distinct. */
function hueFor(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) | 0
  return Math.abs(hash) % 360
}

function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase()
}

/** Big Brazilian brands, shown first in each shelf. */
const POPULAR_BRANDS = /\b(globo|sbt|record|band|redetv|rede tv|cultura|sportv|premiere|espn|tnt|hbo|max|telecine|warner|universal|sony|axn|discovery|history|nat ?geo|national geographic|animal planet|disney|cartoon|gloob|multishow|gnt|viva|megapix|paramount|amc|space|globonews|cnn|band ?news|record ?news|jovem pan|combate|bandsports)\b/i

/** Shelf order: channels with a logo and several qualities first (usually the main ones). */
function rankForShelf(list: Channel[]) {
  const score = (channel: Channel) => (POPULAR_BRANDS.test(channel.name) ? 4 : 0) + (channel.logo ? 2 : 0) + ((channel.variants?.length || 0) > 1 ? 1 : 0)
  return list.map((channel, index) => ({ channel, index, value: score(channel) }))
    .sort((a, b) => b.value - a.value || a.index - b.index)
    .map((item) => item.channel)
}

const SHELF_ICONS: Record<string, ReactNode> = {
  'TV Aberta': <Tv size={20} />, 'Notícias': <Newspaper size={20} />, 'Esportes': <Trophy size={20} />, movies: <Film size={20} />, series: <Clapperboard size={20} />,
  'Filmes e Séries': <Popcorn size={20} />, 'Infantil': <Baby size={20} />, 'Documentários': <BookOpen size={20} />, 'Entretenimento': <Sparkles size={20} />,
  'Música': <Music size={20} />, 'Canais 24h': <Timer size={20} />, 'Religiosos': <Church size={20} />, 'Internacionais': <Globe size={20} />,
}

function Artwork({ src, name, className }: { src?: string; name: string; className: string }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return <span className={`${className} yt-fallback`} aria-hidden="true">{initials(name)}</span>
  return <img className={className} src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

export function ChannelCard({ channel, group, favorite, onPlay, onToggleFavorite, active = false, extra }: { channel: Channel; group: string; favorite: boolean; onPlay: () => void; onToggleFavorite: () => void; active?: boolean; extra?: ReactNode }) {
  const hue = hueFor(channel.name)
  // Only real quality labels, without repeats (versions without a label show as "Qualidade").
  const qualities = Array.from(new Set(channel.variants?.map((variant) => variant.quality).filter((quality) => quality && quality !== 'Qualidade') ?? []))
  return <article className={active ? 'yt-card is-active' : 'yt-card'}>
    <button className="yt-thumb" onClick={onPlay} style={{ ['--hue' as string]: hue }} aria-label={`Assistir ${channel.name}`} aria-current={active || undefined}>
      {channel.logo && <img className="yt-thumb-backdrop" src={channel.logo} alt="" loading="lazy" aria-hidden="true" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
      <Artwork src={channel.logo} name={channel.name} className="yt-thumb-logo" />
      <span className="yt-badge-live"><Radio size={12} /> AO VIVO</span>
      {active && <span className="yt-now-playing">Assistindo</span>}
    </button>
    <div className="yt-meta">
      <button className="yt-avatar" onClick={onPlay} tabIndex={-1} aria-hidden="true" style={{ ['--hue' as string]: hue }}><Artwork src={channel.logo} name={channel.name} className="yt-avatar-img" /></button>
      <div className="yt-text">
        <button className="yt-title" onClick={onPlay} title={channel.name}>{channel.name}</button>
        <span className="yt-sub">{group ? groupLabel(group) : 'Sem categoria'}</span>
        {qualities.length > 1 && <span className="yt-sub yt-qualities">{qualities.join(' · ')}</span>}
      </div>
      <button className={favorite ? 'yt-fav active' : 'yt-fav'} onClick={onToggleFavorite} aria-pressed={favorite} aria-label={favorite ? `Remover ${channel.name} dos favoritos` : `Favoritar ${channel.name}`} title={favorite ? 'Remover dos favoritos' : 'Favoritar'}><Star size={17} fill={favorite ? 'currentColor' : 'none'} /></button>
      {extra}
    </div>
  </article>
}

export function MediaCard({ item, onOpen }: { item: MediaItem; onOpen: () => void }) {
  const hue = hueFor(item.name)
  return <article className="yt-card">
    <button className="yt-thumb" onClick={onOpen} style={{ ['--hue' as string]: hue }} aria-label={`${item.kind === 'movie' ? 'Assistir' : 'Abrir'} ${item.name}`}>
      {item.poster && <img className="yt-thumb-backdrop" src={item.poster} alt="" loading="lazy" aria-hidden="true" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} />}
      <Artwork src={item.poster} name={item.name} className="yt-thumb-poster" />
      <span className="yt-badge">{item.kind === 'movie' ? 'FILME' : 'SÉRIE'}</span>
    </button>
    <div className="yt-meta">
      <span className="yt-avatar" style={{ ['--hue' as string]: hue }}>{item.kind === 'movie' ? <Film size={16} /> : <Clapperboard size={16} />}</span>
      <div className="yt-text">
        <button className="yt-title" onClick={onOpen} title={item.name}>{item.name}</button>
        <span className="yt-sub">{item.category}</span>
      </div>
    </div>
  </article>
}

export default function HomeFeed(props: Props) {
  const { channels, favorites, recents, media, groups, groupCounts, groupOf, isFavorite, onPlay, onPlayMovie, onOpenSeries, onOpenLibrary, onToggleFavorite } = props
  const [query, setQuery] = useState('')
  const [feed, setFeed] = useState<Feed>('all')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [drawerOpen, setDrawerOpen] = useState(() => { try { return localStorage.getItem(DRAWER_STORAGE_KEY) !== '0' } catch { return true } })
  const [mobileDrawer, setMobileDrawer] = useState(false)
  const [showAllGroups, setShowAllGroups] = useState(false)
  const [showAllForeign, setShowAllForeign] = useState(false)
  const [chipsScroll, setChipsScroll] = useState({ left: false, right: false })
  const chipsRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const movies = useMemo(() => media.filter((item) => item.kind === 'movie'), [media])
  const series = useMemo(() => media.filter((item) => item.kind === 'series'), [media])
  const key = searchKey(query)

  const liveResults = useMemo(() => {
    let source: Channel[]
    if (feed === 'favorites') source = favorites
    else if (feed === 'recent') source = recents
    else if (feed.startsWith('group:')) { const group = feed.slice(6); source = channels.filter((channel) => groupOf(channel) === group) }
    else if (feed.startsWith('cat:')) { const category = feed.slice(4); source = rankForShelf(channels.filter((channel) => channel.group === category)) }
    else if (feed === 'movies' || feed === 'series') source = []
    else source = feed === 'all' && !key ? channels.filter((channel) => channel.group !== 'Internacionais') : channels
    if (!key) return source
    return source.filter((channel) => searchKey(channel.name).includes(key) || normalizeChannelKey(channel.name).includes(key) || searchKey(groupOf(channel)).includes(key)).sort((a, b) => Number(a.group === 'Internacionais') - Number(b.group === 'Internacionais'))
  }, [channels, favorites, recents, feed, key, groupOf])

  const mediaResults = useMemo(() => {
    const source = feed === 'movies' ? movies : feed === 'series' ? series : feed === 'all' && key ? media : []
    return key ? source.filter((item) => searchKey(item.name).includes(key)) : source
  }, [feed, key, movies, series, media])

  // Home shelves ("Tudo" without a search): one row per main category, like YouTube.
  const shelves = useMemo(() => {
    const byCategory = new Map<string, Channel[]>()
    for (const channel of channels) {
      const list = byCategory.get(channel.group)
      if (list) list.push(channel)
      else byCategory.set(channel.group, [channel])
    }
    const rows: Array<{ id: string; title: string; feed: Feed; count: number; channels?: Channel[]; media?: MediaItem[] }> = []
    for (const id of SHELF_ORDER) {
      if (id === 'movies' || id === 'series') {
        const list = id === 'movies' ? movies : series
        if (list.length) rows.push({ id, title: id === 'movies' ? 'Filmes' : 'Séries', feed: id, count: list.length, media: list.slice(0, SHELF_SIZE) })
        continue
      }
      const list = byCategory.get(id)
      if (list?.length) rows.push({ id, title: SHELF_TITLES[id] || id, feed: `cat:${id}`, count: list.length, channels: rankForShelf(list).slice(0, SHELF_SIZE) })
    }
    return rows
  }, [channels, movies, series])

  const total = liveResults.length + mediaResults.length
  const visibleLive = liveResults.slice(0, limit)
  const visibleMedia = mediaResults.slice(0, Math.max(0, limit - visibleLive.length))

  useEffect(() => { setLimit(PAGE_SIZE); window.scrollTo({ top: 0 }) }, [feed, key])

  // Infinite scroll, like the YouTube home feed.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setLimit((value) => value + PAGE_SIZE) }, { rootMargin: '800px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [total > limit])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === '/' && target?.tagName !== 'INPUT' && target?.tagName !== 'TEXTAREA') { event.preventDefault(); searchRef.current?.focus() }
      if (event.key === 'Escape') setMobileDrawer(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const updateChipArrows = () => {
    const element = chipsRef.current
    if (!element) return
    setChipsScroll({ left: element.scrollLeft > 4, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 4 })
  }
  useEffect(() => {
    updateChipArrows()
    window.addEventListener('resize', updateChipArrows)
    return () => window.removeEventListener('resize', updateChipArrows)
  }, [groups.length])
  const scrollChips = (direction: number) => chipsRef.current?.scrollBy({ left: direction * (chipsRef.current.clientWidth * 0.7), behavior: 'smooth' })

  const toggleMenu = () => {
    if (window.matchMedia('(max-width: 1100px)').matches) { setMobileDrawer((value) => !value); return }
    setDrawerOpen((value) => { const next = !value; try { localStorage.setItem(DRAWER_STORAGE_KEY, next ? '1' : '0') } catch { /* ignore */ } return next })
  }
  const choose = (next: Feed) => { setFeed(next); setMobileDrawer(false) }
  const submitSearch = () => { searchRef.current?.blur(); if (feed !== 'all' && key) setFeed('all') }

  const brazilianGroups = groups.filter((group) => !isForeignGroup(group) && group !== 'Internacionais')
  const foreignGroups = groups.filter((group) => isForeignGroup(group) || group === 'Internacionais')
  const sidebarGroups = showAllGroups ? brazilianGroups : brazilianGroups.slice(0, SIDEBAR_GROUP_LIMIT)
  const chips: Array<{ id: Feed; label: string }> = [
    { id: 'all', label: 'Tudo' },
    ...(favorites.length ? [{ id: 'favorites' as Feed, label: 'Favoritos' }] : []),
    ...(recents.length ? [{ id: 'recent' as Feed, label: 'Vistos recentemente' }] : []),
    ...(movies.length ? [{ id: 'movies' as Feed, label: 'Filmes' }] : []),
    ...(series.length ? [{ id: 'series' as Feed, label: 'Séries' }] : []),
    ...shelves.filter((shelf) => shelf.channels).map((shelf) => ({ id: shelf.feed, label: shelf.title.split(' · ')[0] })),
    ...groups.filter((group) => !shelves.some((shelf) => shelf.id === group) && !isForeignGroup(group)).map((group) => ({ id: `group:${group}` as Feed, label: groupLabel(group) })),
    ...groups.filter((group) => !shelves.some((shelf) => shelf.id === group) && isForeignGroup(group)).map((group) => ({ id: `group:${group}` as Feed, label: `🌎 ${groupLabel(group)}` })),
  ]
  const feedTitle = feed === 'favorites' ? 'Favoritos' : feed === 'recent' ? 'Vistos recentemente' : feed === 'movies' ? 'Filmes' : feed === 'series' ? 'Séries' : feed.startsWith('group:') ? groupLabel(feed.slice(6)) : feed.startsWith('cat:') ? (SHELF_TITLES[feed.slice(4)] || feed.slice(4)) : ''
  const showShelf = feed === 'all' && !key

  const navItem = (id: Feed | 'live-page', icon: ReactNode, label: string, count?: number) => {
    const active = id === feed
    return <button key={id} className={active ? 'yt-nav active' : 'yt-nav'} onClick={() => id === 'live-page' ? onOpenLibrary('live') : choose(id)} title={label}>{icon}<span className="yt-nav-label">{label}</span>{count !== undefined && <small className="yt-nav-count">{count.toLocaleString('pt-BR')}</small>}</button>
  }

  return <div className={`yt-home ${drawerOpen ? 'drawer-open' : 'drawer-closed'} ${mobileDrawer ? 'mobile-drawer' : ''}`}>
    <header className="yt-topbar">
      <div className="yt-topbar-start">
        <button className="yt-icon-btn" onClick={toggleMenu} aria-label="Menu" title="Menu"><Menu size={22} /></button>
        <button className="yt-logo" onClick={() => { setQuery(''); choose('all') }} title="Início do StreamHub"><span className="yt-logo-mark"><Tv size={16} /></span><span>StreamHub</span></button>
      </div>
      <form className="yt-search" role="search" onSubmit={(event) => { event.preventDefault(); submitSearch() }}>
        <div className="yt-search-box">
          <Search size={17} className="yt-search-icon" />
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar canais, filmes e séries" aria-label="Pesquisar" />
          {query && <button type="button" className="yt-search-clear" onClick={() => { setQuery(''); searchRef.current?.focus() }} aria-label="Limpar pesquisa"><X size={18} /></button>}
        </div>
        <button type="submit" className="yt-search-btn" aria-label="Pesquisar" title="Pesquisar"><Search size={20} /></button>
      </form>
      <div className="yt-topbar-end">
        <button className="yt-icon-btn yt-hide-sm" onClick={props.onImport} title="Importar outra playlist" aria-label="Importar playlist"><Upload size={19} /></button>
        <button className="yt-icon-btn yt-hide-sm" onClick={props.onExport} title="Exportar canais em M3U" aria-label="Exportar"><Download size={19} /></button>
        <button className="yt-icon-btn" onClick={props.onSettings} title="Configurações e acesso" aria-label="Configurações"><Settings size={19} /></button>
        <button className="yt-icon-btn" onClick={props.onLogout} title="Sair e remover a lista deste aparelho" aria-label="Sair"><LogOut size={19} /></button>
      </div>
    </header>

    {/* Compact rail (desktop, drawer closed) */}
    <nav className="yt-rail" aria-label="Navegação">
      <button className={feed === 'all' ? 'yt-rail-item active' : 'yt-rail-item'} onClick={() => choose('all')}><Home size={21} /><span>Início</span></button>
      <button className="yt-rail-item" onClick={() => onOpenLibrary('live')}><Radio size={21} /><span>Ao vivo</span></button>
      {movies.length > 0 && <button className={feed === 'movies' ? 'yt-rail-item active' : 'yt-rail-item'} onClick={() => choose('movies')}><Film size={21} /><span>Filmes</span></button>}
      {series.length > 0 && <button className={feed === 'series' ? 'yt-rail-item active' : 'yt-rail-item'} onClick={() => choose('series')}><Clapperboard size={21} /><span>Séries</span></button>}
      <button className={feed === 'favorites' ? 'yt-rail-item active' : 'yt-rail-item'} onClick={() => choose('favorites')}><Star size={21} /><span>Favoritos</span></button>
    </nav>

    {/* Full drawer */}
    {mobileDrawer && <button className="yt-scrim" aria-label="Fechar menu" onClick={() => setMobileDrawer(false)} />}
    <aside className="yt-drawer" aria-label="Menu">
      <div className="yt-drawer-head">
        <button className="yt-icon-btn" onClick={() => setMobileDrawer(false)} aria-label="Fechar menu"><Menu size={22} /></button>
        <span className="yt-logo"><span className="yt-logo-mark"><Tv size={16} /></span><span>StreamHub</span></span>
      </div>
      <div className="yt-drawer-section">
        {navItem('all', <Home size={20} />, 'Início')}
        {navItem('live-page', <Radio size={20} />, 'TV ao vivo', channels.length)}
        {movies.length > 0 && navItem('movies', <Film size={20} />, 'Filmes', movies.length)}
        {series.length > 0 && navItem('series', <Clapperboard size={20} />, 'Séries', series.length)}
      </div>
      <div className="yt-drawer-section">
        <div className="yt-drawer-title">Você <ChevronRight size={16} /></div>
        {navItem('favorites', <Star size={20} />, 'Favoritos', favorites.length)}
        {navItem('recent', <History size={20} />, 'Vistos recentemente', recents.length)}
      </div>
      {shelves.some((shelf) => shelf.channels) && <div className="yt-drawer-section">
        <div className="yt-drawer-title">Explorar</div>
        {shelves.filter((shelf) => shelf.channels).map((shelf) => navItem(shelf.feed, SHELF_ICONS[shelf.id], shelf.title.split(' · ')[0], shelf.count))}
      </div>}
      {brazilianGroups.length > 0 && <div className="yt-drawer-section">
        <div className="yt-drawer-title">Categorias da lista</div>
        {sidebarGroups.map((group) => navItem(`group:${group}`, <span className="yt-group-dot" style={{ ['--hue' as string]: hueFor(group) }}>{initials(groupLabel(group))}</span>, groupLabel(group), groupCounts.get(group) || 0))}
        {brazilianGroups.length > SIDEBAR_GROUP_LIMIT && <button className="yt-nav" onClick={() => setShowAllGroups((value) => !value)}><ChevronRight size={20} className={showAllGroups ? 'yt-rot-up' : 'yt-rot-down'} /><span className="yt-nav-label">{showAllGroups ? 'Mostrar menos' : `Mostrar mais (${brazilianGroups.length - SIDEBAR_GROUP_LIMIT})`}</span></button>}
      </div>}
      {foreignGroups.length > 0 && <div className="yt-drawer-section">
        <div className="yt-drawer-title"><Globe size={18} /> Internacionais</div>
        {(showAllForeign ? foreignGroups : foreignGroups.slice(0, 5)).map((group) => navItem(`group:${group}`, <span className="yt-group-dot" style={{ ['--hue' as string]: hueFor(group) }}>{initials(groupLabel(group))}</span>, groupLabel(group), groupCounts.get(group) || 0))}
        {foreignGroups.length > 5 && <button className="yt-nav" onClick={() => setShowAllForeign((value) => !value)}><ChevronRight size={20} className={showAllForeign ? 'yt-rot-up' : 'yt-rot-down'} /><span className="yt-nav-label">{showAllForeign ? 'Mostrar menos' : `Mostrar mais (${foreignGroups.length - 5})`}</span></button>}
      </div>}
      <div className="yt-drawer-section yt-drawer-foot">
        <button className="yt-nav" onClick={props.onImport}><Upload size={20} /><span className="yt-nav-label">Importar playlist</span></button>
        <button className="yt-nav" onClick={props.onExport}><Download size={20} /><span className="yt-nav-label">Exportar M3U</span></button>
      </div>
    </aside>

    <main className="yt-main">
      <div className="yt-chips-wrap">
        {chipsScroll.left && <button className="yt-chips-arrow left" onClick={() => scrollChips(-1)} aria-label="Categorias anteriores"><ChevronLeft size={20} /></button>}
        <div className="yt-chips" ref={chipsRef} onScroll={updateChipArrows}>
          {chips.map((chip) => <button key={chip.id} className={chip.id === feed ? 'yt-chip active' : 'yt-chip'} onClick={() => choose(chip.id)}>{chip.label}</button>)}
        </div>
        {chipsScroll.right && <button className="yt-chips-arrow right" onClick={() => scrollChips(1)} aria-label="Mais categorias"><ChevronRight size={20} /></button>}
      </div>

      {(key || feedTitle) && <div className="yt-feed-head">
        <h1>{key ? <>Resultados para “{query.trim()}”</> : feedTitle}</h1>
        <span>{total.toLocaleString('pt-BR')} {total === 1 ? 'resultado' : 'resultados'}{key && feedTitle ? ` em ${feedTitle}` : ''}</span>
        {feed === 'recent' && recents.length > 0 && <button className="yt-clear-history" onClick={() => { if (window.confirm('Apagar todo o histórico de canais vistos?')) props.onClearRecents() }}><Trash2 size={16} /> Limpar histórico</button>}
      </div>}

      {showShelf && <>
        {recents.length > 0 && <section className="yt-shelf">
          <div className="yt-shelf-head"><Clock3 size={20} /><h2>Continuar assistindo</h2><button className="yt-shelf-secondary" onClick={() => { if (window.confirm('Apagar todo o histórico de canais vistos?')) props.onClearRecents() }} title="Apagar o histórico de canais vistos">Limpar</button><button onClick={() => choose('recent')}>Ver tudo</button></div>
          <div className="yt-shelf-row">
            {recents.slice(0, SHELF_SIZE).map((channel) => <ChannelCard key={`recent-${channel.id}`} channel={channel} group={groupOf(channel)} favorite={isFavorite(channel)} onPlay={() => onPlay(channel)} onToggleFavorite={() => onToggleFavorite(channel)} />)}
          </div>
        </section>}
        {favorites.length > 0 && <section className="yt-shelf">
          <div className="yt-shelf-head"><Star size={20} /><h2>Seus favoritos</h2><button onClick={() => choose('favorites')}>Ver tudo</button></div>
          <div className="yt-shelf-row">
            {favorites.slice(0, SHELF_SIZE).map((channel) => <ChannelCard key={`fav-${channel.id}`} channel={channel} group={groupOf(channel)} favorite onPlay={() => onPlay(channel)} onToggleFavorite={() => onToggleFavorite(channel)} />)}
          </div>
        </section>}
        {shelves.map((shelf) => <section key={shelf.id} className="yt-shelf">
          <div className="yt-shelf-head">{SHELF_ICONS[shelf.id]}<h2>{shelf.title}</h2><small>{shelf.count.toLocaleString('pt-BR')}</small><button onClick={() => choose(shelf.feed)}>Ver tudo</button></div>
          <div className="yt-shelf-row">
            {shelf.channels?.map((channel) => <ChannelCard key={`${shelf.id}-${channel.id}`} channel={channel} group={groupOf(channel)} favorite={isFavorite(channel)} onPlay={() => onPlay(channel)} onToggleFavorite={() => onToggleFavorite(channel)} />)}
            {shelf.media?.map((item) => <MediaCard key={`${shelf.id}-${item.id}`} item={item} onOpen={() => item.kind === 'movie' ? onPlayMovie(item) : onOpenSeries(item)} />)}
          </div>
        </section>)}
        <div className="yt-shelf-head yt-shelf-head-all"><Tv size={20} /><h2>Todos os canais brasileiros</h2><small>{liveResults.length.toLocaleString('pt-BR')}</small></div>
      </>}

      {total === 0
        ? <div className="yt-empty"><Search size={34} /><strong>{key ? 'Nada encontrado' : 'Nenhum item aqui ainda'}</strong><span>{key ? 'Tente outro nome ou procure em “Tudo”.' : feed === 'favorites' ? 'Toque na estrela de um canal para favoritá-lo.' : 'Escolha outra categoria acima.'}</span>{key && feed !== 'all' && <button onClick={() => setFeed('all')}>Pesquisar em tudo</button>}</div>
        : <div className="yt-grid">
          {visibleLive.map((channel) => <ChannelCard key={channel.id} channel={channel} group={groupOf(channel)} favorite={isFavorite(channel)} onPlay={() => onPlay(channel)} onToggleFavorite={() => onToggleFavorite(channel)} extra={feed === 'recent' ? <button className="yt-card-remove" aria-label={`Remover ${channel.name} do histórico`} title="Remover do histórico" onClick={() => props.onRemoveRecent(channel)}><X size={16} /></button> : undefined} />)}
          {visibleMedia.map((item) => <MediaCard key={item.id} item={item} onOpen={() => item.kind === 'movie' ? onPlayMovie(item) : onOpenSeries(item)} />)}
        </div>}
      {total > limit && <div ref={sentinelRef} className="yt-sentinel"><button onClick={() => setLimit((value) => value + PAGE_SIZE)}>Carregar mais</button></div>}
    </main>
  </div>
}
