import { useSyncExternalStore } from 'react'
import type { MediaItem } from '../types'

/**
 * What the viewer watched in movies and series (resume points, finished
 * episodes) and their "Minha lista". Kept in localStorage on this device.
 */

export type WatchProgress = {
  /** Episode/movie id (the Channel id that was played). */
  id: string
  /** Catalog item it belongs to: "movie-123" or "series-45". */
  mediaId: string
  kind: 'movie' | 'series'
  name: string
  label?: string
  poster?: string
  url: string
  position: number
  duration: number
  updatedAt: number
}

type State = { progress: Record<string, WatchProgress>; watched: Record<string, number>; myList: MediaItem[] }

const KEY = 'streamhub-watch-state'
const MAX_PROGRESS = 200
const MAX_LIST = 500
/** Past this share of the runtime the title counts as watched. */
export const WATCHED_RATIO = 0.92

function read(): State {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<State>
    return { progress: parsed.progress || {}, watched: parsed.watched || {}, myList: parsed.myList || [] }
  } catch { return { progress: {}, watched: {}, myList: [] } }
}

let state = read()
const listeners = new Set<() => void>()

function commit(next: State) {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* storage full or unavailable */ }
  listeners.forEach((listener) => listener())
}

export function useWatchState() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener) }, () => state)
}

export function getProgress(id: string) { return state.progress[id] }
export function isWatched(id: string) { return Boolean(state.watched[id]) }

/** Saves where playback is; a title near its end is marked as watched instead. */
export function saveProgress(entry: Omit<WatchProgress, 'updatedAt'>) {
  if (!entry.duration || !Number.isFinite(entry.duration) || entry.position < 5) return
  const progress = { ...state.progress }
  const watched = { ...state.watched }
  if (entry.position / entry.duration >= WATCHED_RATIO) {
    delete progress[entry.id]
    watched[entry.id] = Date.now()
  } else {
    progress[entry.id] = { ...entry, updatedAt: Date.now() }
  }
  const ids = Object.values(progress).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_PROGRESS).map((item) => item.id)
  commit({ ...state, progress: Object.fromEntries(ids.map((id) => [id, progress[id]])), watched })
}

export function markWatched(id: string, value = true) {
  const progress = { ...state.progress }
  const watched = { ...state.watched }
  delete progress[id]
  if (value) watched[id] = Date.now()
  else delete watched[id]
  commit({ ...state, progress, watched })
}

export function clearProgress(id: string) {
  const progress = { ...state.progress }
  delete progress[id]
  commit({ ...state, progress })
}

export function inMyList(id: string) { return state.myList.some((item) => item.id === id) }

export function toggleMyList(item: MediaItem) {
  const exists = state.myList.some((entry) => entry.id === item.id)
  commit({ ...state, myList: exists ? state.myList.filter((entry) => entry.id !== item.id) : [item, ...state.myList].slice(0, MAX_LIST) })
}

/** Latest unfinished entry per catalog item (one per series), newest first. */
export function continueWatching(kind?: 'movie' | 'series') {
  const seen = new Set<string>()
  return Object.values(state.progress)
    .filter((entry) => !kind || entry.kind === kind)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((entry) => !seen.has(entry.mediaId) && seen.add(entry.mediaId))
}

export function formatRemaining(entry: Pick<WatchProgress, 'position' | 'duration'>) {
  const minutes = Math.max(1, Math.round((entry.duration - entry.position) / 60))
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')} restantes` : `${minutes} min restantes`
}
