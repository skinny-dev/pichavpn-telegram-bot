const map = { sdk: './sdk/index.js', 'sdk/db': './sdk/db.js', 'sdk/api': './sdk/index.js', 'sdk/fetch': './sdk/index.js' }
export async function resolve(spec, ctx, next) {
  if (map[spec]) return { url: new URL(map[spec], import.meta.url).href, shortCircuit: true, format: 'module' }
  return next(spec, ctx)
}
