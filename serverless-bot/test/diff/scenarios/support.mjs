import { msg, cb } from './lib.mjs'
import { crc32, dechex } from '../../../tgcloud/lib/php.js'
// help articles (list, category, article with and without media), support menu, a ticket, the admin's answer, the customer's reply
const cat = 'اندروید'
export default {
  sql: [
    `DELETE FROM help`, `DELETE FROM departman`, `DELETE FROM support_message`,
    `INSERT INTO help (id, name_os, Media_os, type_Media_os, category, Description_os) VALUES
      (1, 'v2rayNG', '', '', '${cat}', 'آموزش v2rayNG'), (2, 'Happ', 'AgACAgQAAxkBAAI', 'photo', '${cat}', 'آموزش Happ'), (3, 'iPhone', '', '', 'آیفون', 'آموزش آیفون')`,
    `INSERT INTO departman (id, idsupport, name_departman) VALUES (1, '5550001', 'فنی'), (2, '5550002', 'مالی')`,
    `INSERT INTO support_message (Tracking, idsupport, iduser, name_departman, text, result, time, status) VALUES ('tk1', '5550001', '1001', 'فنی', 'وصل نمیشه', '', '2026/10/01 10:00:00', 'Unseen')`,
    `UPDATE setting SET categoryhelp='0', statussupportpv='offpvsupport'`,
  ],
  updates: [
    msg(1001, '/help'),
    cb(1001, 'helpos_1'),
    cb(1001, 'helpos_2'),
    cb(1001, 'helpctg_' + dechex(crc32(cat))),
    cb(1001, 'helpsoon'),
    msg(1001, '/support'),
    cb(1001, 'supportbtns'),
    cb(1001, 'support'),
    cb(1001, 'departman_1'),
    msg(1001, 'سلام، کانفیگ وصل نمیشه'),
    cb(5550001, 'Responsesupport_tk1'),
    msg(5550001, 'سلام، لینک رو دوباره بگیرید'),
    cb(5550002, 'Responsesupport_tk1'),
    cb(1001, 'Responsesusera_tk1'),
    msg(1001, 'ممنون درست شد'),
    cb(1001, 'fqQuestions'),
  ],
}
