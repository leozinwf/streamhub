import type { Channel } from '../types'
import { compareChannelNames, normalizeChannelKey } from './channelVariants'

const MAX_PER_GROUP = 6
const GENERIC_WORDS = new Set(['tv', 'canal', 'rede', 'the', 'a', 'o', 'de', 'do', 'da', 'channel', 'plus', 'hd', 'fhd', 'sd'])
const POPULAR = /\b(globo|sbt|record|band|sportv|premiere|espn|tnt|hbo|max|telecine|warner|universal|sony|axn|discovery|history|disney|cartoon|multishow|gnt|viva|megapix|paramount|amc|space|globonews|cnn|combate|bandsports)\b/i

/** Brand of a channel: "ESPN 4" → "espn", "SporTV 2" → "sportv", "TV Globo SP" → "tv globo". */
export function channelBrand(name: string) {
  const tokens = normalizeChannelKey(name).split(/\s+/).filter((token) => token && !/^\d+$/.test(token))
  if (!tokens.length) return ''
  if ((tokens[0].length < 3 || GENERIC_WORDS.has(tokens[0])) && tokens[1]) return `${tokens[0]} ${tokens[1]}`
  return tokens[0]
}

/** Display form of the brand, taken from the channel name itself ("ESPN", "SporTV"). */
function brandLabel(name: string, brand: string) {
  const words = name.replace(/[\[(].*?[\])]/g, ' ').split(/\s+/).filter(Boolean)
  const count = brand.split(' ').length
  return words.slice(0, count).join(' ') || name
}

export type Recommendations = {
  sameBrand: Channel[]
  related: Channel[]
  brand: string
  category: string
}

/**
 * "A seguir" for the channel being watched: first the same brand (ESPN 2, ESPN 3…),
 * then other channels of the same kind (same category / same list group).
 * Foreign channels are only suggested when the current one is foreign too.
 */
export function recommendChannels(current: Channel, all: Channel[], limit = 40): Recommendations {
  const brand = channelBrand(current.name)
  const currentKey = normalizeChannelKey(current.name)
  const currentForeign = current.group === 'Internacionais'
  // 24-hour loop channels (hundreds of "Series [24H]") only show up when watching one of them.
  const current24h = current.group === 'Canais 24h'
  const sameBrand: Channel[] = []
  const related: Array<{ channel: Channel; score: number }> = []
  for (const channel of all) {
    if (channel.id === current.id || normalizeChannelKey(channel.name) === currentKey) continue
    if (!currentForeign && channel.group === 'Internacionais') continue
    if (!current24h && channel.group === 'Canais 24h') continue
    if (brand && channelBrand(channel.name) === brand) { sameBrand.push(channel); continue }
    const sameCategory = channel.group === current.group
    const sameSource = Boolean(current.sourceGroup) && channel.sourceGroup === current.sourceGroup
    if (!sameCategory && !sameSource) continue
    const score = (sameSource ? 3 : 0) + (sameCategory ? 2 : 0) + (POPULAR.test(channel.name) ? 2 : 0) + (channel.logo ? 1 : 0)
    related.push({ channel, score })
  }
  sameBrand.sort(compareChannelNames)
  related.sort((a, b) => b.score - a.score || compareChannelNames(a.channel, b.channel))
  // Variety: at most a few channels from each group of the list, so one big group
  // (e.g. dozens of loop channels) can't take over the suggestions.
  const perGroup = new Map<string, number>()
  const varied: Channel[] = []
  for (const { channel } of related) {
    const key = channel.sourceGroup || channel.group
    const count = perGroup.get(key) || 0
    if (count >= MAX_PER_GROUP) continue
    perGroup.set(key, count + 1)
    varied.push(channel)
  }
  return {
    sameBrand: sameBrand.slice(0, 12),
    related: varied.slice(0, Math.max(0, limit - Math.min(sameBrand.length, 12))),
    brand: brandLabel(current.name, brand),
    category: current.group,
  }
}
