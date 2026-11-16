import type { Channel, ChannelVariant } from '../types'

// H265/HEVC fica por último: muitos navegadores (inclusive o Chrome em várias
// placas de vídeo) não decodificam HEVC, então ele nunca é a versão principal.
// Versões sem indicação de qualidade (normalmente H264) ficam à frente do H265.
const QUALITY_PATTERNS: Array<{ quality: string; pattern: RegExp; weight: number }> = [
  { quality: '4K H265', pattern: /\b(?:4k|2160p)\b.*\b(?:h[ ._-]?265|265|hevc)\b/i, weight: 90 },
  { quality: 'Full HD H265', pattern: /\b(?:full\s*hd|fhd|1080p)\b.*\b(?:h[ ._-]?265|265|hevc)\b/i, weight: 80 },
  { quality: 'HD H265', pattern: /\b(?:hd|720p)\b.*\b(?:h[ ._-]?265|265|hevc)\b/i, weight: 70 },
  { quality: 'SD H265', pattern: /\b(?:sd|480p|576p)\b.*\b(?:h[ ._-]?265|265|hevc)\b/i, weight: 60 },
  { quality: 'H265', pattern: /\b(?:h[ ._-]?265|hevc)\b/i, weight: 50 },
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
    .replace(/\b265\b/gi, ' ')
    .replace(/\bhevc\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[|/_-]+/g, ' ')
    .trim()
  return value || name.trim()
}

// Remove zeros à esquerda de números de canal: "DISNEY+ 01" -> "DISNEY+ 1".
function stripLeadingZeros(value: string) {
  return value.replace(/(^|[^\d])0+(\d)/g, '$1$2')
}

// Chave para juntar o mesmo canal escrito de formas diferentes:
// "Disney Plus 5 [HD]", "DISNEY+ 05 [FHD]" e "disney+5" viram "disney plus 5".
export function normalizeChannelKey(name: string) {
  return stripLeadingZeros(baseChannelName(name))
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\+/g, ' plus ')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function groupingKey(channel: Channel) {
  return `${channel.group.toLocaleLowerCase('pt-BR')}::${normalizeChannelKey(channel.name)}`
}

// Nome exibido: sem qualidade, sem zero à esquerda, preferindo a grafia que não é toda em maiúsculas.
function displayName(names: string[]) {
  const candidates = names.map((name) => stripLeadingZeros(baseChannelName(name)))
  const mixedCase = candidates.filter((name) => /[a-zà-ú]/.test(name) && /[A-ZÀ-Ú]/.test(name))
  return (mixedCase[0] ?? candidates[0] ?? '').trim()
}

const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' })

// Ordenação natural: "Canal 2" antes de "Canal 10", ignorando maiúsculas e acentos.
export function compareChannelNames(a: Channel, b: Channel) {
  return collator.compare(normalizeChannelKey(a.name), normalizeChannelKey(b.name)) || collator.compare(a.name, b.name)
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
  return QUALITY_PATTERNS.find((item) => item.quality === variant.quality)?.weight ?? 100
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
    if (items.length === 1 && !items[0].variants?.length) return { ...items[0], name: displayName([items[0].name]) || items[0].name }

    const all = items.flatMap((item) => item.variants?.length ? item.variants.map((variant) => ({
      ...variant,
      quality: variant.quality || detectQuality(variant.name),
    })) : [toVariant(item)])
    const deduped = Array.from(new Map(all.map((variant) => [variant.id, variant])).values())
      .sort((a, b) => variantRank(b) - variantRank(a) || a.name.localeCompare(b.name))

    const primary = deduped[0]
    const source = items.find((item) => item.id === primary.id) ?? items[0]
    return {
      // Mantém a categoria original do IPTV e a subcategoria, senão o canal
      // some ao filtrar por "Original do IPTV" ou por subcategoria.
      kind: source.kind,
      streamId: source.streamId,
      sourceGroup: source.sourceGroup,
      subgroup: source.subgroup,
      id: primary.id,
      name: displayName(deduped.map((variant) => variant.name)),
      url: primary.url,
      group: primary.group,
      logo: primary.logo,
      tvgId: primary.tvgId,
      tvgName: primary.tvgName,
      variants: deduped.length > 1 ? deduped : undefined,
    }
  })
}
