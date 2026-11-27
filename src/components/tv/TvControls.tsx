import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, List, Pause, Play, RectangleHorizontal, SkipBack, SkipForward, Rewind, FastForward } from 'lucide-react'
import type { Channel } from '../../types'
import { EpgNowLine } from '../EpgGuide'

function clock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor(total / 60) % 60
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/**
 * Bar over the full-screen video (opened with OK): channel/title on top,
 * programme or progress and the action buttons at the bottom.
 */
export function TvControls({ channel, number, fitLabel, onPrevious, onNext, onList, onFit, onExit }: {
  channel: Channel
  number?: number
  fitLabel: string
  onPrevious: () => void
  onNext: () => void
  onList: () => void
  onFit: () => void
  onExit: () => void
}) {
  const live = !channel.kind || channel.kind === 'live'
  const firstRef = useRef<HTMLButtonElement>(null)
  const [, tick] = useState(0)
  const video = document.querySelector<HTMLVideoElement>('.player-screen video')

  useEffect(() => { firstRef.current?.focus({ preventScroll: true }) }, [])
  // Refresh the play state and the movie position twice a second.
  useEffect(() => { const timer = window.setInterval(() => tick((value) => value + 1), 500); return () => window.clearInterval(timer) }, [])

  const paused = video?.paused ?? false
  const togglePlay = () => { if (!video) return; if (video.paused) void video.play().catch(() => undefined); else video.pause() }
  const seek = (seconds: number) => { if (video) video.currentTime = Math.max(0, video.currentTime + seconds) }
  const duration = video && Number.isFinite(video.duration) ? video.duration : 0

  return <div className="tv-controls">
    <div className="tv-controls-top">
      <button onClick={onExit} aria-label="Sair da tela cheia"><ArrowLeft size={22} /></button>
      <strong>{number ? `${number} - ` : ''}{channel.name}</strong>
    </div>
    <div className="tv-controls-bottom">
      <div className="tv-controls-info">
        <button className="tv-controls-play" onClick={togglePlay} aria-label={paused ? 'Reproduzir' : 'Pausar'}>{paused ? <Play size={24} fill="currentColor" /> : <Pause size={24} fill="currentColor" />}</button>
        {channel.logo ? <img src={channel.logo} alt="" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}
        {live ? <div className="tv-controls-epg"><EpgNowLine channel={channel} /></div>
          : <div className="tv-controls-progress"><span>{clock(video?.currentTime || 0)}</span><div><span style={{ width: duration ? `${((video?.currentTime || 0) / duration) * 100}%` : 0 }} /></div><span>{clock(duration)}</span></div>}
      </div>
      <div className="tv-controls-actions">
        {live ? <>
          <button onClick={onPrevious}><SkipBack size={20} /> Canal anterior</button>
          <button ref={firstRef} onClick={onList}><List size={20} /> Lista de canais</button>
          <button onClick={onFit}><RectangleHorizontal size={20} /> Proporção: {fitLabel}</button>
          <button onClick={onNext}>Próximo canal <SkipForward size={20} /></button>
        </> : <>
          <button onClick={() => seek(-30)}><Rewind size={20} /> 30 s</button>
          <button ref={firstRef} onClick={togglePlay}>{paused ? <><Play size={20} /> Continuar</> : <><Pause size={20} /> Pausar</>}</button>
          <button onClick={onFit}><RectangleHorizontal size={20} /> Proporção: {fitLabel}</button>
          <button onClick={() => seek(30)}>30 s <FastForward size={20} /></button>
        </>}
      </div>
    </div>
  </div>
}
