import { msg, cb } from './lib.mjs'
// referral page, membership gift, renew list + pages, note, agent panel / custom name / agent request, message to
// the admins, /privacy, apps, language
const sara = { username: 'sara' }
export default {
  sql: [
    `UPDATE affiliates SET description='دعوت کن و هدیه بگیر', Discount='onDiscountaffiliates', price_Discount='10000', status_commission='oncommission', id_media='none'`,
    `UPDATE setting SET affiliatespercentage='10', agentreqprice='0'`,
    `UPDATE user SET affiliates='1002', Balance='20000' WHERE id='1001'`,
    `DELETE FROM reagent_report`, `INSERT INTO reagent_report (user_id, get_gift, time, reagent) VALUES ('1001', 0, '2026/10/01 10:00:00', '1002')`,
    `INSERT INTO invoice (id_invoice,id_user,username,Service_location,time_sell,name_product,price_product,Volume,Service_time,Status,note,notifctions,refral) VALUES
      ('n1','1001','u21','Picha-1',UNIX_TIMESTAMP()-100,'۳۰ گیگ','65000','30','30','active','گوشی','{}','1002'),
      ('n2','1001','u22','Picha-1',UNIX_TIMESTAMP()-90,'۳۰ گیگ','65000','30','30','end_of_time',NULL,'{}','')`,
    `DELETE FROM Requestagent`, `DELETE FROM app`, `INSERT INTO app (name, link) VALUES ('v2rayNG', 'https://example.com/ng')`,
    `UPDATE user SET agent='n' WHERE id='1002'`,
  ],
  updates: [
    cb(1001, 'affiliatesbtn'),
    cb(1001, 'get_gift_start'),
    cb(1001, 'get_gift_start'),
    cb(1001, 'extendbtn'),
    cb(1001, 'next_page_extends'),
    cb(1001, 'previous_page_extends'),
    cb(1001, 'changenote_n1'),
    msg(1001, 'لپ تاپ (خانه)'),
    cb(1002, 'agentpanel', 777, sara),
    cb(1002, 'selectname', 777, sara),
    msg(1002, '1bad', sara),
    msg(1002, 'sarashop', sara),
    cb(1001, 'requestagent'),
    msg(1001, 'می‌خوام نماینده بشم'),
    cb(1001, 'requestagent'),
    cb(1001, 'Responseuser'),
    msg(1001, 'سلام مدیر'),
    msg(1001, '/privacy'),
    cb(1001, 'linkappdownlod'),
    cb(1001, 'ّchange_language'),
    cb(1001, 'setlang:fa'),
  ],
}
