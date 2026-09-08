export type Channel = {
  id: string
  name: string
  url: string
  group: string
  logo?: string
  tvgId?: string
  tvgName?: string
}

export type Playlist = {
  id: string
  name: string
  channels: Channel[]
  importedAt: string
}
