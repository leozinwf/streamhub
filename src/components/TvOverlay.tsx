import { useEffect, useState } from 'react'
import type { Channel } from '../types'
import { groupLabel } from '../lib/groupLabel'
import { EpgNowLine } from './EpgGuide'

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
