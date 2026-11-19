import { useEffect, useRef, useState, type RefObject } from 'react'

// Miniplayer arrastável (estilo YouTube): arraste para qualquer lugar e ele "gruda" no canto mais
// próximo quando você solta. O canto escolhido fica salvo para a próxima vez.

export type MiniCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const STORAGE_KEY = 'streamhub-mini-corner'
const CORNERS: MiniCorner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const DRAG_THRESHOLD = 8

function readCorner(): MiniCorner {
  try {
    const value = localStorage.getItem(STORAGE_KEY) as MiniCorner | null
    if (value && CORNERS.includes(value)) return value
  } catch { /* storage indisponível */ }
  return 'bottom-right'
}

/** Controles em que arrastar já tem outro sentido (barra de tempo, volume, menus): não movem o miniplayer. */
const NO_DRAG = 'input, select, textarea, [role="slider"], .shp-progress, .shp-volume, .shp-menu, .player-settings-menu'
/** Botões: arrastar a partir deles move o miniplayer, mas um toque neles só aciona o botão. */
const CLICKABLE = 'button, a'

export function useMiniPlayerDrag(ref: RefObject<HTMLElement>, active: boolean, onTap?: () => void) {
  const [corner, setCorner] = useState<MiniCorner>(readCorner)
  const [dragging, setDragging] = useState(false)
  const tapRef = useRef(onTap)
  tapRef.current = onTap

  useEffect(() => {
    const element = ref.current
    if (!element || !active) return

    let pointerId: number | null = null
    let startX = 0
    let startY = 0
    let moved = false
    let onButton = false

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0 || pointerId !== null) return
      const target = event.target as HTMLElement | null
      if (target?.closest(NO_DRAG)) return
      onButton = Boolean(target?.closest(CLICKABLE))
      pointerId = event.pointerId
      startX = event.clientX
      startY = event.clientY
      moved = false
    }

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      const dx = event.clientX - startX
      const dy = event.clientY - startY
      if (!moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        moved = true
        setDragging(true)
        try { element.setPointerCapture(event.pointerId) } catch { /* ponteiro já liberado */ }
      }
      event.preventDefault()
      element.style.transition = 'none'
      element.style.transform = `translate(${dx}px, ${dy}px)`
    }

    const finish = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      pointerId = null
      if (!moved) {
        // Toque/clique sem arrastar.
        if (event.type === 'pointerup' && event.pointerType !== 'mouse' && !onButton) tapRef.current?.()
        return
      }
      // Solta no canto mais próximo, com animação a partir de onde o dedo largou (FLIP).
      const before = element.getBoundingClientRect()
      const centerX = before.left + before.width / 2
      const centerY = before.top + before.height / 2
      const next: MiniCorner = `${centerY < window.innerHeight / 2 ? 'top' : 'bottom'}-${centerX < window.innerWidth / 2 ? 'left' : 'right'}`
      try { localStorage.setItem(STORAGE_KEY, next) } catch { /* storage indisponível */ }
      element.style.transform = ''
      setCorner(next)
      setDragging(false)
      requestAnimationFrame(() => {
        const after = element.getBoundingClientRect()
        element.style.transition = 'none'
        element.style.transform = `translate(${before.left - after.left}px, ${before.top - after.top}px)`
        requestAnimationFrame(() => {
          element.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1)'
          element.style.transform = ''
        })
      })
    }

    // Um clique logo depois de arrastar não deve pausar o vídeo nem abrir nada.
    const onClick = (event: MouseEvent) => {
      if (moved) { event.stopPropagation(); event.preventDefault(); moved = false }
    }

    element.addEventListener('pointerdown', onDown)
    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerup', finish)
    element.addEventListener('pointercancel', finish)
    element.addEventListener('click', onClick, true)
    return () => {
      element.removeEventListener('pointerdown', onDown)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerup', finish)
      element.removeEventListener('pointercancel', finish)
      element.removeEventListener('click', onClick, true)
      element.style.transform = ''
      element.style.transition = ''
      setDragging(false)
    }
  }, [ref, active])

  return { corner, dragging }
}
