import type { MediaItem, Playlist } from '../types'

const DB_NAME = 'streamhub'
const DB_VERSION = 1
const STORE_NAME = 'playlists'
const ACTIVE_KEY = 'active'
/**
 * The movie/series catalog (tens of thousands of titles) is kept under its own
 * key, so opening the app reads only the channels first and never rewrites
 * the whole catalog just to save a small change.
 */
const MEDIA_KEY = 'active-media'

type StoredMedia = { playlistId: string; media: MediaItem[] }

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { dbPromise = null; reject(request.error) }
  })
  return dbPromise
}

async function get<T>(key: string): Promise<T | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
}

async function put(entries: Array<[string, unknown]>, removals: string[] = []) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    const store = transaction.objectStore(STORE_NAME)
    for (const [key, value] of entries) store.put(value, key)
    for (const key of removals) store.delete(key)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
  })
}

/** Playlist without its movie/series catalog (see loadMedia). */
export async function loadPlaylist(): Promise<Playlist | null> {
  try {
    const stored = await get<Playlist>(ACTIVE_KEY)
    if (!stored) return null
    // Older versions kept the catalog inside the playlist: move it out once.
    if (stored.media) {
      const { media, ...base } = stored
      await put([[ACTIVE_KEY, base], [MEDIA_KEY, { playlistId: stored.id, media } satisfies StoredMedia]]).catch(() => undefined)
      return base
    }
    return stored
  } catch {
    return null
  }
}

/** Movie/series catalog saved for this playlist (empty when none). */
export async function loadMedia(playlistId: string): Promise<MediaItem[]> {
  try {
    const stored = await get<StoredMedia>(MEDIA_KEY)
    return stored && stored.playlistId === playlistId ? stored.media : []
  } catch {
    return []
  }
}

/** Saves the playlist; the catalog is written only when the playlist carries one. */
export async function savePlaylist(playlist: Playlist): Promise<void> {
  const { media, ...base } = playlist
  const entries: Array<[string, unknown]> = [[ACTIVE_KEY, base]]
  if (media) entries.push([MEDIA_KEY, { playlistId: playlist.id, media } satisfies StoredMedia])
  await put(entries)
}

export async function clearPlaylist(): Promise<void> {
  try { await put([], [ACTIVE_KEY, MEDIA_KEY]) } catch { /* Ignore storage cleanup failures. */ }
}
