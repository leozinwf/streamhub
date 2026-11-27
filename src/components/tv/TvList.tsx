import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Lists and grids for the Fire TV interface. Only the rows on screen exist in
 * the page (a category can have thousands of channels), and the selection is
 * moved here with the remote's arrows instead of by the generic spatial
 * navigation, which would have to measure every element on each key press.
 */

type KeyHandler = (event: KeyboardEvent) => boolean
type OwnKeysElement = HTMLDivElement & { __tvKey?: KeyHandler }

const OVERSCAN = 4

function useOwnKeys(ref: React.RefObject<OwnKeysElement>, handler: KeyHandler) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  useEffect(() => {
    const node = ref.current
    if (node) node.__tvKey = (event) => handlerRef.current(event)
  }, [])
}

function useHeight(ref: React.RefObject<HTMLElement>) {
  const [height, setHeight] = useState(600)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => setHeight(node.clientHeight || 600)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return height
}

type ListProps<T> = {
  items: T[]
  rowHeight: number
  /** Selected row (controlled by the parent, so it survives going to a details page and back). */
  index: number
  onIndex: (index: number) => void
  onSelect: (item: T, index: number) => void
  render: (item: T, index: number, selected: boolean) => ReactNode
  className?: string
  autoFocus?: boolean
  label: string
}

export function TvList<T>({ items, rowHeight, index, onIndex, onSelect, render, className = '', autoFocus, label }: ListProps<T>) {
  const ref = useRef<OwnKeysElement>(null)
  const height = useHeight(ref)
  const count = items.length
  const safeIndex = Math.min(Math.max(index, 0), Math.max(count - 1, 0))

  useOwnKeys(ref, (event) => {
    if (!count) return false
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : event.key === 'PageDown' ? 8 : event.key === 'PageUp' ? -8 : 0
    if (step) {
      const next = Math.min(Math.max(safeIndex + step, 0), count - 1)
      // At the top of the list ↑ is free to leave (to a header/tab row).
      if (next === safeIndex && step < 0) return false
      onIndex(next)
      return true
    }
    if (event.key === 'Enter') { onSelect(items[safeIndex], safeIndex); return true }
    return false
  })

  useEffect(() => { if (autoFocus) ref.current?.focus({ preventScroll: true }) }, [])

  // Keep the selected row in the middle of the list.
  const visible = Math.ceil(height / rowHeight)
  const maxTop = Math.max(0, count * rowHeight - height)
  const top = Math.min(maxTop, Math.max(0, safeIndex * rowHeight - height / 2 + rowHeight / 2))
  const first = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN)
  const last = Math.min(count, first + visible + OVERSCAN * 2)
  const rows: ReactNode[] = []
  for (let i = first; i < last; i += 1) {
    rows.push(<div key={i} className={i === safeIndex ? 'tv-row selected' : 'tv-row'} style={{ top: i * rowHeight - top, height: rowHeight }} onClick={() => { onIndex(i); onSelect(items[i], i) }}>{render(items[i], i, i === safeIndex)}</div>)
  }
  return <div ref={ref} className={`tv-list ${className}`} tabIndex={0} role="listbox" aria-label={label} aria-activedescendant={undefined}>
    {rows}
    {!count && <div className="tv-list-empty">Nada aqui.</div>}
  </div>
}

type GridProps<T> = Omit<ListProps<T>, 'rowHeight'> & { columns: number; rowHeight: number }

export function TvGrid<T>({ items, columns, rowHeight, index, onIndex, onSelect, render, className = '', autoFocus, label }: GridProps<T>) {
  const ref = useRef<OwnKeysElement>(null)
  const height = useHeight(ref)
  const count = items.length
  const safeIndex = Math.min(Math.max(index, 0), Math.max(count - 1, 0))

  useOwnKeys(ref, (event) => {
    if (!count) return false
    const column = safeIndex % columns
    let next = safeIndex
    if (event.key === 'ArrowRight') { if (column === columns - 1 || safeIndex === count - 1) return false; next += 1 }
    else if (event.key === 'ArrowLeft') { if (column === 0) return false; next -= 1 }
    else if (event.key === 'ArrowDown') { if (safeIndex + columns >= count) { if (Math.floor(safeIndex / columns) === Math.floor((count - 1) / columns)) return true; next = count - 1 } else next += columns }
    else if (event.key === 'ArrowUp') { if (safeIndex - columns < 0) return false; next -= columns }
    else if (event.key === 'PageDown') next = Math.min(count - 1, safeIndex + columns * 3)
    else if (event.key === 'PageUp') next = Math.max(0, safeIndex - columns * 3)
    else if (event.key === 'Enter') { onSelect(items[safeIndex], safeIndex); return true }
    else return false
    onIndex(next)
    return true
  })

  useEffect(() => { if (autoFocus) ref.current?.focus({ preventScroll: true }) }, [])

  const rowCount = Math.ceil(count / columns)
  const row = Math.floor(safeIndex / columns)
  const maxTop = Math.max(0, rowCount * rowHeight - height)
  const top = Math.min(maxTop, Math.max(0, row * rowHeight - height / 2 + rowHeight / 2))
  const firstRow = Math.max(0, Math.floor(top / rowHeight) - 2)
  const lastRow = Math.min(rowCount, firstRow + Math.ceil(height / rowHeight) + 4)
  const cells: ReactNode[] = []
  for (let r = firstRow; r < lastRow; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      const i = r * columns + c
      if (i >= count) break
      cells.push(<div key={i} className={i === safeIndex ? 'tv-cell selected' : 'tv-cell'} style={{ top: r * rowHeight - top, left: `${(c * 100) / columns}%`, width: `${100 / columns}%`, height: rowHeight }} onClick={() => { onIndex(i); onSelect(items[i], i) }}>{render(items[i], i, i === safeIndex)}</div>)
    }
  }
  return <div ref={ref} className={`tv-list tv-grid ${className}`} tabIndex={0} role="grid" aria-label={label}>
    {cells}
    {!count && <div className="tv-list-empty">Nada aqui.</div>}
  </div>
}
