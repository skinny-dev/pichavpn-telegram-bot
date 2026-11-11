import { useEffect, useSyncExternalStore } from 'react'

/**
 * One place that knows "what does Back do right now": the topmost open layer
 * (sheet / dialog) if any, otherwise the router (handled by Layout).
 * Dialogs register themselves; the Telegram BackButton, Escape and the
 * hardware back all end up calling `closeTop()`.
 */
type Layer = { id: number; close: () => void }
let layers: Layer[] = []
let seq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function pushLayer(close: () => void): () => void {
  const l = { id: ++seq, close }
  layers = [...layers, l]
  emit()
  return () => { layers = layers.filter((x) => x !== l); emit() }
}

/** Close the topmost layer; false when none is open. */
export function closeTop(): boolean {
  const l = layers.at(-1)
  if (!l) return false
  l.close()
  return true
}

export const useLayerCount = () =>
  useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => layers.length)

/** Register a layer while `active` (used by components that manage their own sheet). */
export function useBackLayer(active: boolean, close: () => void) {
  useEffect(() => (active ? pushLayer(close) : undefined), [active, close])
}
