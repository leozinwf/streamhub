import type { Channel } from '../types'

export const CHANNEL_SORTS = ['default', 'az', 'za', 'category', 'quality', 'favorites', 'recent'] as const
export type ChannelSort = typeof CHANNEL_SORTS[number]
export const CHANNEL_SORT_LABELS: Record<ChannelSort, string> = { default: 'Padrão (recomendado)', az: 'Nome A–Z', za: 'Nome Z–A', category: 'Categoria', quality: 'Melhor qualidade', favorites: 'Favoritos primeiro', recent: 'Vistos recentemente' }
export const QUALITY_FILTERS = ['all', '4k', 'fhd', 'hd', 'sd', 'h265'] as const
export type QualityFilter = typeof QUALITY_FILTERS[number]
export const QUALITY_FILTER_LABELS: Record<QualityFilter, string> = { all: 'Todas', '4k': '4K', fhd: 'Full HD', hd: 'HD', sd: 'SD', h265: 'H265' }

/** Quality tags a channel offers, from its variants' labels and its own name. */
export function channelQualities(channel: Channel): QualityFilter[] {
  const labels = [channel.name, ...(channel.variants?.map((variant) => `${variant.quality} ${variant.name}`) || [])].join(' ')
  const found: QualityFilter[] = []
  if (/\b(4k|uhd|2160p)\b/i.test(labels)) found.push('4k')
  if (/\b(full\s*hd|fhd|1080p)\b/i.test(labels)) found.push('fhd')
  if (/(^|[^l\s]\s*|\s)\b(hd|720p)\b/i.test(labels.replace(/full\s*hd/gi, ''))) found.push('hd')
  if (/\b(sd|480p|576p)\b/i.test(labels)) found.push('sd')
  if (/\b(h[ ._-]?265|hevc)\b/i.test(labels)) found.push('h265')
  return found
}
export function bestQuality(channel: Channel) {
  const qualities = channelQualities(channel)
  return qualities.includes('4k') ? 4 : qualities.includes('fhd') ? 3 : qualities.includes('hd') ? 2 : qualities.includes('sd') ? 1 : 0
}
