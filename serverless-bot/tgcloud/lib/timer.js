// The Serverless isolate may have no timers (no setTimeout): these degrade to «no wait» / «no timeout» instead of throwing,
// so a slow gateway can never turn into a ReferenceError that leaves a customer on «creating the link…».
export const hasTimers = () => typeof setTimeout === 'function'
export const sleep = (ms) => (hasTimers() ? new Promise((ok) => setTimeout(ok, ms)) : Promise.resolve())
export const abortAfter = (ms) => (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? { signal: AbortSignal.timeout(ms) } : {})
export async function withTimeout(promise, ms, msg = 'timeout') {
  if (!hasTimers()) return promise
  let t
  try {
    return await Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms) })])
  } finally { clearTimeout(t) }
}
