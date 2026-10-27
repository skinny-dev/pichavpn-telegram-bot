import { msg, cb } from './lib.mjs'
// the admin's chat tools: statistics, receipts waiting, balance by hand, a customer's request to delete a service
export default {
  sql: [
    `UPDATE marzban_panel SET sublink='onsublink', config='onconfig', proxies='{"vless":{}}', conecton='offconecton'`,
    `INSERT INTO invoice (id_invoice,id_user,username,Service_location,time_sell,name_product,price_product,Volume,Service_time,Status,note,notifctions) VALUES
      ('a1i','1001','m101','Picha-1',UNIX_TIMESTAMP()-100,'۳۰ گیگ یک ماهه','65000','30','30','active','','{}'),
      ('a2i','1001','m102','Picha-1',UNIX_TIMESTAMP()-90,'۳۰ گیگ یک ماهه','65000','30','30','active','','{}'),
      ('a3i','1001','m110','Picha-1',UNIX_TIMESTAMP()-80,'۳۰ گیگ یک ماهه','65000','30','30','active','','{}')`,
    `DELETE FROM cancel_service`,
    `INSERT INTO cancel_service (id_user, username, description, status) VALUES ('1001','m101','x','waiting'), ('1001','m102','x','waiting'), ('1001','m110','x','waiting')`,
    `DELETE FROM Payment_report WHERE id_order IN ('w1','w2')`,
    `INSERT INTO Payment_report (id_user, id_order, time, price, payment_Status, Payment_Method, id_invoice) VALUES ('1001','w1','2026/10/27 10:00:00','50000','waiting','cart to cart','0|0'), ('1002','w2','2026/10/27 10:05:00','70000','waiting','cart to cart','0|0')`,
    `UPDATE user SET Balance='10000', step='home' WHERE id='1001'`,
  ],
  updates: [
    cb(5550001, 'pstat_yesterday'),
    msg(5550001, '💵 رسید های تایید نشده'),
    cb(5550001, 'showinfopay_w1'),
    cb(5550001, 'removeresid_w2'),
    cb(5550001, 'addbalanceuser_1001'),
    msg(5550001, 'abc'),
    msg(5550001, '5000'),
    cb(5550001, 'lowbalanceuser_1001'),
    msg(5550001, '2000'),
    cb(5550001, 'unbanuserr_1001'),
    cb(5550001, 'rejectremoceserviceadmin-a1i'),
    msg(5550001, 'به دلیل نیاز به بررسی'),
    cb(5550001, 'rejectremoceserviceadmin-a1i'),
    cb(5550001, 'remoceserviceadmin-a2i'),
    cb(5550001, 'remoceserviceadmin-a2i'),
    cb(5550001, 'remoceserviceadminmanual-a3i'),
    msg(5550001, 'x'),
    msg(5550001, '15000'),
    cb(5550001, 'sendmessageuser_1001'),
    msg(5550001, 'سلام از ادمین'),
    msg(5550001, '1'),
  ],
}
