import { useEffect, useState } from 'react'

// Keep existing string keys compatible with preferences saved by older versions.
export function usePreference<T extends string>(key: string, fallback: T, choices: readonly T[]) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key) as T | null
      return stored !== null && choices.includes(stored) ? stored : fallback
    } catch { return fallback }
  })
  useEffect(() => {
    try { localStorage.setItem(key, value) } catch { /* Storage may be unavailable. */ }
  }, [key, value])
  return [value, setValue] as const
}

export function readVolume() {
  try {
    const stored = localStorage.getItem('streamhub-volume')
    const value = stored === null ? 1 : Number(stored)
    return Number.isFinite(value) && value >= 0 && value <= 1 ? value : 1
  } catch { return 1 }
}
