import type { Channel, ChannelVariant } from '../types'

const QUALITY_PATTERNS: Array<{ quality: string; pattern: RegExp; weight: number }> = [
  { quality: '4K H265', pattern: /\b(?:4k|2160p)\b.*\b(?:h[ ._-]?265|hevc)\b/i, weight: 500 },
  { quality: 'Full HD H265', pattern: /\b(?:full\s*hd|fhd|1080p)\b.*\b(?:h[ ._-]?265|hevc)\b/i, weight: 450 },
  { quality: 'HD H265', pattern: /\b(?:hd|720p)\b.*\b(?:h[ ._-]?265|hevc)\b/i, weight: 350 },
  { quality: 'SD H265', pattern: /\b(?:sd|480p|576p)\b.*\b(?:h[ ._-]?265|hevc)\b/i, weight: 250 },
  { quality: '4K', pattern: /\b(?:4k|2160p)\b/i, weight: 400 },
  { quality: 'Full HD', pattern: /\b(?:full\s*hd|fhd|1080p)\b/i, weight: 350 },
  { quality: 'HD', pattern: /\b(?:hd|720p)\b/i, weight: 250 },
  { quality: 'SD', pattern: /\b(?:sd|480p|576p)\b/i, weight: 150 },
]

function detectQuality(name: string) {
  const normalized = name.replace(/[\[\](){}|_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return QUALITY_PATTERNS.find((item) => item.pattern.test(normalized))?.quality ?? 'Qualidade'
}

function baseChannelName(name: string) {
  let value = name
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\bfull\s*hd\b/gi, ' ')
    .replace(/\bfhd\b/gi, ' ')
    .replace(/\buhd\b/gi, ' ')
    .replace(/\b4k\b/gi, ' ')
    .replace(/\b2160p\b/gi, ' ')
    .replace(/\b1080p\b/gi, ' ')
    .replace(/\b720p\b/gi, ' ')
    .replace(/\b576p\b/gi, ' ')
    .replace(/\b480p\b/gi, ' ')
    .replace(/\bsd\b/gi, ' ')
    .replace(/\bhd\b/gi, ' ')
    .replace(/\bh[ ._-]?265\b/gi, ' ')
    .replace(/\bhevc\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[|/_-]+/g, ' ')
    .trim()
  return value || name.trim()
}

function groupingKey(channel: Channel) {
  const base = baseChannelName(channel.name).toLocaleLowerCase('pt-BR')
  return `${channel.group.toLocaleLowerCase('pt-BR')}::${base}`
}

function toVariant(channel: Channel): ChannelVariant {
  return {
    id: channel.id,
    name: channel.name,
    url: channel.url,
    group: channel.group,
    logo: channel.logo,
    tvgId: channel.tvgId,
    tvgName: channel.tvgName,
    quality: detectQuality(channel.name),
  }
}

function variantRank(variant: ChannelVariant) {
  return QUALITY_PATTERNS.find((item) => item.quality === variant.quality)?.weight ?? 0
}

export function collapseChannelVariants(channels: Channel[]) {
  const groups = new Map<string, Channel[]>()
  for (const channel of channels) {
    const key = groupingKey(channel)
    const current = groups.get(key)
    if (current) current.push(channel)
    else groups.set(key, [channel])
  }

  return Array.from(groups.values()).map((items) => {
    if (items.length === 1 && !items[0].variants?.length) return items[0]

    const all = items.flatMap((item) => item.variants?.length ? item.variants.map((variant) => ({
      ...variant,
      quality: variant.quality || detectQuality(variant.name),
    })) : [toVariant(item)])
    const deduped = Array.from(new Map(all.map((variant) => [variant.id, variant])).values())
      .sort((a, b) => variantRank(b) - variantRank(a) || a.name.localeCompare(b.name))

    const primary = deduped[0]
    return {
      id: primary.id,
      name: baseChannelName(primary.name),
      url: primary.url,
      group: primary.group,
      logo: primary.logo,
      tvgId: primary.tvgId,
      tvgName: primary.tvgName,
      variants: deduped.length > 1 ? deduped : undefined,
    }
  })
}
