export type ChannelVariant = {
  id: string
  name: string
  url: string
  group: string
  logo?: string
  tvgId?: string
  tvgName?: string
  quality: string
  subgroup?: string
}

export type Channel = {
  kind?: 'live' | 'movie' | 'series'
  id: string
  name: string
  url: string
  group: string
  sourceGroup?: string
  subgroup?: string
  logo?: string
  tvgId?: string
  tvgName?: string
  variants?: ChannelVariant[]
  streamId?: string
  /** Movie/series catalog item this playable belongs to ("movie-1", "series-9"). */
  mediaId?: string
  /** Episode label such as "T1 · E3". */
  episodeLabel?: string
  /** Episode synopsis and runtime, for the episode list. */
  description?: string
  duration?: string
}

export type Playlist = {
  id: string
  name: string
  channels: Channel[]
  importedAt: string
  media?: MediaItem[]
  /** MEDIA_CATALOG_VERSION the media list was fetched with. */
  mediaVersion?: number
  /** When the catalog was last fetched from the provider (ms). */
  mediaUpdatedAt?: number
  xtream?: XtreamConnection
}

export type MediaItem = {
  id: string
  name: string
  kind: 'movie' | 'series'
  category: string
  poster?: string
  streamUrl?: string
  seriesId?: string
  /** Genre text from the provider API (series only, e.g. "Drama, Crime"). */
  genre?: string
  year?: number
  /** Provider rating, 0–10. */
  rating?: number
  /** Unix seconds when the provider added/updated the title. */
  added?: number
}

export type XtreamConnection = {
  server: string
  username: string
  password: string
}
