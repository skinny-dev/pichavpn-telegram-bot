import { msg, cb } from './lib.mjs'
// bulk purchase: count, location, product, pre-invoice, pay from the wallet and create 3 services; too many; wallet too low
export default {
  sql: [
    `INSERT INTO product (code_product,name_product,price_product,Volume_constraint,Service_time,Location,agent,note,data_limit_reset,one_buy_status,category,hide_panel,sort_order,status_product) VALUES
      ('k1','۱۰ گیگ یک ماهه','20000','10','30','Picha-1','n','','no_reset','0','اقتصادی','[]',1,'active'),
      ('k2','۵۰ گیگ یک ماهه','90000','50','30','Picha-1','n','','no_reset','0','اقتصادی','[]',2,'active')`,
    `UPDATE marzban_panel SET MethodUsername='usernameSequential', proxies='{"vless":{}}', sublink='onsublink', config='offconfig', conecton='offconecton', status='active'`,
    `UPDATE user SET Balance='100000', number_username='5', agent='n', pricediscount='0', step='home' WHERE id='1002'`,
    `UPDATE setting SET bulkbuy='onbulk'`,
    `INSERT INTO PaySetting (NamePay, ValuePay) VALUES ('minbalancebuybulk', '10000')`,
  ],
  updates: [
    cb(1002, 'kharidanbuh', 777, { username: 'sara' }),
    msg(1002, '20', { username: 'sara' }),
    msg(1002, 'abc', { username: 'sara' }),
    msg(1002, '3', { username: 'sara' }),
    cb(1002, 'locationom_P1', 777, { username: 'sara' }),
    cb(1002, 'prodcutserviceom_k1', 777, { username: 'sara' }),
    cb(1002, 'confirmandgetservice', 777, { username: 'sara' }),
    cb(1002, 'kharidanbuh', 777, { username: 'sara' }),
    msg(1002, '2', { username: 'sara' }),
    cb(1002, 'locationom_P1', 777, { username: 'sara' }),
    cb(1002, 'prodcutserviceom_k2', 777, { username: 'sara' }),
    cb(1002, 'confirmandgetservice', 777, { username: 'sara' }),
  ],
}
