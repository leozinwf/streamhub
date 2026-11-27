import { useEffect, useRef, useState } from 'react'
import { Clock3, LayoutGrid, Radio, Star } from 'lucide-react'
import type { Channel } from '../types'
import { groupLabel } from '../lib/groupLabel'
import { EpgNowLine } from './EpgGuide'

/**
 * Fire TV: channel menu over the full-screen video. Left column = categories,
 * right column = channels of the chosen category. The remote's arrows move
 * between them (spatial navigation in tv.ts), OK picks, back closes.
 */
export function TvChannelOverlay({ channels, groups, selectedGroup, current, onGroup, onPick }: {
  channels: Channel[]
  groups: Array<{ id: string; label: string; count?: number }>
  selectedGroup: string
  current: Channel | null
  onGroup: (group: string) => void
  onPick: (channel: Channel) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)

  // Focus the channel that is playing (or the first one) when the menu opens or the category changes.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const target = list.querySelector<HTMLElement>('.active') || list.querySelector<HTMLElement>('button')
    target?.focus({ preventScroll: true })
    target?.scrollIntoView({ block: 'center' })
  }, [selectedGroup])

  const icon = (id: string) => id === 'Favoritos' ? <Star size={18} /> : id === 'Recentes' ? <Clock3 size={18} /> : id === 'Todos' ? <LayoutGrid size={18} /> : <Radio size={18} />
  const isCurrent = (channel: Channel) => Boolean(current && (channel.id === current.id || channel.url === current.url || channel.variants?.some((variant) => variant.id === current.id)))

  return <div className="tv-overlay" role="dialog" aria-modal="true" aria-label="Canais">
    <nav className="tv-overlay-groups" aria-label="Categorias">
      {groups.map((group) => <button key={group.id} className={selectedGroup === group.id ? 'active' : ''} onClick={() => onGroup(group.id)}>{icon(group.id)}<span>{group.label}</span>{group.count !== undefined && <small>{group.count}</small>}</button>)}
    </nav>
    <div className="tv-overlay-channels" ref={listRef}>
      {channels.length ? channels.map((channel, index) => <button key={channel.id} className={isCurrent(channel) ? 'active' : ''} onClick={() => onPick(channel)}>
        <em>{index + 1}</em>
        {channel.logo ? <img src={channel.logo} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = 'hidden' }} /> : <span className="tv-overlay-logo">{channel.name.slice(0, 2)}</span>}
        <span className="tv-overlay-text"><strong>{channel.name}</strong><EpgNowLine channel={channel} /></span>
      </button>) : <p className="tv-overlay-empty">Nenhum canal nesta categoria.</p>}
    </div>
    <div className="tv-overlay-hint">OK escolhe · ← → muda de coluna · Voltar fecha</div>
  </div>
}

/** Name, number and current programme shown for a few seconds after switching channel. */
export function TvInfoBanner({ channel, number, hint }: { channel: Channel; number?: number; hint: string }) {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), 5000)
    return () => window.clearTimeout(timer)
  }, [channel.id])
  if (!visible) return null
  return <div className="tv-banner" role="status">
    {number ? <em>{number}</em> : null}
    {channel.logo ? <img src={channel.logo} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}
    <div><strong>{channel.name}</strong><span>{channel.kind === 'movie' || channel.kind === 'series' ? channel.subgroup : groupLabel(channel.group)}</span>{(!channel.kind || channel.kind === 'live') && <EpgNowLine channel={channel} />}</div>
    <small>{hint}</small>
  </div>
}
