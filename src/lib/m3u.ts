import type { Channel } from '../types'

const ATTRIBUTE_PATTERN = /([\w-]+)="([^"]*)"/g

function attributesFromExtInf(line: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of line.matchAll(ATTRIBUTE_PATTERN)) {
    attributes[match[1]] = match[2]
  }
  return attributes
}

function nameFromExtInf(line: string): string {
  const commaIndex = line.indexOf(',')
  return commaIndex >= 0 ? line.slice(commaIndex + 1).trim() : 'Canal sem nome'
}

export function parseM3U(content: string): Channel[] {
  const lines = content
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const channels: Channel[] = []
  let pending: { name: string; attributes: Record<string, string> } | null = null

  for (const line of lines) {
    if (line.toUpperCase().startsWith('#EXTINF:')) {
      pending = {
        name: nameFromExtInf(line),
        attributes: attributesFromExtInf(line),
      }
      continue
    }

    if (line.startsWith('#')) continue

    if (pending) {
      const attributes = pending.attributes
      channels.push({
        id: `${channels.length}-${line}`,
        name: pending.name,
        url: line,
        group: attributes['group-title'] || attributes['group'] || 'Outros',
        logo: attributes['tvg-logo'] || undefined,
        tvgId: attributes['tvg-id'] || undefined,
        tvgName: attributes['tvg-name'] || undefined,
      })
      pending = null
    }
  }

  return channels
}
