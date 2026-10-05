import { useEffect, useState } from 'react'

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => (typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)').matches : false))
  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia('(pointer: coarse)')
    const on = () => setCoarse(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return coarse
}
