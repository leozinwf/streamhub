import { useEffect, useMemo, useState } from 'react'
import { Bookmark, Clock3, Film, Clapperboard, Play, Star, LayoutGrid, Sparkles } from 'lucide-react'
import { formatRemaining, useWatchState } from '../lib/watchState'
import type { MediaItem } from '../types'
import { MediaCard } from './HomeFeed'
import { useAutoLimit } from '../lib/useAutoLimit'
import {
  ADULT_GENRE, ALL_GENRES, cleanCategoryLabel, compareGenres, dedupeTitles, isAdult, itemGenres, itemYear, matchesQuery,
  mediaSubtitle, sortMedia, type MediaSort,
} from '../lib/mediaCatalog'

const SHELF_SIZE = 12
const SORT_LABELS: Record<MediaSort, string> = { recent: 'Adicionados recentemente', rating: 'Mais bem avaliados', year: 'Mais novos', az: 'A–Z' }

/** "Ver tudo" on the recent/top-rated shelves opens the full catalog list sorted that way. */
export const ALL_GENRES_VIEW_ALL = 'Catálogo completo'
export const MY_LIST = 'Minha lista'

export type GenreCount = { genre: string; count: number }

/** Genres present in a list of titles, in display order, with how many titles each has. */
export function useGenres(items: MediaItem[]) {
  return useMemo(() => {
    const byGenre = new Map<string, MediaItem[]>()
    for (const item of items) {
      for (const genre of itemGenres(item)) {
        const list = byGenre.get(genre)
        if (list) list.push(item)
        else byGenre.set(genre, [item])
      }
    }
    const counts: GenreCount[] = Array.from(byGenre.entries())
      .map(([genre, list]) => ({ genre, count: list.length }))
      .sort((a, b) => compareGenres(a.genre, b.genre))
    return { byGenre, counts }
  }, [items])
}

type Props = {
  kind: 'movie' | 'series'
  items: MediaItem[]
  query: string
  genre: string
  onGenreChange: (genre: string) => void
  onOpen: (item: MediaItem) => void
}

export default function MediaLibrary({ kind, items, query, genre, onGenreChange, onOpen }: Props) {
  const { byGenre, counts } = useGenres(items)
  const watch = useWatchState()
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const myList = useMemo(() => watch.myList.filter((item) => item.kind === kind && byId.has(item.id)).map((item) => byId.get(item.id)!), [watch.myList, kind, byId])
  // Unfinished movies/episodes of this catalog, newest first (one card per series).
  const resume = useMemo(() => {
    const seen = new Set<string>()
    return Object.values(watch.progress)
      .filter((entry) => entry.kind === kind && byId.has(entry.mediaId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((entry) => !seen.has(entry.mediaId) && seen.add(entry.mediaId))
  }, [watch.progress, kind, byId])
  const [category, setCategory] = useState('Todas')
  const [sort, setSort] = useState<MediaSort>('recent')
  const hasDates = useMemo(() => items.some((item) => item.added), [items])
  const hasRatings = useMemo(() => items.some((item) => item.rating), [items])

  useEffect(() => { setCategory('Todas') }, [genre, kind])
  useEffect(() => { if (!hasDates && sort === 'recent') setSort('az') }, [hasDates, sort])

  const inGenre = useMemo(() => genre === ALL_GENRES ? items
    : genre === MY_LIST ? myList
    : genre === ALL_GENRES_VIEW_ALL ? items.filter((item) => !isAdult(item))
      : byGenre.get(genre) || [], [genre, items, byGenre, myList])
  // Provider categories inside the chosen genre ("Ação", "Ação 4K", "Ação Legendados"…).
  const categories = useMemo(() => {
    if (genre === ALL_GENRES || genre === ALL_GENRES_VIEW_ALL || genre === MY_LIST) return []
    const labels = new Map<string, number>()
    for (const item of inGenre) {
      const label = cleanCategoryLabel(item.category)
      labels.set(label, (labels.get(label) || 0) + 1)
    }
    return Array.from(labels.entries()).sort((a, b) => b[1] - a[1])
  }, [genre, inGenre])

  const searching = query.trim().length > 0
  const results: MediaItem[] = useMemo(() => {
    if (!searching && genre === ALL_GENRES) return []
    // A search with no genre chosen looks through the whole catalog, adult titles excluded.
    let list = genre === ALL_GENRES ? items.filter((item) => !isAdult(item)) : inGenre
    if (category !== 'Todas') list = list.filter((item) => cleanCategoryLabel(item.category) === category)
    if (searching) list = list.filter((item) => matchesQuery(item, query))
    return sortMedia(dedupeTitles(list), sort)
  }, [searching, genre, items, inGenre, category, query, sort])

  const { limit, hasMore, sentinelRef } = useAutoLimit(results.length, `${genre}|${kind}|${query}|${category}|${sort}`)

  const shelves = useMemo(() => {
    if (searching || genre !== ALL_GENRES) return []
    const rows: Array<{ id: string; title: string; icon: JSX.Element; genre?: string; items: MediaItem[]; sort?: MediaSort }> = []
    const safe = items.filter((item) => !isAdult(item))
    if (resume.length) rows.push({ id: 'resume', title: 'Continuar assistindo', icon: <Play size={20} />, items: resume.slice(0, SHELF_SIZE).map((entry) => byId.get(entry.mediaId)!) })
    if (myList.length) rows.push({ id: 'mylist', title: 'Minha lista', icon: <Bookmark size={20} />, genre: MY_LIST, items: myList.slice(0, SHELF_SIZE) })
    // Releases first: the provider's own "Lançamentos" categories, or else the newest years.
    const releases = byGenre.get('Lançamentos')?.filter((item) => !isAdult(item))
    const thisYear = new Date().getFullYear()
    const releaseList = releases?.length ? releases : safe.filter((item) => (itemYear(item) || 0) >= thisYear - 1)
    if (releaseList.length) rows.push({ id: 'Lançamentos', title: 'Lançamentos', icon: <Sparkles size={20} />, genre: releases?.length ? 'Lançamentos' : undefined, items: sortMedia(dedupeTitles(releaseList), hasDates ? 'recent' : 'year').slice(0, SHELF_SIZE), sort: releases?.length ? undefined : 'year' })
    if (hasDates) rows.push({ id: 'recent', title: 'Adicionados recentemente', icon: <Clock3 size={20} />, items: sortMedia(dedupeTitles(safe), 'recent').slice(0, SHELF_SIZE), sort: 'recent' })
    if (hasRatings) rows.push({ id: 'rating', title: 'Mais bem avaliados', icon: <Star size={20} />, items: sortMedia(dedupeTitles(safe.filter((item) => (item.rating || 0) >= 7)), 'rating').slice(0, SHELF_SIZE), sort: 'rating' })
    for (const { genre: name } of counts) {
      if (name === ADULT_GENRE || name === 'Outros' || name === 'Lançamentos') continue
      const list = sortMedia(dedupeTitles(byGenre.get(name) || []), hasDates ? 'recent' : 'az').slice(0, SHELF_SIZE)
      if (list.length) rows.push({ id: name, title: name, icon: kind === 'movie' ? <Film size={20} /> : <Clapperboard size={20} />, genre: name, items: list })
    }
    if (byGenre.get('Outros')?.length) rows.push({ id: 'Outros', title: 'Outros', icon: <LayoutGrid size={20} />, genre: 'Outros', items: sortMedia(dedupeTitles(byGenre.get('Outros') || []), 'az').slice(0, SHELF_SIZE) })
    return rows.filter((row) => row.items.length)
  }, [searching, genre, items, counts, byGenre, hasDates, hasRatings, kind, resume, myList, byId])

  const sorts = (Object.keys(SORT_LABELS) as MediaSort[]).filter((value) => (value !== 'recent' || hasDates) && (value !== 'rating' || hasRatings))

  return <div className="media-browser">
    <div className="subcategory-strip media-categories" role="tablist" aria-label="Gêneros">
      <button role="tab" aria-selected={genre === ALL_GENRES} className={genre === ALL_GENRES ? 'active' : ''} onClick={() => onGenreChange(ALL_GENRES)}>Início</button>
      {myList.length > 0 && <button role="tab" aria-selected={genre === MY_LIST} className={genre === MY_LIST ? 'active' : ''} onClick={() => onGenreChange(MY_LIST)}><Bookmark size={13} /> {MY_LIST} <small>{myList.length.toLocaleString('pt-BR')}</small></button>}
      {counts.map(({ genre: name, count }) => <button key={name} role="tab" aria-selected={genre === name} className={genre === name ? 'active' : ''} onClick={() => onGenreChange(name)}>{name} <small>{count.toLocaleString('pt-BR')}</small></button>)}
    </div>

    {shelves.length > 0 && shelves.map((row) => <section key={row.id} className="yt-shelf">
      <div className="yt-shelf-head">{row.icon}<h2>{row.title}</h2>{row.genre && <small>{(row.genre === MY_LIST ? myList.length : byGenre.get(row.genre)?.length || 0).toLocaleString('pt-BR')}</small>}<button onClick={() => { if (row.sort) setSort(row.sort); onGenreChange(row.genre || ALL_GENRES_VIEW_ALL) }}>Ver tudo</button></div>
      <div className="yt-shelf-row">{row.items.map((item, index) => {
        const entry = row.id === 'resume' ? resume[index] : undefined
        return <MediaCard key={`${row.id}-${item.id}`} item={item} subtitle={entry ? `${entry.label ? `${entry.label} · ` : ''}${formatRemaining(entry)}` : mediaSubtitle(item)} progress={entry ? entry.position / entry.duration : undefined} onOpen={() => onOpen(item)} />
      })}</div>
    </section>)}

    {(searching || genre !== ALL_GENRES) && <>
      <div className="media-toolbar">
        {categories.length > 1 && <label>Categoria do provedor
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="Todas">Todas ({inGenre.length.toLocaleString('pt-BR')})</option>
            {categories.map(([label, count]) => <option key={label} value={label}>{label} ({count.toLocaleString('pt-BR')})</option>)}
          </select>
        </label>}
        <label>Ordenar
          <select value={sort} onChange={(event) => setSort(event.target.value as MediaSort)}>
            {sorts.map((value) => <option key={value} value={value}>{SORT_LABELS[value]}</option>)}
          </select>
        </label>
        <span className="media-toolbar-count">{results.length.toLocaleString('pt-BR')} {results.length === 1 ? 'título' : 'títulos'}{searching && genre !== ALL_GENRES ? ` em ${genre}` : ''}</span>
        {searching && genre !== ALL_GENRES && <button className="media-toolbar-link" onClick={() => onGenreChange(ALL_GENRES)}>Buscar em tudo</button>}
      </div>
      <div className="yt-grid yt-media-grid">{results.slice(0, limit).map((item) => <MediaCard key={item.id} item={item} subtitle={mediaSubtitle(item)} onOpen={() => onOpen(item)} />)}</div>
      {hasMore && <div ref={sentinelRef} className="yt-sentinel auto-sentinel" aria-hidden="true" />}
      {!results.length && <div className="empty-list">Nenhum título encontrado{searching ? ` para "${query.trim()}"` : ''}.</div>}
    </>}

    {!items.length && <div className="empty-list">Nenhum {kind === 'movie' ? 'filme' : 'série'} nesta lista.</div>}
  </div>
}
