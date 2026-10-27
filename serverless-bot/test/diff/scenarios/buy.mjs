import { msg, cb } from './lib.mjs'
// wallet page; buy with the wallet (pre-invoice, create, referral commission, reports); discount code; wallet too low;
// custom service (volume, days); sold out
export default {
  sql: [
    `INSERT INTO product (code_product,name_product,price_product,Volume_constraint,Service_time,Location,agent,note,data_limit_reset,one_buy_status,category,hide_panel,sort_order,status_product) VALUES
      ('b1','۲۰ گیگ یک ماهه','30000','20','30','Picha-1','f','توضیح','no_reset','0','اقتصادی','[]',1,'active'),
      ('b2','۵۰ گیگ یک ماهه','90000','50','30','Picha-1','f','','no_reset','0','اقتصادی','[]',2,'active'),
      ('b3','نامحدود','150000','0','30','/all','f','','no_reset','0','ویژه','[]',3,'disable')`,
    `UPDATE marzban_panel SET MethodUsername='usernameSequential', proxies='{"vless":{}}', sublink='onsublink', config='onconfig', conecton='offconecton',
       customvolume='{"f":"1","n":"1","n2":"1"}', pricecustomvolume='{"f":"1500","n":"1000","n2":"1000"}', pricecustomtime='{"f":"300","n":"200","n2":"200"}', limit_panel='',
       mainvolume='{"f":10,"n":10,"n2":10}', maxvolume='{"f":400,"n":400,"n2":400}', maintime='{"f":1,"n":1,"n2":1}', maxtime='{"f":365,"n":365,"n2":365}'`,
    `UPDATE user SET Balance='50000', number_username='100', affiliates='1002', pricediscount='0', codeInvitation=NULL WHERE id='1001'`,
    `INSERT INTO DiscountSell (codeDiscount,price,limitDiscount,usedDiscount,agent,usefirst,useuser,code_product,code_panel,time,type) VALUES ('BUY20','20','10','0','allusers','0','1','all','/all','0','buy')`,
    `UPDATE affiliates SET status_commission='oncommission', porsant_one_buy='off_buy_porsant'`,
    `UPDATE setting SET affiliatespercentage='10', scorestatus='1'`,
  ],
  updates: [
    msg(1001, '/wallet'),
    cb(1001, 'account'),
    msg(1001, '/buy'),
    cb(1001, 'prodcutservice_b3'),
    cb(1001, 'prodcutservice_b1'),
    cb(1001, 'confirmandgetservice'),
    cb(1001, 'buy'),
    cb(1001, 'prodcutservice_b2'),
    cb(1001, 'aptdc'),
    msg(1001, 'NOPE'),
    msg(1001, 'buy20'),
    cb(1001, 'confirmandgetserviceDiscount'),
    cb(1001, 'buy'),
    cb(1001, 'customsellvolume'),
    msg(1001, 'abc'),
    msg(1001, '30'),
    msg(1001, '400'),
    msg(1001, '45'),
    cb(1001, 'confirmandgetservice'),
    cb(1001, 'productsoldout'),
  ],
}
