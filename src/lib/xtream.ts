import type { Channel, MediaItem, Playlist, XtreamConnection } from '../types'

export function fetchXtream(connection: XtreamConnection, action?: string, parameters: Record<string, string> = {}) {
  return fetch('/api/xtream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...connection, action, ...parameters }),
  })
}

export function inferXtreamConnection(channels: Channel[]): XtreamConnection | null {
  for (const channel of channels) {
    try {
      const url = new URL(channel.url)
      const match = url.pathname.match(/^\/live\/([^/]+)\/([^/]+)\//)
      if (match) return { server: url.origin, username: decodeURIComponent(match[1]), password: decodeURIComponent(match[2]) }
    } catch { /* try the next channel */ }
  }
  return null
}

export async function loadMediaCatalog(connection: XtreamConnection): Promise<MediaItem[]> {
  const [vodCategoriesResponse, vodResponse, seriesCategoriesResponse, seriesResponse] = await Promise.all([
    fetchXtream(connection, 'get_vod_categories'),
    fetchXtream(connection, 'get_vod_streams'),
    fetchXtream(connection, 'get_series_categories'),
    fetchXtream(connection, 'get_series'),
  ])
  const vodCategories = vodCategoriesResponse.ok ? await vodCategoriesResponse.json() as Array<{ category_id?: string | number; category_name?: string }> : []
  const seriesCategories = seriesCategoriesResponse.ok ? await seriesCategoriesResponse.json() as Array<{ category_id?: string | number; category_name?: string }> : []
  const vodCategoryMap = new Map(vodCategories.map((item) => [String(item.category_id), item.category_name || 'Filmes']))
  const seriesCategoryMap = new Map(seriesCategories.map((item) => [String(item.category_id), item.category_name || 'Séries']))
  const movies = vodResponse.ok ? await vodResponse.json() as Array<{ stream_id?: string | number; name?: string; category_id?: string | number; stream_icon?: string; container_extension?: string; rating?: string | number; added?: string | number; year?: string | number }> : []
  const series = seriesResponse.ok ? await seriesResponse.json() as Array<{ series_id?: string | number; name?: string; category_id?: string | number; cover?: string; genre?: string; rating?: string | number; last_modified?: string | number; releaseDate?: string; release_date?: string; year?: string | number }> : []
  const num = (value: unknown) => { const parsed = Number.parseFloat(String(value ?? '')); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined }
  const yearOf = (value: unknown) => { const match = String(value ?? '').match(/(19|20)\d{2}/); return match ? Number(match[0]) : undefined }
  const movieItems: MediaItem[] = movies.filter((item) => item.stream_id != null && item.name).map((item) => ({
    id: `movie-${item.stream_id}`,
    name: item.name || 'Filme sem nome',
    kind: 'movie',
    category: vodCategoryMap.get(String(item.category_id)) || 'Filmes',
    poster: item.stream_icon || undefined,
    rating: num(item.rating),
    added: num(item.added),
    year: yearOf(item.year),
    streamUrl: `${connection.server}/movie/${encodeURIComponent(connection.username)}/${encodeURIComponent(connection.password)}/${item.stream_id}.${String(item.container_extension || 'mp4').replace(/^\./, '')}`,
  }))
  const seriesItems: MediaItem[] = series.filter((item) => item.series_id != null && item.name).map((item) => ({
    id: `series-${item.series_id}`,
    name: item.name || 'Série sem nome',
    kind: 'series',
    category: seriesCategoryMap.get(String(item.category_id)) || 'Séries',
    poster: item.cover || undefined,
    seriesId: String(item.series_id),
    genre: item.genre || undefined,
    rating: num(item.rating),
    added: num(item.last_modified),
    year: yearOf(item.year || item.releaseDate || item.release_date),
  }))
  return [...movieItems, ...seriesItems]
}

export function channelStreamId(channel: Channel) {
  if (channel.streamId) return channel.streamId
  try { return new URL(channel.url).pathname.match(/\/([^/]+)\.[^.]+$/)?.[1] || '' } catch { return '' }
}

export function normalizeServer(value: string) {
  const raw = value.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(raw)) return raw ? `http://${raw}` : ''
  return raw
}

export function xtreamTsFallback(url: string) {
  if (!/\/live\//i.test(url) || !/\.m3u8(?:$|\?)/i.test(url)) return null
  return url.replace(/\.m3u8(?=$|\?)/i, '.ts')
}

export function createPlaylist(name: string, channels: Channel[]): Playlist {
  return { id: crypto.randomUUID(), name, channels, importedAt: new Date().toISOString() }
}
