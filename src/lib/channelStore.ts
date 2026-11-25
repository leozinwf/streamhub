import type { Channel } from '../types'
import { normalizeChannelKey } from './channelVariants'

export function canonicalChannelKey(channel: Channel) {
  return `${channel.group.toLocaleLowerCase('pt-BR')}::${normalizeChannelKey(channel.name)}`
}

export function readStoredList(key: string): string[] {
  try { const parsed = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [] } catch { return [] }
}

/** Names that contain an adult-looking word but are not adult content ("Adult Swim"). */
export const NOT_ADULT = /\badult ?swim\b/gi

export function isAdultGroup(group: string) {
  group = group.replace(NOT_ADULT, '')
  return /adult|xxx|porn|sexo|sex\b|erotic|erótic|18\+|\+ ?18|18 anos|privat|\bhot\b|sensual/i.test(group)
}

export function isAdultChannel(channel: Channel) {
  if (NOT_ADULT.test(channel.name)) { NOT_ADULT.lastIndex = 0; return false }
  NOT_ADULT.lastIndex = 0
  return channel.group === '+18' || isAdultGroup(channel.group) || isAdultGroup(channel.sourceGroup || '') || /\b(?:xxx|porn|pornô|sexo|sex|adult|18\+|erotic|erótico|hot)\b/i.test(channel.name)
}

export function readStoredChannels(key: string, limit?: number): Channel[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Channel[]
    if (!Array.isArray(parsed)) return []
    return limit ? parsed.slice(0, limit) : parsed
  } catch { return [] }
}

export function writeStoredChannels(key: string, channels: Channel[], limit?: number) {
  try { localStorage.setItem(key, JSON.stringify(limit ? channels.slice(0, limit) : channels)) } catch { /* ignore storage errors */ }
}
