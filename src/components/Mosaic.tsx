import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { GripVertical, Headphones, Maximize2, Plus, RefreshCw, Volume2, VolumeX, X } from 'lucide-react'
import type { Channel } from '../types'

export const MOSAIC_LIMIT = 4

export const MOSAIC_LAYOUTS = ['auto', 'side', 'focus2', 'focus3', 'grid', 'pip'] as const
export type MosaicLayout = typeof MOSAIC_LAYOUTS[number]

const LAYOUT_INFO: Record<MosaicLayout, { label: string; capacity: number; icon: Array<[number, number, number, number]> }> = {
  auto: { label: 'Automático', capacity: 4, icon: [[1, 1, 10, 7], [13, 1, 10, 7], [1, 10, 10, 7], [13, 10, 10, 7]] },
  side: { label: 'Lado a lado (2)', capacity: 2, icon: [[1, 1, 10, 16], [13, 1, 10, 16]] },
  focus2: { label: 'Destaque + 2', capacity: 3, icon: [[1, 1, 15, 16], [18, 1, 5, 7], [18, 10, 5, 7]] },
  focus3: { label: 'Destaque + 3', capacity: 4, icon: [[1, 1, 16, 16], [19, 1, 4, 4.6], [19, 6.7, 4, 4.6], [19, 12.4, 4, 4.6]] },
  grid: { label: 'Grade 2×2', capacity: 4, icon: [[1, 1, 10, 7], [13, 1, 10, 7], [1, 10, 10, 7], [13, 10, 10, 7]] },
  pip: { label: 'Picture-in-picture', capacity: 2, icon: [[1, 1, 22, 16], [14, 10, 8, 6]] },
}

/** Drag payloads: a mosaic screen being moved, or a channel card dragged from the list. */
export const TILE_DRAG_TYPE = 'application/x-streamhub-tile'
export const CHANNEL_DRAG_TYPE = 'application/x-streamhub-channel'

type DropProps = {
  index: number
  onMove: (from: number, to: number) => void
  onDropChannel: (channel: Channel, index: number) => void
}

/** Lets a screen (tile or empty slot) receive dragged screens and channels. */
function useDropTarget({ index, onMove, onDropChannel }: DropProps) {
  const [over, setOver] = useState(false)
  const accepts = (event: React.DragEvent) => event.dataTransfer.types.includes(TILE_DRAG_TYPE) || event.dataTransfer.types.includes(CHANNEL_DRAG_TYPE)
  return {
    over,
    handlers: {
      onDragOver: (event: React.DragEvent) => { if (!accepts(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(true) },
      onDragLeave: () => setOver(false),
      onDrop: (event: React.DragEvent) => {
        setOver(false)
        const tile = event.dataTransfer.getData(TILE_DRAG_TYPE)
        const channel = event.dataTransfer.getData(CHANNEL_DRAG_TYPE)
        if (!tile && !channel) return
        event.preventDefault()
        if (tile) onMove(Number(tile), index)
        else { try { onDropChannel(JSON.parse(channel) as Channel, index) } catch { /* ignore bad payloads */ } }
      },
    },
  }
}

export function layoutCapacity(layout: MosaicLayout) { return LAYOUT_INFO[layout].capacity }
export function layoutLabel(layout: MosaicLayout) { return LAYOUT_INFO[layout].label }

type Audio = { volume: number; muted: boolean }

const proxy = (url: string) => `/api/stream?url=${encodeURIComponent(url)}`
const isTs = (url: string) => /\.(?:ts|m2ts)(?:$|\?)/i.test(url)
const isDirect = (url: string) => /\.(?:mp4|m4v|webm|mkv|avi|mov)(?:$|\?)/i.test(url)
const tsFallback = (url: string) => (/\/live\//i.test(url) && /\.m3u8(?:$|\?)/i.test(url) ? url.replace(/\.m3u8(?=$|\?)/i, '.ts') : null)

function MosaicTile({ channel, audio, onAudio, onSolo, onRemove, index, targeted, onTarget, onMove, onDropChannel }: {
  channel: Channel
  audio: Audio
  onAudio: (next: Audio) => void
  onSolo: () => void
  onRemove: () => void
  targeted: boolean
  onTarget: () => void
} & DropProps) {
  const drop = useDropTarget({ index, onMove, onDropChannel })
  const [dragging, setDragging] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let disposed = false
    let hls: Hls | null = null
    let ts: ReturnType<typeof mpegts.createPlayer> | null = null
    setError(null)
    setLoading(true)

    const play = () => {
      void video.play().catch((cause: unknown) => {
        // O navegador pode bloquear áudio automático: toca mudo e deixa o usuário ativar.
        if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
          video.muted = true
          onAudio({ ...audio, muted: true })
          void video.play().catch(() => undefined)
        }
      })
    }
    const fail = (message: string) => { if (!disposed) { setError(message); setLoading(false) } }
    const startTs = (url: string) => {
      if (!mpegts.getFeatureList().mseLivePlayback) return fail('Formato não suportado neste navegador.')
      ts = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: proxy(url), cors: true, liveBufferLatencyChasing: true } as any)
      ts.attachMediaElement(video)
      ts.on(mpegts.Events.ERROR, () => fail('Não foi possível carregar este canal.'))
      ts.load()
      play()
    }

    const url = channel.url
    if (isDirect(url)) { video.src = proxy(url); play() }
    else if (isTs(url)) startTs(url)
    else if (Hls.isSupported()) {
      let networkRetries = 0
      hls = new Hls({ enableWorker: true, maxBufferLength: 10, backBufferLength: 10, manifestLoadingMaxRetry: 2, fragLoadingMaxRetry: 2 })
      hls.attachMedia(video)
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls?.loadSource(proxy(url)))
      hls.on(Hls.Events.MANIFEST_PARSED, play)
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (disposed || !data.fatal) return
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls?.recoverMediaError(); return }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 1) { networkRetries += 1; hls?.startLoad(); return }
        const fallback = tsFallback(url)
        if (fallback) { hls?.destroy(); hls = null; startTs(fallback); return }
        fail('Não foi possível carregar este canal.')
      })
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) { video.src = proxy(url); play() }
    else fail('Formato não suportado neste navegador.')

    const onPlaying = () => { if (!disposed) setLoading(false) }
    video.addEventListener('playing', onPlaying)
    return () => {
      disposed = true
      video.removeEventListener('playing', onPlaying)
      try { hls?.destroy() } catch { /* ignore */ }
      try { ts?.destroy() } catch { /* ignore */ }
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
    // O áudio é controlado no efeito abaixo; recarregar só quando o canal muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.url, retry])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = audio.volume
    video.muted = audio.muted || audio.volume === 0
  }, [audio.volume, audio.muted])

  const toggleFullscreen = () => {
    const root = rootRef.current
    if (!root) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void root.requestFullscreen().catch(() => undefined)
  }
  const audible = !audio.muted && audio.volume > 0

  const classes = ['mosaic-tile', audible && 'audible', targeted && 'targeted', drop.over && 'drop-over', dragging && 'dragging'].filter(Boolean).join(' ')
  return <div ref={rootRef} className={classes} onDoubleClick={toggleFullscreen} onClick={(event) => { if (!(event.target as HTMLElement).closest('button, input, .mosaic-name')) onTarget() }} {...drop.handlers}>
    <video ref={videoRef} playsInline muted={!audible} />
    {loading && !error && <div className="mosaic-status"><span className="mosaic-spinner" />Carregando…</div>}
    {targeted && <div className="mosaic-target-badge">Próximo canal entra aqui</div>}
    {error && <div className="mosaic-status error"><span>{error}</span><button onClick={() => setRetry((value) => value + 1)}><RefreshCw size={13} /> Tentar de novo</button></div>}
    <div className="mosaic-top">
      <span className="mosaic-name" title={`${channel.name} — arraste para mudar de lugar`} draggable onDragStart={(event) => { event.dataTransfer.setData(TILE_DRAG_TYPE, String(index)); event.dataTransfer.effectAllowed = 'move'; setDragging(true) }} onDragEnd={() => setDragging(false)}><GripVertical size={13} className="mosaic-grip" />{audible && <Volume2 size={12} />}{channel.name}</span>
      <div>
        <button onClick={toggleFullscreen} title="Tela cheia" aria-label={`Tela cheia: ${channel.name}`}><Maximize2 size={14} /></button>
        <button className="mosaic-close" onClick={(event) => { event.stopPropagation(); onRemove() }} title="Fechar esta tela" aria-label={`Remover ${channel.name} do mosaico`}><X size={16} /></button>
      </div>
    </div>
    <div className="mosaic-controls" onDoubleClick={(event) => event.stopPropagation()}>
      <button onClick={() => onAudio({ volume: audio.volume === 0 ? 0.6 : audio.volume, muted: audible })} title={audible ? 'Silenciar' : 'Ativar som'} aria-label={audible ? `Silenciar ${channel.name}` : `Ativar som de ${channel.name}`}>{audible ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
      <input type="range" min={0} max={1} step={0.05} value={audio.muted ? 0 : audio.volume} aria-label={`Volume de ${channel.name}`} onChange={(event) => { const volume = Number(event.target.value); onAudio({ volume, muted: volume === 0 }) }} />
      <span className="mosaic-volume">{Math.round((audio.muted ? 0 : audio.volume) * 100)}%</span>
      <button onClick={onSolo} title="Ouvir só este canal" aria-label={`Ouvir só ${channel.name}`}><Headphones size={15} /></button>
    </div>
  </div>
}

function LayoutIcon({ layout }: { layout: MosaicLayout }) {
  return <svg viewBox="0 0 24 18" width="24" height="18" aria-hidden="true">
    {LAYOUT_INFO[layout].icon.map(([x, y, w, h], index) => <rect key={index} x={x} y={y} width={w} height={h} rx="1.4" className={layout === 'pip' && index === 1 ? 'pip-rect' : undefined} />)}
    {layout === 'auto' && <text x="12" y="12.5" textAnchor="middle" fontSize="7" fontWeight="800">A</text>}
  </svg>
}

function EmptySlot({ index, targeted, onTarget, onMove, onDropChannel, label }: DropProps & { targeted: boolean; onTarget: () => void; label: string }) {
  const drop = useDropTarget({ index, onMove, onDropChannel })
  return <button type="button" className={['mosaic-slot', targeted && 'targeted', drop.over && 'drop-over'].filter(Boolean).join(' ')} onClick={onTarget} {...drop.handlers}>
    <Plus size={20} /><span>{label}</span>
  </button>
}

export default function Mosaic({ channels, onRemove, notice, layout, onLayoutChange, target, onTarget, onMove, onDropChannel }: {
  channels: Channel[]
  onRemove: (channel: Channel) => void
  notice?: string | null
  layout: MosaicLayout
  onLayoutChange: (layout: MosaicLayout) => void
  /** Screen chosen to receive the next channel clicked in the list. */
  target: number | null
  onTarget: (index: number | null) => void
  onMove: (from: number, to: number) => void
  onDropChannel: (channel: Channel, index: number) => void
}) {
  const [audio, setAudio] = useState<Record<string, Audio>>({})
  const capacity = layoutCapacity(layout)
  const visible = channels.slice(0, capacity)

  // Por padrão só o primeiro canal sai com som; os outros entram mudos.
  const audioFor = (channel: Channel, index: number): Audio => audio[channel.id] ?? { volume: 0.8, muted: index !== 0 }
  const setAudioFor = (channel: Channel, next: Audio) => setAudio((current) => ({ ...current, [channel.id]: next }))
  const solo = (target: Channel) => setAudio(Object.fromEntries(visible.map((channel, index) => {
    const current = audioFor(channel, index)
    return [channel.id, channel.id === target.id ? { volume: current.volume || 0.8, muted: false } : { ...current, muted: true }]
  })))
  const toggleTarget = (index: number) => onTarget(target === index ? null : index)

  // Automático: 1 canal divide com um espaço vazio; 2 lado a lado; 3 e 4 em grade.
  // Layouts fixos: sempre mostram todos os espaços do layout.
  const slots = layout === 'auto'
    ? (visible.length === 1 || visible.length === 3 ? 1 : 0)
    : Math.max(0, capacity - visible.length)
  const layoutClass = layout === 'auto' ? `mosaic-auto mosaic-${Math.max(visible.length, 1)}` : `mosaic-layout-${layout}`
  const hint = target !== null
    ? 'Agora clique no canal que vai para a tela marcada'
    : visible.length >= capacity
      ? 'Clique numa tela para trocar o canal · arraste o nome para mudar de lugar'
      : 'Clique num canal da lista ou arraste-o até uma tela'
  return <div className="mosaic-wrap">
    <div className="mosaic-bar">
      <div className="mosaic-layouts" role="radiogroup" aria-label="Layout do mosaico">
        {MOSAIC_LAYOUTS.map((option) => <button key={option} role="radio" aria-checked={layout === option} className={layout === option ? 'active' : ''} title={`${LAYOUT_INFO[option].label} · até ${LAYOUT_INFO[option].capacity} canais`} aria-label={`${LAYOUT_INFO[option].label}, até ${LAYOUT_INFO[option].capacity} canais`} onClick={() => onLayoutChange(option)}><LayoutIcon layout={option} /></button>)}
      </div>
      <span className="mosaic-bar-hint">{hint}</span>
      {target !== null && <button className="mosaic-bar-cancel" onClick={() => onTarget(null)}>Cancelar</button>}
    </div>
    <div className={`mosaic ${layoutClass}${visible.length === 0 ? ' is-empty' : ''}`}>
      {visible.map((channel, index) => <MosaicTile key={channel.id} channel={channel} index={index} targeted={target === index} onTarget={() => toggleTarget(index)} onMove={onMove} onDropChannel={onDropChannel} audio={audioFor(channel, index)} onAudio={(next) => setAudioFor(channel, next)} onSolo={() => solo(channel)} onRemove={() => onRemove(channel)} />)}
      {visible.length > 0 && Array.from({ length: slots }).map((_, offset) => {
        const index = visible.length + offset
        return <EmptySlot key={`slot-${index}`} index={index} targeted={target === index} onTarget={() => toggleTarget(index)} onMove={onMove} onDropChannel={onDropChannel} label="Clique num canal da lista ou arraste-o para cá" />
      })}
      {visible.length === 0 && <EmptySlot index={0} targeted={false} onTarget={() => onTarget(null)} onMove={onMove} onDropChannel={onDropChannel} label={`Mosaico vazio: escolha o layout acima e clique (ou arraste) até ${capacity} canais da lista`} />}
      {notice && <div className="mosaic-notice" role="status">{notice}</div>}
    </div>
  </div>
}
