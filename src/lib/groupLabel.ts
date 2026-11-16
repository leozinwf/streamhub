/**
 * Display name for a category: drops the provider's generic "Canais |" prefix
 * ("Canais | Turquia" → "Turquia"). Only for display; filters keep the real name.
 */
export function groupLabel(name: string) {
  const cleaned = name.replace(/^\s*(?:canais?|channels?|tv)\s*[|:\-–—»>]+\s*/i, '').trim()
  return cleaned || name
}
