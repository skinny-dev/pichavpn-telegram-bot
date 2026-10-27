import { msg, cb } from './lib.mjs'
export default {
  sql: [
    `INSERT INTO invoice (id_invoice,id_user,username,Service_location,time_sell,name_product,price_product,Volume,Service_time,Status,note,notifctions)
     VALUES ('liv1','1001','u5','Picha-1',UNIX_TIMESTAMP()-100,'۳۰ گیگ یک ماهه','65000','30','30','active','مامان','{}'),
            ('end1','1001','u8','Picha-1',UNIX_TIMESTAMP()-90,'۳۰ گیگ یک ماهه','65000','30','30','end_of_time',NULL,'{}')`,
  ],
  updates: [
    cb(1001, 'subscriptionurl_liv1'),
    msg(1001, '/sub u5'),
    msg(1001, '/sub nobody'),
    cb(1002, 'subscriptionurl_liv1'),
    cb(1001, 'config_liv1'),
    msg(1001, '/link u5'),
    cb(1001, 'configget_liv1_0'),
    cb(1001, 'configget_liv1_1520'),
    cb(1002, 'configget_liv1_0'),
    cb(1001, 'changestatus_liv1'),
    cb(1001, 'confirmaccountdisable_liv1'),
    cb(1001, 'removeauto-end1'),
    cb(1002, 'removeauto-liv1'),
  ],
}
