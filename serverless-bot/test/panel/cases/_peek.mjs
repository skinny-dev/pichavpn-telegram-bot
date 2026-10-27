export default async function ({ php, handle, TG }) {
  for (const [r, q, b] of [['fin_party_save', {}, { name: 'a', roles: ['customer'] }], ['fin_capital', {}, { amount: 5000, money_account: 'cash', direction: 'in', date: '1405/01/10' }], ['fin_sale', {}, { party_id: 1, amount: 100000, date: '1405/02/01' }], ['fin_pl', { range: 'all' }], ['fin_integrity']]) {
    console.log(r, JSON.stringify((await php(r, q, b)).body).slice(0, 260))
    console.log(r, JSON.stringify((await handle(r, q, b, TG)).body).slice(0, 260))
  }
}
