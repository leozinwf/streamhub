import type { Channel, XtreamConnection } from '../types'
import { channelStreamId, fetchXtream } from './xtream'

export type EpgProgram = { title: string; description: string; start: number; end: number }
export type EpgStatus = 'idle' | 'loading' | 'ok' | 'empty' | 'no-guide' | 'error'
export type EpgListing = { title?: string; description?: string; start_timestamp?: string | number; stop_timestamp?: string | number }

export function parseEpgListings(listings: EpgListing[] | undefined, now = Date.now()) {
  const seen = new Set<number>()
  return (listings || []).map((item) => ({
    title: decodeEpgText(item.title) || 'Programa sem título',
    description: decodeEpgText(item.description),
    start: Number(item.start_timestamp || 0),
    end: Number(item.stop_timestamp || 0),
  }))
    .filter((item) => item.start > 0 && item.end > item.start && item.end * 1000 >= now && !seen.has(item.start) && seen.add(item.start))
    .sort((a, b) => a.start - b.start)
}

export function formatClock(seconds: number) {
  return new Date(seconds * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h${String(rest).padStart(2, '0')}` : `${hours}h`
}

export function decodeEpgText(value?: string) {
  if (!value) return ''
  try { return decodeURIComponent(escape(atob(value))) } catch { return value }
}

// ---------------------------------------------------------------------------
// Guide requests, shared by the big guide under the player and the
// "Agora: …" line on channel cards.


export type EpgResult = { status: Exclude<EpgStatus, 'idle' | 'loading'>; programs: EpgProgram[]; detail?: string }

async function requestListings(connection: XtreamConnection, action: string, streamId: string, extra: Record<string, string>) {
  const response = await fetchXtream(connection, action, { stream_id: streamId, ...extra })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const text = await response.text()
  // Some panels answer an empty body or "[]" instead of {epg_listings: []}.
  if (!text.trim() || text.trim() === '[]') return [] as EpgProgram[]
  const data = JSON.parse(text) as { epg_listings?: EpgListing[] } | EpgListing[]
  return parseEpgListings(Array.isArray(data) ? data : data?.epg_listings)
}

/**
 * Guide for one channel: short guide first; many panels only fill the full
 * daily table. Errors of the first try don't hide a working second one.
 */
export async function loadChannelEpg(connection: XtreamConnection, channel: Channel, limit = 12): Promise<EpgResult> {
  const streamId = channelStreamId(channel)
  if (!streamId) return { status: 'no-guide', programs: [] }
  let firstError: unknown = null
  let programs = await requestListings(connection, 'get_short_epg', streamId, { limit: String(limit) }).catch((error) => { firstError = error; return [] as EpgProgram[] })
  if (!programs.length) {
    try { programs = await requestListings(connection, 'get_simple_data_table', streamId, {}) }
    catch (error) { if (firstError) return { status: 'error', programs: [], detail: String((error as Error).message || error) } }
  }
  if (programs.length) return { status: 'ok', programs: programs.slice(0, limit) }
  // tvgId === '' means the provider says the channel has no guide.
  return { status: channel.tvgId === '' ? 'no-guide' : 'empty', programs: [] }
}

// Card lines: a small cache and at most a few requests at a time, so a long
// channel list doesn't flood the provider.
const CARD_TTL_MS = 10 * 60 * 1000
const cardCache = new Map<string, { at: number; promise: Promise<EpgProgram[]> }>()
const queue: Array<() => void> = []
let running = 0
const MAX_PARALLEL = 3

function schedule<T>(task: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running += 1
      task().then(resolve, reject).finally(() => { running -= 1; queue.shift()?.() })
    }
    if (running < MAX_PARALLEL) run()
    else queue.push(run)
  })
}

/** Current and next programme for a channel card (cached for 10 minutes). */
export function loadNowNext(connection: XtreamConnection, channel: Channel) {
  const streamId = channelStreamId(channel)
  if (!streamId) return Promise.resolve([] as EpgProgram[])
  const key = `${connection.server}|${streamId}`
  const cached = cardCache.get(key)
  if (cached && Date.now() - cached.at < CARD_TTL_MS) return cached.promise
  const promise = schedule(() => requestListings(connection, 'get_short_epg', streamId, { limit: '3' })).catch(() => [] as EpgProgram[])
  cardCache.set(key, { at: Date.now(), promise })
  return promise
}

export function currentProgram(programs: EpgProgram[], nowSeconds = Date.now() / 1000) {
  const current = programs.find((program) => program.start <= nowSeconds && program.end > nowSeconds)
  const next = programs.find((program) => program.start >= (current?.end ?? nowSeconds))
  return { current, next }
}
