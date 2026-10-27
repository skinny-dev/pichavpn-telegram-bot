export default async function ({ compare }) {
  await compare('schema', 'schema')
  for (const res of ['users', 'orders', 'products', 'categories', 'payments', 'expenses', 'capital']) {
    await compare(`list ${res}`, 'list', { res })
    await compare(`list ${res} p2`, 'list', { res, per: 7, page: 2 })
    await compare(`export ${res}`, 'export', { res })
  }
  await compare('users q', 'list', { res: 'users', q: 'user1' })
  await compare('users q none', 'list', { res: 'users', q: '%' })
  await compare('users sort', 'list', { res: 'users', sort: 'Balance', dir: 'ASC' })
  await compare('users filter', 'list', { res: 'users', f: { agent: 'n' } })
  await compare('orders sgrp', 'list', { res: 'orders', f: { sgrp: 'active' } })
  await compare('orders filters', 'list', { res: 'orders', f: { otype: 'paid', Service_location: 'Picha-1' }, sort: 'price_product', dir: 'DESC' })
  for (const range of ['today', 'yesterday', '7d', '30d', 'month', 'lastmonth']) await compare('orders range ' + range, 'list', { res: 'orders', range })
  await compare('orders bad range', 'list', { res: 'orders', range: 'x' })
  await compare('orders q', 'list', { res: 'orders', q: 'svc1' })
  await compare('bad res', 'list', { res: 'nope' })
  await compare('products f', 'list', { res: 'products', f: { status_product: 'active' } })
  for (const period of ['today', 'yesterday', 'hour', 'month', 'lastmonth', 'all']) await compare('stats ' + period, 'stats', { period })
  await compare('stats bad', 'stats', { period: 'zz' })
  await compare('overview', 'overview')
  await compare('tree', 'tree')
}
