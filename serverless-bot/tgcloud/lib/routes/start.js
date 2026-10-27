// /start, version, back
import { sql, run } from '../db.js'
import { sendmessage, deletemessage } from '../tg.js'
import { sendStartMessage, step, resetProcessing } from '../bot.js'

export const start = [
  async (c) => {
    if (!(c.text === '/start' || c.datain === 'start' || c.text === 'start')) return false
    await sendStartMessage(c, c.from_id, c.keyboard)
    await resetProcessing(c)
    await step(c, 'home')
    return true
  },
  async (c) => {
    if (c.text !== 'version') return false
    await sendmessage(c.from_id, '', null, 'html') // file_get_contents('version'): no version file on Serverless
    return true
  },
  async (c) => {
    if (!(c.text === c.T.users.backbtn || c.datain === 'backuser')) return false
    if (c.datain === 'backuser') await deletemessage(c.from_id, c.message_id)
    await sendmessage(c.from_id, c.T.users.back, c.keyboard, 'html')
    await step(c, 'home')
    await resetProcessing(c)
    return true
  },
]
