import { useEffect, useMemo, useState } from 'react'
import { Clapperboard, Film, LayoutGrid, List, Radio, Star } from 'lucide-react'
import type { Channel, MediaItem } from '../types'
import { ChannelCard, MediaCard } from './HomeFeed'
import { cleanCategoryLabel, dedupeTitles, matchesQuery, normalizeText, sortMedia } from '../lib/mediaCatalog'
import { useAutoLimit } from '../lib/useAutoLimit'
import { usePreference } from '../lib/preferences'

export type AdultTab = 'live' | 'movie' | 'series'
type Tab = AdultTab
export const ADULT_TAB_LABELS: Record<Tab, string> = { live: 'Canais', movie: 'Filmes', series: 'Séries' }
export const ADULT_TAB_ICONS: Record<Tab, JSX.Element> = { live: <Radio size={16} />, movie: <Film size={16} />, series: <Clapperboard size={16} /> }
const GENERAL = 'Geral'

type Props = {
  channels: Channel[]
  media: MediaItem[]
  query: string
  isFavorite: (channel: Channel) => boolean
  isActive: (channel: Channel) => boolean
  onPlayChannel: (channel: Channel) => void
  onToggleFavorite: (channel: Channel) => void
  onOpenMedia: (item: MediaItem) => void
  tab: Tab
  subgroup: string
  onTabChange: (tab: Tab) => void
  onSubgroupChange: (subgroup: string) => void
}

// Parts of a provider category that say nothing beyond "this is adult content".
const GENERIC_PART = /^(?:canais?|filmes?|movies?|vods?|s[ée]ries?|\+ ?18|18 ?\+|x{3,}|adult[oa]s?|adult|conte[uú]do adulto|hot|geral|outros|todos)$/i

/**
 * Provider subgroup inside the +18 area:
 * "FILMES | +18 | Amador" → "Amador", "Adultos [OnlyFans] [Privacy]" → "OnlyFans · Privacy",
 * "Adultos [24HR]" / "24 Horas" → "24 horas".
 */
function adultSubgroup(text: string) {
  const parts = text.split('|')
    .map((part) => part
      .replace(/\b(?:adult[oa]s?|adult|xxx+|\+ ?18|18 ?\+)\b/gi, ' ')
      .replace(/\[([^\]]*)\]/g, ' · $1 ')
      .replace(/^[\s·:-]+|[\s·:-]+$/g, '')
      .replace(/\s*·\s*/g, ' · ')
      .trim())
    .filter((part) => part && !GENERIC_PART.test(part))
  const last = parts.at(-1)
  if (!last) return GENERAL
  if (/^(24 ?h(rs?)?|24 ?horas)$/i.test(last)) return '24 horas'
  return cleanCategoryLabel(last)
}

/** First word of a channel name, used to group big "Geral" lists by studio/brand (Dorcel, Eroluxe…). */
function brandOf(name: string) {
  const word = normalizeText(name).split(' ').find((part) => part.length > 2 && !/^(tv|hd|fhd|sd|4k|xxx|the|canal|channel)$/.test(part))
  return word || ''
}
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)

/** Subgroup for each channel; "Geral" channels are split by brand when a brand has 3+ channels. */
function channelSubgroups(channels: Channel[]) {
  const base = new Map(channels.map((channel) => [channel.id, adultSubgroup(channel.sourceGroup || channel.subgroup || channel.group || '')]))
  const brandCount = new Map<string, number>()
  for (const channel of channels) if (base.get(channel.id) === GENERAL) { const brand = brandOf(channel.name); if (brand) brandCount.set(brand, (brandCount.get(brand) || 0) + 1) }
  const result = new Map<string, string>()
  for (const channel of channels) {
    const group = base.get(channel.id) || GENERAL
    if (group !== GENERAL) { result.set(channel.id, group); continue }
    const brand = brandOf(channel.name)
    result.set(channel.id, brand && (brandCount.get(brand) || 0) >= 3 ? capitalize(brand) : 'Outros canais')
  }
  return result
}

/**
 * Separate +18 area: live channels, movies and series kept out of the rest of
 * the app. Subgroups (from the provider, or by studio for generic lists) sit
 * in a side column on wide screens and in a chip row on phones.
 */

/** Everything the +18 menu and content need: counts per type and the subgroups of the chosen type. */
export function useAdultCatalog(channels: Channel[], media: MediaItem[], tab: Tab) {
  const movies = useMemo(() => media.filter((item) => item.kind === 'movie'), [media])
  const series = useMemo(() => media.filter((item) => item.kind === 'series'), [media])
  const counts: Record<Tab, number> = { live: channels.length, movie: movies.length, series: series.length }
  const tabs = (Object.keys(ADULT_TAB_LABELS) as Tab[]).filter((value) => counts[value] > 0)
  const channelGroup = useMemo(() => channelSubgroups(channels), [channels])
  const source: Array<Channel | MediaItem> = tab === 'live' ? channels : tab === 'movie' ? movies : series
  const subgroups = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of source) { const group = 'url' in entry ? channelGroup.get(entry.id) || GENERAL : adultSubgroup(entry.category); map.set(group, (map.get(group) || 0) + 1) }
    // Biggest first, generic buckets last.
    return Array.from(map.entries()).sort((a, b) => Number(a[0] === 'Outros canais' || a[0] === GENERAL) - Number(b[0] === 'Outros canais' || b[0] === GENERAL) || b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))
  }, [source, channelGroup])
  return { movies, series, counts, tabs, channelGroup, subgroups, total: source.length }
}

export default function AdultArea({ channels, media, query, isFavorite, isActive, onPlayChannel, onToggleFavorite, onOpenMedia, tab, subgroup, onTabChange, onSubgroupChange }: Props) {
  const { movies, series, tabs, channelGroup, subgroups } = useAdultCatalog(channels, media, tab)
  const [view, setView] = usePreference('streamhub-adult-view', 'grid', ['grid', 'list'] as const)
  const [onlyFavorites, setOnlyFavorites] = useState(false)

  useEffect(() => { if (!tabs.includes(tab) && tabs[0]) onTabChange(tabs[0]) }, [tabs.join(','), tab])
  useEffect(() => { setOnlyFavorites(false) }, [tab])

  const visibleChannels = useMemo(() => tab !== 'live' ? [] : channels
    .filter((channel) => subgroup === 'Todos' || channelGroup.get(channel.id) === subgroup)
    .filter((channel) => !onlyFavorites || isFavorite(channel))
    .filter((channel) => matchesQuery({ id: channel.id, name: channel.name, kind: 'movie', category: '' }, query)), [tab, channels, channelGroup, subgroup, onlyFavorites, query])
  const visibleMedia = useMemo(() => tab === 'live' ? [] : sortMedia(dedupeTitles((tab === 'movie' ? movies : series)
    .filter((item) => subgroup === 'Todos' || adultSubgroup(item.category) === subgroup)
    .filter((item) => matchesQuery(item, query))), 'recent'), [tab, movies, series, subgroup, query])
  // Channels: all at once. Posters: load by themselves while scrolling.
  const { limit, hasMore, sentinelRef } = useAutoLimit(visibleMedia.length, `${tab}|${subgroup}|${query}`)
  const total = tab === 'live' ? visibleChannels.length : visibleMedia.length

  if (!tabs.length) return <div className="empty-list">Nenhum conteúdo +18 nesta lista.</div>

  return <div className="adult-layout">
    {/* Phones/tablets: the menu lives here as chip rows; on wide screens it is in the left sidebar. */}
    <div className="adult-chips">
      <div className="adult-tabs" role="tablist" aria-label="Tipo de conteúdo">
        {tabs.map((value) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => onTabChange(value)}>{ADULT_TAB_ICONS[value]}<span>{ADULT_TAB_LABELS[value]}</span></button>)}
      </div>
      {subgroups.length > 1 && <nav className="adult-groups" aria-label="Subgrupos">
        <button className={subgroup === 'Todos' ? 'active' : ''} onClick={() => onSubgroupChange('Todos')}><span>Todos</span></button>
        {subgroups.map(([name, count]) => <button key={name} className={subgroup === name ? 'active' : ''} onClick={() => onSubgroupChange(name)}><span>{name}</span><small>{count.toLocaleString('pt-BR')}</small></button>)}
      </nav>}
    </div>

    <div className="adult-main">
      <div className="adult-toolbar">
        <strong>{subgroup === 'Todos' ? `Todos os ${ADULT_TAB_LABELS[tab].toLowerCase()}` : subgroup}</strong>
        <span>{total.toLocaleString('pt-BR')} {tab === 'live' ? (total === 1 ? 'canal' : 'canais') : (total === 1 ? 'título' : 'títulos')}</span>
        {tab === 'live' && <button className={onlyFavorites ? 'active' : ''} aria-pressed={onlyFavorites} onClick={() => setOnlyFavorites((value) => !value)}><Star size={14} fill={onlyFavorites ? 'currentColor' : 'none'} /> Favoritos</button>}
        {tab === 'live' && <div className="adult-view" role="group" aria-label="Visualização"><button aria-pressed={view === 'grid'} className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} title="Grade"><LayoutGrid size={16} /></button><button aria-pressed={view === 'list'} className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} title="Lista"><List size={16} /></button></div>}
      </div>

      {tab === 'live'
        ? <div className={view === 'list' ? 'adult-list' : 'yt-grid yt-channel-grid adult-grid'}>{visibleChannels.map((channel) => view === 'list'
          ? <button key={channel.id} className={isActive(channel) ? 'adult-row active' : 'adult-row'} onClick={() => onPlayChannel(channel)}>
            {channel.logo ? <img src={channel.logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} /> : <span className="adult-row-logo">+18</span>}
            <strong>{channel.name}</strong>
            <small>{channelGroup.get(channel.id)}</small>
            <span role="button" tabIndex={0} className={isFavorite(channel) ? 'adult-row-fav active' : 'adult-row-fav'} onClick={(event) => { event.stopPropagation(); onToggleFavorite(channel) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); onToggleFavorite(channel) } }} aria-label="Favoritar"><Star size={15} fill={isFavorite(channel) ? 'currentColor' : 'none'} /></span>
          </button>
          : <ChannelCard key={channel.id} channel={channel} group={channelGroup.get(channel.id) || ''} favorite={isFavorite(channel)} active={isActive(channel)} onPlay={() => onPlayChannel(channel)} onToggleFavorite={() => onToggleFavorite(channel)} />)}</div>
        : <div className="yt-grid yt-media-grid adult-grid">{visibleMedia.slice(0, limit).map((item) => <MediaCard key={item.id} item={item} subtitle={adultSubgroup(item.category)} onOpen={() => onOpenMedia(item)} />)}</div>}
      {tab !== 'live' && hasMore && <div ref={sentinelRef} className="yt-sentinel auto-sentinel" aria-hidden="true" />}
      {!total && <div className="empty-list">Nada encontrado{query.trim() ? ` para "${query.trim()}"` : ''}.</div>}
    </div>
  </div>
}
