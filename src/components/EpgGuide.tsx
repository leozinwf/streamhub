import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { CalendarDays, RefreshCw } from 'lucide-react'
import type { Channel, XtreamConnection } from '../types'
import { currentProgram, formatClock, formatDuration, loadChannelEpg, loadNowNext, type EpgProgram, type EpgResult } from '../lib/epg'

/** Xtream login used for guide requests; null for plain M3U lists. */
export const EpgConnectionContext = createContext<XtreamConnection | null>(null)

const EMPTY_MESSAGES = {
  'no-guide': 'O seu IPTV não associa um guia de programação a este canal. É comum em canais de eventos, como os de streaming (Disney+, Max, Prime) e pay-per-view.',
  empty: 'O IPTV não enviou programação para este canal. Em canais de eventos (Disney+, Max, Prime, pay-per-view) isso é normal: eles só exibem conteúdo quando há transmissão.',
  error: 'Não foi possível consultar a programação agora.',
}

/** Programme guide under the player: what is on now, progress, and what comes next. */
export default function EpgGuide({ channel, connection }: { channel: Channel; connection: XtreamConnection | null }) {
  const [result, setResult] = useState<EpgResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [reload, setReload] = useState(0)
  const [clock, setClock] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!connection) { setResult(null); return }
    let cancelled = false
    setLoading(true)
    loadChannelEpg(connection, channel)
      .then((next) => { if (!cancelled) setResult(next) })
      .catch((error) => { if (!cancelled) setResult({ status: 'error', programs: [], detail: String(error) }) })
      .finally(() => { if (!cancelled) setLoading(false) })
    // Refresh every 10 minutes so the guide doesn't go stale.
    const refresh = window.setTimeout(() => setReload((value) => value + 1), 10 * 60 * 1000)
    return () => { cancelled = true; window.clearTimeout(refresh) }
  }, [channel.url, connection?.server, connection?.username, reload])

  if (!connection) return null
  const nowSeconds = clock / 1000
  const programs = result?.programs || []
  const { current } = currentProgram(programs, nowSeconds)
  const upcoming = programs.filter((program) => program !== current && program.start > nowSeconds).slice(0, 6)
  const progress = current ? Math.min(100, Math.max(0, ((nowSeconds - current.start) / (current.end - current.start)) * 100)) : 0
  const remaining = current ? Math.max(1, Math.round((current.end - nowSeconds) / 60)) : 0
  const status = loading && !result ? 'loading' : result?.status || 'loading'

  return <section className="epg-guide">
    <header className="epg-head"><CalendarDays size={16} /><strong>Programação</strong><span>{new Date(clock).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' })}</span><button onClick={() => setReload((value) => value + 1)} disabled={loading} title="Atualizar programação" aria-label="Atualizar programação"><RefreshCw size={14} className={loading ? 'spin' : ''} /></button></header>
    {status === 'loading' ? <div className="epg-skeleton"><span /><span /><span /></div>
      : current || upcoming.length ? <div className="epg-body">
        {current ? <article className="epg-now">
          <div className="epg-now-top"><em>AGORA</em><time>{formatClock(current.start)} – {formatClock(current.end)}</time></div>
          <h3>{current.title}</h3>
          {current.description && <p>{current.description}</p>}
          <div className="epg-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Andamento do programa"><span style={{ width: `${progress}%` }} /></div>
          <small>{remaining <= 1 ? 'Termina em instantes' : `Termina em ${formatDuration(remaining)}`}</small>
        </article> : <article className="epg-now epg-now-empty"><em>AGORA</em><h3>Sem informação do programa atual</h3></article>}
        {upcoming.length > 0 && <div className="epg-next">
          <h4>A seguir</h4>
          <ol>{upcoming.map((program) => <li key={program.start} title={program.description || program.title}><time>{formatClock(program.start)}</time><span><strong>{program.title}</strong>{program.description && <small>{program.description}</small>}</span><em>{formatDuration(Math.round((program.end - program.start) / 60))}</em></li>)}</ol>
        </div>}
      </div>
      : <div className={status === 'error' ? 'epg-empty-state error' : 'epg-empty-state'}><CalendarDays size={20} /><p>{EMPTY_MESSAGES[status as keyof typeof EMPTY_MESSAGES]}{status === 'error' && result?.detail ? ` (${result.detail})` : ''}</p>{status === 'error' && <button onClick={() => setReload((value) => value + 1)}><RefreshCw size={13} /> Tentar de novo</button>}</div>}
  </section>
}

/**
 * "Agora: Programa · 21:00 Próximo" line for a channel card. Loads only when the
 * card scrolls into view, through a shared cache and a small request queue.
 */
export function EpgNowLine({ channel }: { channel: Channel }) {
  const connection = useContext(EpgConnectionContext)
  const ref = useRef<HTMLSpanElement>(null)
  const [programs, setPrograms] = useState<EpgProgram[] | null>(null)

  useEffect(() => {
    const node = ref.current
    if (!connection || !node || channel.kind && channel.kind !== 'live') return
    let cancelled = false
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      void loadNowNext(connection, channel).then((list) => { if (!cancelled) setPrograms(list) })
    }, { rootMargin: '200px' })
    observer.observe(node)
    return () => { cancelled = true; observer.disconnect() }
  }, [connection?.server, channel.url])

  if (!connection) return null
  const { current, next } = currentProgram(programs || [])
  return <span ref={ref} className="yt-sub yt-epg-now" title={current ? `${current.title}${next ? ` · depois: ${next.title}` : ''}` : undefined}>
    {current ? <><b>Agora:</b> {current.title}{next && <em> · {formatClock(next.start)} {next.title}</em>}</> : ' '}
  </span>
}
