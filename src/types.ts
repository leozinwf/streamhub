export type ChannelVariant = {
  id: string
  name: string
  url: string
  group: string
  logo?: string
  tvgId?: string
  tvgName?: string
  quality: string
}

export type Channel = {
  id: string
  name: string
  url: string
  group: string
  logo?: string
  tvgId?: string
  tvgName?: string
  variants?: ChannelVariant[]
}

export type Playlist = {
  id: string
  name: string
  channels: Channel[]
  importedAt: string
}
