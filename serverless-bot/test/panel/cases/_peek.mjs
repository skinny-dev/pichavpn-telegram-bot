export default async function ({ php, handle, TG }) {
  for (const [r, q, b] of [['mg_order', { id: 'mg1' }], ['mg_order_action', {}, { id: 'mg1', action: 'renew', product_id: 1 }], ['mg_order_action', {}, { id: 'mg2', action: 'toggle' }], ['mg_order_action', {}, { id: 'mg4', action: 'delete' }]]) {
    console.log(r, JSON.stringify((await php(r, q, b)).body).slice(0, 420))
    console.log(r, JSON.stringify((await handle(r, q, b, TG)).body).slice(0, 420))
  }
}
