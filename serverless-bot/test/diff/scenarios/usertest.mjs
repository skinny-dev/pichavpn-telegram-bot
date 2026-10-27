import { msg, cb } from './lib.mjs'
// free test account: location list, a sequential username, a custom username (invalid, then valid), the limit
export default {
  sql: [
    `UPDATE marzban_panel SET TestAccount='ONTestAccount', val_usertest='500', time_usertest='24', MethodUsername='usernameSequential', proxies='{"vless":{}}',
       sublink='onsublink', config='onconfig', on_hold_test='0', conecton='offconecton'`,
    `CREATE TEMPORARY TABLE t AS SELECT * FROM marzban_panel WHERE name_panel='Picha-1'; UPDATE t SET id = id + 100, name_panel='Picha-2', code_panel='P2', MethodUsername='customUsername', config='offconfig';
     INSERT INTO marzban_panel SELECT * FROM t`,
    `UPDATE user SET limit_usertest='1', number='none', step='home' WHERE id IN ('1001','1002')`,
    `UPDATE setting SET get_number='offAuthenticationphone'`,
  ],
  updates: [
    msg(1001, '/free'),
    cb(1001, 'locationtest_P1'),
    msg(1002, '/free', { username: 'sara' }),
    cb(1002, 'locationtest_P2', 777, { username: 'sara' }),
    msg(1002, 'bad name!', { username: 'sara' }),
    msg(1002, 'Sara_Test', { username: 'sara' }),
    msg(1001, '/free'),
  ],
}
