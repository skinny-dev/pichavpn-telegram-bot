import { msg, cb } from './lib.mjs'
// mock panel users are u0…u449 (active, data_limit 1, sub /sub/x); seed services are on panel1 (no such panel)
export default {
  sql: [
    `INSERT INTO invoice (id_invoice,id_user,username,Service_location,time_sell,name_product,price_product,Volume,Service_time,Status,note,notifctions)
     VALUES ('liv1','1001','u5','Picha-1',UNIX_TIMESTAMP()-100,'۳۰ گیگ یک ماهه','65000','30','30','active','مامان','{}'),
            ('liv2','1001','u7','Picha-1',UNIX_TIMESTAMP()-50,'سرویس تست','0','1','1','active',NULL,'{}')`,
    `INSERT INTO shopSetting (Namevalue, value) VALUES ('statusextra','onextra') ON DUPLICATE KEY UPDATE value='onextra'`,
  ],
  updates: [
    msg(1001, '🛍 سرویس های من'),
    cb(1001, 'product_liv1'),
    cb(1001, 'updateproduct_liv1'),
    cb(1001, 'product_liv2'),
    cb(1001, 'backorder'),
    cb(1001, 'next_page'),
    cb(1001, 'previous_page'),
    cb(1001, 'product_inv1'),
    cb(1001, 'product_nope'),
    cb(1002, 'product_liv1'),
    cb(1001, 'notusernameme'),
    msg(1001, 'u9'),
    cb(1001, 'locationnotuser_P1'),
  ],
}
