import { msg, cb } from './lib.mjs'
export default {
  updates: [
    msg(1001, '/start'),
    msg(1001, 'start'),
    cb(1001, 'backuser'),
    msg(1001, 'سلام'),         // invalid command
    msg(1002, '/start'),        // sara (agent)
    msg(1003, '/start'),        // reza: blocked in the seed?
    msg(4242, '/start', { first_name: 'New', username: 'newbie' }),  // new user: rules / report / insert
    msg(4242, 'برگشت'),
  ],
}
