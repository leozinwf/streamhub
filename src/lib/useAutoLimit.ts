import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Renders a long list in chunks that load by themselves while scrolling (no
 * "Carregar mais" button). Returns how many items to show and a ref for an
 * empty element placed after the list.
 */
export function useAutoLimit(total: number, resetKey: unknown, step = 240) {
  const [limit, setLimit] = useState(step)
  const observerRef = useRef<IntersectionObserver | null>(null)
  useEffect(() => { setLimit(step) }, [resetKey, step])
  const sentinelRef = useCallback((node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    if (!node) return
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((value) => value + step)
    }, { rootMargin: '1600px 0px' })
    observerRef.current.observe(node)
  }, [step])
  useEffect(() => () => observerRef.current?.disconnect(), [])
  return { limit: Math.min(limit, total), hasMore: total > limit, sentinelRef }
}
