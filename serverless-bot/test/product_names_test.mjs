// Dynamic product names: the converter (preview / apply / restore), fidelity of what customers see, and the name-based lookups still finding the product.
//   node --no-warnings --import ./register.mjs product_names_test.mjs <export dir>
import { seed } from './seed.mjs'
import { db } from 'sdk'
import { sql } from 'sdk/db'
let fails = 0
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' ' + extra}`); if (!ok) fails++ }
await seed(process.argv[2])
const { systemContext } = await import('../tgcloud/lib/bot.js')
const h = (await import('../tgcloud/endpoints/admin_report.js')).default
const { productByInvoiceName } = await import('../tgcloud/lib/db.js')
const { productName, nameMatchesProduct } = await import('../tgcloud/lib/php.js')
const { keyboardProduct } = await import('../tgcloud/lib/catalog.js')
const run = (extra = {}) => h({ tool: 'product_names', ...extra }, {})
const before = await db.all(sql`SELECT id, name_product, Location, Volume_constraint, Service_time, price_product FROM product ORDER BY id`)

const pre = await run()
check('preview: nothing is written', pre.preview_only && (await db.all(sql`SELECT name_product FROM product ORDER BY id`)).every((r, i) => r.name_product === before[i].name_product))
check('preview: every shop product can be made dynamic, no warnings', pre.will_change === before.length && pre.with_warnings === 0, JSON.stringify({ w: pre.will_change, n: before.length, ww: pre.with_warnings }))
check('what a customer sees is IDENTICAL to the old name (same digits too)', pre.items.every((i) => i.customer_sees === before.find((b) => b.id === i.id).name_product), JSON.stringify(pre.items[0]))
check('Persian-digit names become the _fa tokens', pre.items[0].new === '{volume_fa} گیگ | {days_fa} روز', pre.items[0].new)

const applied = await run({ apply: true })
const after = await db.all(sql`SELECT id, name_product FROM product ORDER BY id`)
check('apply: names are written and a backup exists', applied.applied === before.length && after.every((r) => /\{volume_fa\}/.test(r.name_product)))
check('apply twice changes nothing (already dynamic)', (await run({ apply: true })).applied === 0)

// the bot still shows the same text and finds the product by an invoice's stored name
const c = { ...(await systemContext()), from_id: '9701' }
const kb = JSON.parse(await keyboardProduct(c, 'p', await db.all(sql`SELECT * FROM product WHERE id IN (1, 6)`), 0, 'prodcutservice_'))
check('the product list shows the same names as before', kb.inline_keyboard[0][0].text === before[0].name_product && kb.inline_keyboard[1][0].text === before[5].name_product, JSON.stringify(kb.inline_keyboard.slice(0, 2)))
const panelName = before[0].Location
const p1 = await productByInvoiceName('۱۰ گیگ | ۳۰ روز', panelName), p6 = await productByInvoiceName('۴۰ گیگ | ۶۰ روز', panelName)
check('an old stored name finds ITS product (not another with the same template)', p1 && p1.id === 1 && p6 && p6.id === 6, JSON.stringify([p1?.id, p6?.id]))
check('a name that matches no product finds nothing', (await productByInvoiceName('۹۹ گیگ | ۱ روز', panelName)) === null)

// a name carrying the price
await db.run(sql`UPDATE product SET name_product = '10 گیگ — {price} تومان' WHERE id = 1`)
const pr = (await db.get(sql`SELECT * FROM product WHERE id = 1`))
check('a stored name with ANY price still finds the product (price changes daily)', nameMatchesProduct('10 گیگ — 54,000 تومان', pr) && nameMatchesProduct('10 گیگ — 60,000 تومان', pr) && !nameMatchesProduct('25 گیگ — 54,000 تومان', pr))
check('productName fills volume and price for the viewer', productName(pr.name_product, pr, 54000) === '10 گیگ — 54,000 تومان')

// a name that disagrees with its data is reported and never touched; a baked price is made dynamic
await db.run(sql`UPDATE product SET name_product = '25 گیگ — 60,000 تومان' WHERE id = 2`)
await db.run(sql`UPDATE product SET name_product = '40 گیگ — 210,000 تومان' WHERE id = 3`)
const mix = await run()
const i2 = mix.items.find((i) => i.id === 2), i3 = mix.items.find((i) => i.id === 3)
check('a disagreeing name (25 گیگ but price 60,000 ≠ 150,000) is warned about and left unchanged', i2.warnings && i2.warnings.length >= 1 && i2.new.includes('{volume}') && /60,000/.test(i2.new), JSON.stringify(i2))
check('a baked price that equals the product price becomes {price}; the partner sees the partner price', i3.new === '{volume} گیگ — {price} تومان' && i3.partner_15pct_sees === '40 گیگ — 178,500 تومان', JSON.stringify(i3))
const ap2 = await run({ apply: true })
check('products with warnings are NOT written by apply', (await db.get(sql`SELECT name_product FROM product WHERE id = 2`)).name_product === '25 گیگ — 60,000 تومان' && ap2.with_warnings >= 1)

// «۲۹۰ هزار تومان» style and the explicit trust of the database price
await db.run(sql`UPDATE product SET name_product = '۱ گیگ: ۲۹۰ هزار تومان', Volume_constraint = '1', price_product = '290000' WHERE id = 4`)
await db.run(sql`UPDATE product SET name_product = '25 گیگ — 144,000 تومان', Volume_constraint = '25', price_product = '120000' WHERE id = 5`)
const k = (await run()).items
const i4 = k.find((i) => i.id === 4), i5 = k.find((i) => i.id === 5)
check('the «هزار تومان» style stays: ۲۹۰ هزار for the customer, ۲۴۶٫۵ هزار for a 15% partner', i4.new === '{volume_fa} گیگ: {price_k_fa} هزار تومان' && i4.customer_sees === '۱ گیگ: ۲۹۰ هزار تومان' && i4.partner_15pct_sees === '۱ گیگ: ۲۴۶٫۵ هزار تومان'.replace('٫', '.').replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]), JSON.stringify(i4))
check('a name that disagrees with the price stays untouched by default', i5.warnings && i5.warnings.length === 1 && !/\{price\}/.test(i5.new))
const t = (await run({ trust_price: [5] })).items.find((i) => i.id === 5)
check('trust_price for that id only: the database price becomes the truth', t.new === '{volume} گیگ — {price} تومان' && !t.warnings && t.customer_sees === '25 گیگ — 120,000 تومان', JSON.stringify(t))

// restore
const rs = await run({ restore: true })
check('restore puts the old names back', rs.restored >= 1 && (await db.get(sql`SELECT name_product FROM product WHERE id = 3`)).name_product === before[2].name_product, JSON.stringify(rs))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
