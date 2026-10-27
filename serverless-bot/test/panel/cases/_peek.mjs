export default async function ({ php, handle, TG }) {
  for (const [r, b] of [['pay_confirm', { order: 'pend8' }], ['pay_confirm', { order: 'pend1' }], ['pay_pending', undefined]]) {
    console.log(r, JSON.stringify((await php(r, {}, b)).body).slice(0, 300))
    console.log(r, JSON.stringify((await handle(r, {}, b, TG)).body).slice(0, 300))
  }
}
