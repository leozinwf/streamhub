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
}

export type Playlist = {
  id: string
  name: string
  channels: Channel[]
  importedAt: string
  media?: MediaItem[]
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
}

export type XtreamConnection = {
  server: string
  username: string
  password: string
}
