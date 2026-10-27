import { msg, cb } from './lib.mjs'
// renewal with categories, personal discount, cashback, price order: duration list → product → invoice → discount code → confirm (wallet), short wallet, the current plan again
export default {
  sql: [
    `DELETE FROM Giftcodeconsumed`, `DELETE FROM DiscountSell`, `DELETE FROM service_other`,
    `INSERT INTO product (code_product,name_product,price_product,Volume_constraint,Service_time,Location,agent,note,data_limit_reset,one_buy_status,category,hide_panel,sort_order) VALUES
      ('e1','۲۰ گیگ یک ماهه','30000','20','30','Picha-1','f','توضیح','no_reset','0','اقتصادی','[]',1),
      ('e2','۵۰ گیگ یک ماهه','90000','50','30','Picha-1','f','','no_reset','0','اقتصادی','[]',2),
      ('e3','۱۰۰ گیگ سه ماهه','250000','100','90','/all','f','','no_reset','0','ویژه','[]',3)`,
    `INSERT INTO invoice (id_invoice,id_user,username,Service_location,time_sell,name_product,price_product,Volume,Service_time,Status,note,notifctions)
     VALUES ('liv1','1001','u5','Picha-1',UNIX_TIMESTAMP()-100,'۲۰ گیگ یک ماهه','30000','20','30','active','','{}')`,
    `INSERT INTO DiscountSell (codeDiscount,price,limitDiscount,usedDiscount,agent,usefirst,useuser,code_product,code_panel,time,type)
     VALUES ('OFF20','20','10','0','allusers','0','1','all','/all','0','all')`,
    `UPDATE marzban_panel SET status_extend='on_extend'`,
    `UPDATE setting SET statuscategory='offcategory', statuscategorygenral='oncategorys'`,
    `UPDATE user SET pricediscount='10', Balance='500000' WHERE id='1001'`,
    `INSERT INTO shopSetting (Namevalue,value) VALUES ('chashbackextend','5') ON DUPLICATE KEY UPDATE value='5'`,
    `INSERT INTO shopSetting (Namevalue,value) VALUES ('product_sort','price_desc') ON DUPLICATE KEY UPDATE value='price_desc'`,
  ],
  updates: [
    cb(1002, 'extend_liv1'),
    cb(1001, 'extend_liv1'),
    cb(1001, 'extcat_1'),
    cb(1001, 'extcat_2'),
    cb(1001, 'extcat_3'),
    cb(1001, 'serviceextendselect_e1'),
    cb(1001, 'discountextend'),
    msg(1001, 'NOPE'),
    msg(1001, 'OFF20'),
    cb(1001, 'confirmserdiscount'),
    cb(1001, 'extend_liv1'),
    cb(1001, 'serviceextendselect_e2'),
    cb(1001, 'confirmserivce'),
    cb(1001, 'extend_liv1'),
    cb(1001, 'exntedagei'),
    cb(1001, 'serviceextendselect_zz'),
  ],
}
