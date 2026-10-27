// extra panel modules register themselves here
import { extra } from './index.js'
import * as support from './support.js'

Object.assign(extra.exact, {
  support_unread: () => support.unread(),
  support_threads: (r, q) => support.threads(q),
  support_thread: (r, q) => support.thread(q),
  support_reply: (r, q, b, admin) => support.reply(b, admin),
  support_close: (r, q, b) => support.close(b),
  support_file: (r, q, b, admin) => support.file(q, admin),
})
import * as payments from './payments.js'
import * as orders from './orders.js'
import { activity } from './activity.js'

Object.assign(extra.exact, {
  pay_pending: (r, q) => payments.pending(q),
  pay_confirm: (r, q, b) => payments.confirm(b),
  payment_create: (r, q, b, admin) => payments.create(b, admin),
  order_options: () => orders.options(),
  order_create: (r, q, b, admin) => orders.create(b, admin),
  activity: (r, q) => activity(q),
})
import * as referrals from './referrals.js'
import * as promo from './promo.js'

Object.assign(extra.exact, {
  referrals: () => referrals.list(),
  referral_save: (r, q, b) => referrals.save(b),
  referral_delete: (r, q, b) => referrals.remove(b),
  referral_payout: (r, q, b) => referrals.payout(b),
  referral_book_cost: (r, q, b, admin) => referrals.bookCost(b, admin),
  referral_payouts: (r, q) => referrals.payouts(q),
  admins: (r, q, b, admin) => referrals.admins(admin),
  admin_save: (r, q, b, admin) => referrals.adminSave(b, admin),
  admin_delete: (r, q, b, admin) => referrals.adminDelete(b, admin),
})
extra.prefix.push(['promo_', promo.route])
