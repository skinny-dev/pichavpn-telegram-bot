import { msg, cb } from './lib.mjs'
// renewal of a custom («سرویس دلخواه») service: volume, days, price from the ready plans, invoice, confirm; the flat price too
export default {
  sql: [
    `INSERT INTO product (code_product,name_product,price_product,Volume_constraint,Service_time,Location,agent,note,data_limit_reset,one_buy_status,category,hide_panel,sort_order) VALUES
      ('e1','۲۰ گیگ یک ماهه','30000','20','30','Picha-1','f','','no_reset','0','اقتصادی','[]',1),
      ('e2','۵۰ گیگ یک ماهه','60000','50','30','Picha-1','f','','no_reset','0','اقتصادی','[]',2),
      ('e3','۱۰۰ گیگ سه ماهه','250000','100','90','/all','f','','no_reset','0','ویژه','[]',3)`,
    `INSERT INTO invoice (id_invoice,id_user,username,Service_location,time_sell,name_product,price_product,Volume,Service_time,Status,note,notifctions)
     VALUES ('cus1','1001','u5','Picha-1',UNIX_TIMESTAMP()-100,'⚙️ سرویس دلخواه','40000','25','30','active','','{}')`,
    `UPDATE marzban_panel SET status_extend='on_extend', pricecustomvolume='{"f":"1500","n":"1000","n2":"1000"}', pricecustomtime='{"f":"300","n":"200","n2":"200"}'`,
    `UPDATE user SET Balance='500000', pricediscount='0' WHERE id='1001'`,
    `DELETE FROM Giftcodeconsumed`,
  ],
  updates: [
    cb(1001, 'extend_cus1'),
    msg(1001, 'abc'),
    msg(1001, '5000'),
    msg(1001, '۳۵ گیگ'),
    msg(1001, '0'),
    msg(1001, '45'),
    cb(1001, 'confirmserivce'),
    cb(1001, 'extend_cus1'),
    msg(1001, '200'),
    msg(1001, '120'),
    cb(1001, 'discountextend'),
    msg(1001, 'nothing'),
  ],
}
