import type { Channel } from '../types'

export const CATEGORY_ORDER = [
  'TV Aberta',
  'Notícias',
  'Esportes',
  'Filmes e Séries',
  'Infantil',
  'Documentários',
  'Entretenimento',
  'Música',
  'Religiosos',
  'Internacionais',
  'Canais 24h',
  'Outros',
]

function clean(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[|_./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function matches(value: string, pattern: RegExp) {
  return pattern.test(value)
}

export function categorizeChannel(channel: Channel): Channel {
  const name = clean(channel.name)
  const originalGroup = channel.sourceGroup || (channel.subgroup ? `Canais | ${channel.subgroup}` : channel.group) || 'Outros'
  const group = clean(originalGroup)
  const text = `${name} ${group}`
  let category = 'Outros'

  if (matches(text, /\b(adult|xxx|porno|porn|sexo|sex|erotic|18\+|18 anos|privat|sensual)\b/)) category = '+18'
  else if (matches(text, /\b(sport|esporte|futebol|soccer|premiere|combate|ufc|nba|nfl|nhl|mlb|formula ?1|f1|espn|sportv|sportynet|dazn|bandsports|tnt sports|copinha|estaduais|jogos? do dia|jogos? e eventos|eventos? de hoje|goat)\b/)) category = 'Esportes'
  else if (matches(text, /\b(news|noticias?|jornal|cnn|globonews|record news|band news|jovem pan|jp news|bbc world|euronews)\b/)) category = 'Notícias'
  else if (matches(text, /\b(kids|infantil|infantis|crianca|desenho|cartoon|disney|nickelodeon|nick jr|discovery kids|gloob|tooncast|baby tv)\b/)) category = 'Infantil'
  else if (matches(text, /\b(documentarios?|documentary|discovery|animal planet|national geographic|nat geo|history|h2|curta!)\b/)) category = 'Documentários'
  else if (matches(text, /\b(filme|movie|cinema|series|serie|legendado|amazon prime|prime video|hbo|telecine|cinemax|megapix|paramount|warner|sony|universal tv|studio universal|star channel|amc|axn|space|tnt)\b/)) category = 'Filmes e Séries'
  else if (matches(text, /\b(music|musica|radio|radios|rock in rio|mtv|multishow|bis|trace|vh1)\b/)) category = 'Música'
  else if (matches(text, /\b(religiao|religiosos?|religiosas?|gospel|igreja|canção nova|cancao nova|rede vida|aparecida|novo tempo|r.?r.? soares)\b/)) category = 'Religiosos'
  else if (matches(text, /\b(24h|24 horas|24\/7)\b/)) category = 'Canais 24h'
  else if (matches(group, /\b(internacional|international|latino|usa|eua|portugal|espanha|italia|franca|alemanha|argentina|uruguai|chile|mexico)\b/)) category = 'Internacionais'
  else if (matches(text, /\b(aberto|abertos|globo|sbt|record|band|rede tv|redetv|tv brasil|cultura|gazeta|futura)\b/)) category = 'TV Aberta'
  else if (matches(text, /\b(entretenimento|variedades|reality|comedia|comedy|food|lifestyle|viagem|travel|tlc|viva|gnt|discovery home)\b/)) category = 'Entretenimento'
  else if (originalGroup.includes('|')) category = 'Entretenimento'
  else {
    const known = CATEGORY_ORDER.find((item) => clean(item) === group)
    if (known) category = known
    else if (group && !matches(group, /\b(outro|geral|todos|canal|live|ao vivo|brasil|br|tv)\b/)) category = channel.group.trim()
  }

  const rawSubgroup = originalGroup.split('|').map((part) => part.trim()).filter(Boolean).at(-1) || originalGroup.trim()
  const subgroup = clean(rawSubgroup) !== clean(category)
    && !matches(clean(rawSubgroup), /^(outros?|geral|todos?|canais?|live|ao vivo|brasil|br|tv)$/)
    ? rawSubgroup
    : undefined

  return {
    ...channel,
    group: category,
    sourceGroup: originalGroup,
    subgroup: channel.subgroup || subgroup,
    variants: channel.variants?.map((variant) => ({ ...variant, group: category, subgroup: channel.subgroup || subgroup })),
  }
}

export function categorizeChannels(channels: Channel[]) {
  return channels.map(categorizeChannel)
}

export function compareCategories(a: string, b: string) {
  const aIndex = CATEGORY_ORDER.indexOf(a)
  const bIndex = CATEGORY_ORDER.indexOf(b)
  if (aIndex >= 0 || bIndex >= 0) {
    if (aIndex < 0) return 1
    if (bIndex < 0) return -1
    return aIndex - bIndex
  }
  return a.localeCompare(b, 'pt-BR')
}
