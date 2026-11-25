import { useEffect, useMemo, useState } from 'react'
import { Bookmark, BookmarkCheck, Check, ChevronLeft, LoaderCircle, Play, RotateCcw, Star, Youtube } from 'lucide-react'
import type { Channel, MediaItem, XtreamConnection } from '../types'
import { fetchXtream } from '../lib/xtream'
import { cleanCategoryLabel, itemYear } from '../lib/mediaCatalog'
import { formatRemaining, markWatched, toggleMyList, useWatchState } from '../lib/watchState'

type Info = {
  plot?: string
  cast?: string
  director?: string
  genre?: string
  release?: string
  rating?: number
  duration?: string
  trailer?: string
  backdrop?: string
  poster?: string
}

type Season = { number: string; name: string; episodes: Channel[] }

type Props = {
  item: MediaItem
  connection: XtreamConnection | null
  onBack: () => void
  backLabel: string
  /** Plays a movie or an episode; `queue` is the series' episode order for "next episode". */
  onPlay: (channel: Channel, queue?: Channel[]) => void
}

const pick = (...values: unknown[]) => values.map((value) => (Array.isArray(value) ? value[0] : value)).find((value) => typeof value === 'string' && value.trim()) as string | undefined
const numeric = (value: unknown) => { const parsed = Number.parseFloat(String(value ?? '')); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined }
const extension = (value: unknown) => String(value || 'mp4').replace(/^\./, '')

function parseInfo(raw: Record<string, unknown> | undefined, item: MediaItem): Info {
  const info = raw || {}
  const minutes = numeric(info.episode_run_time) || (numeric(info.duration_secs) ? Math.round(numeric(info.duration_secs)! / 60) : undefined)
  return {
    plot: pick(info.plot, info.description),
    cast: pick(info.cast, info.actors),
    director: pick(info.director),
    genre: pick(info.genre),
    release: pick(info.releasedate, info.releaseDate, info.release_date, info.year),
    rating: numeric(info.rating) || item.rating,
    duration: pick(info.duration) || (minutes ? `${minutes} min` : undefined),
    trailer: pick(info.youtube_trailer),
    backdrop: pick(info.backdrop_path),
    poster: pick(info.cover_big, info.movie_image, info.cover) || item.poster,
  }
}

/** Details page for a movie or a series: synopsis, cast, trailer, seasons and episodes, resume. */
export default function MediaDetails({ item, connection, onBack, backLabel, onPlay }: Props) {
  const watch = useWatchState()
  const [info, setInfo] = useState<Info | null>(null)
  const [seasons, setSeasons] = useState<Season[]>([])
  const [season, setSeason] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const isSeries = item.kind === 'series'
  const id = item.id.replace(/^(movie|series)-/, '')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setFailed(false); setInfo(null); setSeasons([]); setSeason(null)
    if (!connection) { setLoading(false); setInfo(parseInfo(undefined, item)); return }
    ;(async () => {
      try {
        const response = await fetchXtream(connection, isSeries ? 'get_series_info' : 'get_vod_info', isSeries ? { series_id: item.seriesId || id } : { vod_id: id })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json() as {
          info?: Record<string, unknown>
          seasons?: Array<{ season_number?: number | string; name?: string }>
          episodes?: Record<string, Array<{ id?: string | number; episode_num?: number | string; title?: string; container_extension?: string; info?: { movie_image?: string; plot?: string; duration?: string } }>>
        }
        if (cancelled) return
        setInfo(parseInfo(data.info, item))
        if (isSeries) {
          const names = new Map((data.seasons || []).map((entry) => [String(entry.season_number), entry.name]))
          const list: Season[] = Object.entries(data.episodes || {})
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([number, episodes]) => ({
              number,
              name: names.get(number) && !/^season \d+$/i.test(names.get(number) || '') ? names.get(number)! : `Temporada ${number}`,
              episodes: episodes.map((episode, index) => {
                const episodeNumber = episode.episode_num || index + 1
                return {
                  kind: 'series' as const,
                  id: `episode-${item.seriesId || id}-${episode.id || `${number}-${index}`}`,
                  mediaId: item.id,
                  episodeLabel: `T${number} · E${episodeNumber}`,
                  name: episode.title && !/^\s*$/.test(episode.title) ? episode.title : `${item.name} · T${number} E${episodeNumber}`,
                  url: `${connection.server}/series/${encodeURIComponent(connection.username)}/${encodeURIComponent(connection.password)}/${episode.id}.${extension(episode.container_extension)}`,
                  group: 'Séries',
                  subgroup: `${item.name} · T${number} · E${episodeNumber}`,
                  logo: episode.info?.movie_image || item.poster,
                  description: episode.info?.plot || undefined,
                  duration: episode.info?.duration || undefined,
                }
              }),
            }))
          setSeasons(list)
        }
      } catch {
        if (!cancelled) { setFailed(true); setInfo(parseInfo(undefined, item)) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [item.id, connection?.server])

  const queue = useMemo(() => seasons.flatMap((entry) => entry.episodes), [seasons])
  // Season to show: the one with the episode to continue, else the first.
  const nextEpisode = useMemo(() => {
    if (!queue.length) return null
    const inProgress = queue.filter((episode) => watch.progress[episode.id]).sort((a, b) => watch.progress[b.id].updatedAt - watch.progress[a.id].updatedAt)[0]
    if (inProgress) return inProgress
    let lastWatched = -1
    queue.forEach((episode, index) => { if (watch.watched[episode.id]) lastWatched = index })
    return queue[Math.min(lastWatched + 1, queue.length - 1)]
  }, [queue, watch])
  useEffect(() => {
    if (season || !seasons.length) return
    setSeason(seasons.find((entry) => entry.episodes.some((episode) => episode.id === nextEpisode?.id))?.number || seasons[0].number)
  }, [seasons, nextEpisode])

  const movieChannel: Channel = { kind: 'movie', id: item.id, mediaId: item.id, name: item.name, url: item.streamUrl || '', group: 'Filmes', subgroup: cleanCategoryLabel(item.category), logo: item.poster }
  const movieProgress = !isSeries ? watch.progress[item.id] : undefined
  const nextProgress = nextEpisode ? watch.progress[nextEpisode.id] : undefined
  const inList = watch.myList.some((entry) => entry.id === item.id)
  const year = itemYear(item) || (info?.release ? Number(info.release.match(/(19|20)\d{2}/)?.[0]) || undefined : undefined)
  const current = seasons.find((entry) => entry.number === season)
  const facts = [year, info?.duration, info?.genre || cleanCategoryLabel(item.category)].filter(Boolean)

  const primary = isSeries
    ? nextEpisode && { label: nextProgress ? `Continuar ${nextEpisode.episodeLabel}` : watch.watched[queue[0]?.id] ? `Assistir ${nextEpisode.episodeLabel}` : 'Assistir do início', run: () => onPlay(nextEpisode, queue) }
    : item.streamUrl && { label: movieProgress ? 'Continuar' : 'Assistir', run: () => onPlay(movieChannel) }

  return <article className="media-details">
    <button className="series-back" onClick={onBack}><ChevronLeft size={16} /> {backLabel}</button>
    <div className="md-hero" style={info?.backdrop ? { ['--backdrop' as string]: `url("${info.backdrop}")` } : undefined}>
      <div className="md-poster">{(info?.poster || item.poster) ? <img src={info?.poster || item.poster} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <span>{item.name.slice(0, 2).toUpperCase()}</span>}</div>
      <div className="md-info">
        <span className="eyebrow">{isSeries ? 'SÉRIE' : 'FILME'}</span>
        <h2>{item.name}</h2>
        <div className="md-facts">
          {info?.rating ? <span className="md-rating"><Star size={14} fill="currentColor" /> {info.rating.toFixed(1)}</span> : null}
          {facts.map((fact) => <span key={String(fact)}>{fact}</span>)}
        </div>
        <div className="md-actions">
          {primary && <button className="md-play" onClick={primary.run}><Play size={18} fill="currentColor" /> {primary.label}</button>}
          {movieProgress && <button className="md-secondary" onClick={() => { markWatched(item.id, false); onPlay(movieChannel) }} title="Começar do início"><RotateCcw size={16} /> Do início</button>}
          <button className={inList ? 'md-secondary active' : 'md-secondary'} onClick={() => toggleMyList(item)} aria-pressed={inList}>{inList ? <BookmarkCheck size={17} /> : <Bookmark size={17} />} {inList ? 'Na minha lista' : 'Minha lista'}</button>
          {info?.trailer && <a className="md-secondary" href={`https://www.youtube.com/watch?v=${encodeURIComponent(info.trailer)}`} target="_blank" rel="noreferrer"><Youtube size={17} /> Trailer</a>}
        </div>
        {movieProgress && <div className="md-progress"><span className="md-track"><span style={{ width: `${(movieProgress.position / movieProgress.duration) * 100}%` }} /></span><small>{formatRemaining(movieProgress)}</small></div>}
        {loading ? <p className="md-plot muted"><LoaderCircle size={15} className="spin" /> Carregando informações…</p>
          : <>
            {info?.plot ? <p className="md-plot">{info.plot}</p> : <p className="md-plot muted">{failed ? 'Não foi possível carregar a sinopse agora.' : 'Sem sinopse disponível.'}</p>}
            {(info?.cast || info?.director) && <dl className="md-credits">
              {info?.director && <div><dt>Direção</dt><dd>{info.director}</dd></div>}
              {info?.cast && <div><dt>Elenco</dt><dd>{info.cast}</dd></div>}
            </dl>}
          </>}
      </div>
    </div>

    {isSeries && <section className="md-seasons">
      {loading ? <div className="empty-list"><LoaderCircle className="spin" size={22} /> Carregando episódios…</div>
        : !seasons.length ? <div className="empty-list">Nenhum episódio encontrado.</div>
          : <>
            <div className="md-season-tabs" role="tablist" aria-label="Temporadas">
              {seasons.map((entry) => {
                const done = entry.episodes.every((episode) => watch.watched[episode.id])
                return <button key={entry.number} role="tab" aria-selected={season === entry.number} className={season === entry.number ? 'active' : ''} onClick={() => setSeason(entry.number)}>{entry.name}{done && <Check size={13} />}</button>
              })}
            </div>
            <ol className="md-episodes">
              {current?.episodes.map((episode, index) => {
                const progress = watch.progress[episode.id]
                const watched = Boolean(watch.watched[episode.id])
                return <li key={episode.id} className={[watched && 'watched', nextEpisode?.id === episode.id && 'next'].filter(Boolean).join(' ')}>
                  <button className="md-episode" onClick={() => onPlay(episode, queue)}>
                    <span className="md-episode-thumb">
                      {episode.logo ? <img src={episode.logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}
                      <Play size={20} fill="currentColor" />
                      {progress && <span className="md-episode-bar"><span style={{ width: `${(progress.position / progress.duration) * 100}%` }} /></span>}
                    </span>
                    <span className="md-episode-text">
                      <strong>{index + 1}. {episode.name}</strong>
                      <small>{[episode.episodeLabel, episode.duration, progress ? formatRemaining(progress) : watched ? 'Assistido' : ''].filter(Boolean).join(' · ')}</small>
                      {episode.description && <p>{episode.description}</p>}
                    </span>
                  </button>
                  <button className={watched ? 'md-watched active' : 'md-watched'} onClick={() => markWatched(episode.id, !watched)} title={watched ? 'Marcar como não assistido' : 'Marcar como assistido'} aria-pressed={watched}><Check size={16} /></button>
                </li>
              })}
            </ol>
          </>}
    </section>}
  </article>
}
