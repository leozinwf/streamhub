import type { MediaItem } from '../types'

/**
 * Bump when loadMediaCatalog starts storing new fields, so playlists saved by an
 * older version refetch the catalog in the background.
 */
export const MEDIA_CATALOG_VERSION = 2

/** Pseudo-genre for the library's landing view (shelves). */
export const ALL_GENRES = 'Todos'

/** Removes accents, punctuation and casing so "Ação" matches "acao". */
export function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim()
}

const ADULT_LABEL = 'Adultos +18'
// "+18", "18+", "XXX", "Adultos", "Hot", "Erótico", well-known adult studios…
const ADULT_PATTERN = /(^|\s)(\+ ?18|18 ?\+|xxx+)(\s|$)|\b(adult[oa]s?|adult|eroti[ck][oa]s?|erotismo|porn[oa]?s?|pornografia|sexy|sexo|sensual|hentai|playboy|brasileirinhas|private|hot ?(movies|filmes)?|para maiores|maiores de 18|18 anos)\b/

/**
 * Canonical genres. Providers name categories very differently
 * ("FILMES | AÇÃO", "VOD - Acao/Aventura", "[4K] LANÇAMENTOS"); each provider
 * category is mapped to one or more of these. Order = display order.
 */
const GENRES: Array<{ label: string; pattern: RegExp }> = [
  { label: 'Lançamentos', pattern: /\b(lancamentos?|estreias?|novidades?|recem adicionados|adicionados recentemente|em cartaz|cinema|new releases?|releases)\b/ },
  { label: 'Streaming', pattern: /\b(netflix|disney|prime video|amazon|hbo|max|apple tv|paramount|globoplay|star ?plus|star\+|crunchyroll|discovery\+|telecine|claro video|pluto|mubi|lionsgate|universal\+)\b/ },
  { label: 'Ação', pattern: /\b(acao|action|artes marciais|martial)\b/ },
  { label: 'Aventura', pattern: /\b(aventuras?|adventure)\b/ },
  { label: 'Comédia', pattern: /\b(comedias?|comedy|humor|stand ?up|besteirol)\b/ },
  { label: 'Drama', pattern: /\b(dramas?)\b/ },
  { label: 'Terror', pattern: /\b(terror|horror)\b/ },
  { label: 'Suspense', pattern: /\b(suspense|thriller|misterio|mystery)\b/ },
  { label: 'Romance', pattern: /\b(romances?|romantic[oa]s?|romance)\b/ },
  { label: 'Ficção', pattern: /\b(ficcao|sci ?fi|science fiction)\b/ },
  { label: 'Fantasia', pattern: /\b(fantasia|fantasy|magia)\b/ },
  { label: 'Policial', pattern: /\b(crimes?|policia(l|is)?|investigacao|gangster|mafia|detetive)\b/ },
  { label: 'Animação', pattern: /\b(animacao|animacoes|animation|animad[oa]s?|desenhos?|cartoons?|pixar|dreamworks)\b/ },
  { label: 'Animes', pattern: /\b(animes?|otaku)\b/ },
  { label: 'Infantil', pattern: /\b(infantil|infantis|kids|criancas?|familia|family)\b/ },
  { label: 'Documentários', pattern: /\b(documentarios?|documentary|documentaries|docu)\b/ },
  { label: 'Nacionais', pattern: /\b(nacionais|nacional|brasileir[oa]s?|brasil)\b/ },
  { label: 'Novelas', pattern: /\b(novelas?|telenovelas?)\b/ },
  { label: 'Doramas', pattern: /\b(doramas?|k ?dramas?|coreanos?|coreanas?|asiatic[oa]s?|japones(es)?|chines(es)?|turc[oa]s?)\b/ },
  { label: 'Reality', pattern: /\b(reality|realitys|variedades|programas? de tv|talk show)\b/ },
  { label: 'Guerra', pattern: /\b(guerras?|war|militar(es)?)\b/ },
  { label: 'Faroeste', pattern: /\b(faroeste|western|velho oeste)\b/ },
  { label: 'Musicais', pattern: /\b(musica(is|l)?|musicals?|shows?|concertos?|concerts?|dvds? musica)\b/ },
  { label: 'Esportes', pattern: /\b(esportes?|sports?|futebol|lutas?|ufc|wwe|boxe)\b/ },
  { label: 'Religiosos', pattern: /\b(religios[oa]s?|gospel|biblic[oa]s?|cristaos?|evangelic[oa]s?|catolic[oa]s?)\b/ },
  { label: 'Clássicos', pattern: /\b(classicos?|classics?|antigos?|retro|anos (50|60|70|80|90))\b/ },
  { label: 'Sagas', pattern: /\b(colecao|colecoes|colletion|collections?|sagas?|trilogias?|franquias?)\b/ },
  { label: '4K / UHD', pattern: /\b(4k|uhd|2160p?)\b/ },
  { label: 'Legendados', pattern: /\b(legendad[oa]s?|leg|subtitled|subs?)\b/ },
  { label: 'Dublados', pattern: /\b(dublad[oa]s?|dub)\b/ },
  { label: ADULT_LABEL, pattern: ADULT_PATTERN },
]

export const GENRE_ORDER = [...GENRES.map((genre) => genre.label), 'Outros']
export const ADULT_GENRE = ADULT_LABEL

/** True for adult titles: by category, API genre or an explicit tag in the title. */
export function isAdult(item: MediaItem) {
  return itemGenres(item).includes(ADULT_LABEL)
}

const genreCache = new Map<string, string[]>()

/** Canonical genres for a provider category name and/or an API genre field. */
export function genresFor(text: string) {
  const cached = genreCache.get(text)
  if (cached) return cached
  const normalized = normalizeText(text).replace(/\badult ?swim\b/g, 'adultswim')
  const found = GENRES.filter((genre) => genre.pattern.test(normalized)).map((genre) => genre.label)
  genreCache.set(text, found)
  return found
}

export function itemGenres(item: MediaItem) {
  const fromCategory = genresFor(item.category)
  const fromApi = item.genre ? genresFor(item.genre) : []
  const all = Array.from(new Set([...fromCategory, ...fromApi]))
  return all.length ? all : ['Outros']
}

/**
 * Display name for a provider category: drops the generic "FILMES |", "VOD -",
 * "SÉRIES:" prefixes and decorations ("★ AÇÃO ★" → "Ação").
 */
export function cleanCategoryLabel(category: string) {
  const cached = labelCache.get(category)
  if (cached) return cached
  let label = category
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F★☆•▶►◆◇■□]+/gu, ' | ')
    .replace(/\s*[|¦]+\s*/g, ' | ')
  // Drop generic prefixes, possibly stacked: "VOD | FILMES | AÇÃO" → "AÇÃO".
  const words = String.raw`(?:filmes?|movies?|vods?|series?|s[ée]ries?|canais?|cat(?:egoria)?s?)`
  const prefix = new RegExp(String.raw`^\s*(?:\|\s*)*(?:\[\s*${words}\s*\]|\(\s*${words}\s*\)|${words}\s*(?:[|:\-–—»>]+|$))\s*`, 'i')
  for (let index = 0; index < 3 && prefix.test(label); index += 1) label = label.replace(prefix, '')
  label = label.replace(/^(\s*\|\s*)+/, '').replace(/(\s*\|\s*)+$/g, '').replace(/\s+/g, ' ').trim()
  if (!label) { labelCache.set(category, category.trim()); return category.trim() }
  if (!label) return category.trim()
  // "AÇÃO E AVENTURA" → "Ação e Aventura" (keep short acronyms like 4K, HBO).
  if (label === label.toUpperCase()) {
    label = label.toLowerCase().replace(/(^|[\s|/(-])(\p{L})/gu, (_match, before: string, letter: string) => before + letter.toUpperCase())
      .replace(/\b(4k|uhd|hd|fhd|hbo|tv|dc|uk|us|eua|xxx|vip)\b/gi, (word) => word.toUpperCase())
      .replace(/\s(E|De|Do|Da|Dos|Das)\s/g, (word) => word.toLowerCase())
  }
  labelCache.set(category, label)
  return label
}

const labelCache = new Map<string, string>()

const QUALITY_TAG = /[[(](?:4k|uhd|fhd|hd|sd|leg|legendado|dub|dublado|l|d|nacional|cinema|cam|ts)[\])]|\b(?:4k|uhd|fhd|1080p|720p)\b/gi

/** Year from the API field or from the title: "Duna (2021)", "Duna - 2021". */
export function itemYear(item: MediaItem) {
  if (item.year && item.year > 1900) return item.year
  const match = item.name.match(/[([\s-](19[2-9]\d|20[0-4]\d)[)\]]?\s*$/) || item.name.match(/\((19[2-9]\d|20[0-4]\d)\)/)
  return match ? Number(match[1]) : undefined
}

/** Key used to drop the same title listed in several categories/qualities. */
export function titleKey(item: MediaItem) {
  return `${item.kind}:${normalizeText(item.name.replace(QUALITY_TAG, ' ').replace(/\((19|20)\d{2}\)/, ' '))}`
}

/** All words of the query must appear in the title (accents and case ignored). */
export function matchesQuery(item: MediaItem, query: string) {
  const words = normalizeText(query).split(' ').filter(Boolean)
  if (!words.length) return true
  const haystack = normalizeText(item.name)
  return words.every((word) => haystack.includes(word))
}

export function dedupeTitles(items: MediaItem[]) {
  const seen = new Map<string, MediaItem>()
  for (const item of items) {
    const key = titleKey(item)
    const existing = seen.get(key)
    if (!existing) seen.set(key, item)
    else if (!existing.poster && item.poster) seen.set(key, item)
  }
  return Array.from(seen.values())
}

export type MediaSort = 'recent' | 'rating' | 'year' | 'az'

export function sortMedia(items: MediaItem[], sort: MediaSort) {
  const list = items.slice()
  if (sort === 'az') return list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  if (sort === 'rating') return list.sort((a, b) => (b.rating || 0) - (a.rating || 0) || (b.added || 0) - (a.added || 0))
  if (sort === 'year') return list.sort((a, b) => (itemYear(b) || 0) - (itemYear(a) || 0) || (b.added || 0) - (a.added || 0))
  return list.sort((a, b) => (b.added || 0) - (a.added || 0) || (itemYear(b) || 0) - (itemYear(a) || 0))
}

export function compareGenres(a: string, b: string) {
  return GENRE_ORDER.indexOf(a) - GENRE_ORDER.indexOf(b)
}

/** "Ação · 2021 · ★ 7.4" line under a card. */
export function mediaSubtitle(item: MediaItem) {
  const parts = [cleanCategoryLabel(item.category)]
  const year = itemYear(item)
  if (year && !item.name.includes(String(year))) parts.push(String(year))
  if (item.rating && item.rating > 0) parts.push(`★ ${item.rating.toFixed(1)}`)
  return parts.join(' · ')
}
