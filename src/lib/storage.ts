import type { Playlist } from '../types'

const STORAGE_KEY = 'streamhub:playlist:v1'

export function loadPlaylist(): Playlist | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value ? (JSON.parse(value) as Playlist) : null
  } catch {
    return null
  }
}

export function savePlaylist(playlist: Playlist): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(playlist))
}

export function clearPlaylist(): void {
  localStorage.removeItem(STORAGE_KEY)
}
