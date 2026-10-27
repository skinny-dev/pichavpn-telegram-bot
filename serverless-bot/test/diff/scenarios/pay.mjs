import { msg, cb } from './lib.mjs'
// wallet top-up by card-to-card (amount, card, receipt photo, admin approves); a purchase paid by card (receipt,
// admin approves → service created); a rejected receipt; a gift code; a Telegram Stars payment
const photo = (from, caption = 'رسید') => msg(from, undefined, { message: { photo: [{ file_id: 'AgACsmall' }, { file_id: 'AgACbig' }], caption } })
export default {
  sql: [
    `DELETE FROM card_number`, `INSERT INTO card_number (cardnumber, namecard) VALUES ('6037991122334455', 'علی رضایی')`,
    `DELETE FROM Payment_report WHERE id_order IN ('star1')`,
    `INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice) VALUES ('1001', 'star1', '2026/10/27 10:00:00', '40000', 'Unpaid', 'Star Telegram', '0|0')`,
    `INSERT INTO product (code_product,name_product,price_product,Volume_constraint,Service_time,Location,agent,note,data_limit_reset,one_buy_status,category,hide_panel,sort_order,status_product) VALUES
      ('p1','۵۰ گیگ یک ماهه','90000','50','30','Picha-1','f','','no_reset','0','اقتصادی','[]',1,'active')`,
    `UPDATE marzban_panel SET MethodUsername='usernameSequential', proxies='{"vless":{}}', sublink='onsublink', config='offconfig', conecton='offconecton', status='active'`,
    `UPDATE user SET Balance='10000', number_username='300', pricediscount='0', cardpayment='1', step='home' WHERE id='1001'`,
    `UPDATE shopSetting SET value='ondirectbuy' WHERE Namevalue='statusdirectpabuy'`,
    `DELETE FROM Discount`, `INSERT INTO Discount (code, price, limituse, limitused) VALUES ('GIFT5', '5000', '10', '0')`,
  ],
  updates: [
    cb(1001, 'Add_Balance'),
    msg(1001, '500'),
    msg(1001, '50000'),
    cb(1001, 'cart_to_offline'),
    // the order id is random: the runner fills it in from the database
    cb(1001, 'sendresidcart-{{order:1001:cart to cart}}'),
    msg(1001, 'متن'),
    photo(1001),
    cb(5550001, 'Confirm_pay_{{order:1001:cart to cart}}', 900),
    cb(5550002, 'Confirm_pay_{{order:1001:cart to cart}}', 901),
    cb(1001, 'buy'),
    cb(1001, 'prodcutservice_p1'),
    cb(1001, 'confirmandgetservice'),
    cb(1001, 'cart_to_offline'),
    cb(1001, 'sendresidcart-{{order:1001:cart to cart}}'),
    photo(1001, 'رسید خرید'),
    cb(5550001, 'Confirm_pay_{{order:1001:cart to cart}}', 902),
    cb(1001, 'Add_Balance'),
    msg(1001, '30000'),
    cb(1001, 'cart_to_offline'),
    cb(1001, 'sendresidcart-{{order:1001:cart to cart}}'),
    photo(1001),
    cb(5550001, 'reject_pay_{{order:1001:cart to cart}}', 903),
    msg(5550001, 'رسید جعلی است'),
    cb(1001, 'Discount'),
    msg(1001, 'NOPE'),
    msg(1001, 'GIFT5'),
    msg(1001, 'GIFT5'),
    { update_id: 990001, pre_checkout_query: { id: 'pcq1', from: { id: 1001, first_name: 'Ali', username: 'ali' }, currency: 'XTR', total_amount: 25, invoice_payload: 'star1' } },
    msg(1001, undefined, { message: { successful_payment: { currency: 'XTR', total_amount: 25, invoice_payload: 'star1', telegram_payment_charge_id: 'ch1' } } }),
  ],
}
