// Admin keyboards of keyboard.php
import { J } from '../php.js'
import { GATEWAY_BTN } from './gateways.js'

export function keyboardAdmin(c) {
  const T = c.T, rule = c.adminRow?.rule
  if (rule === 'administrator') return J({ keyboard: [
    [{ text: T.Admin.Status.btn }],
    [{ text: T.Admin.btnKeyboard.managementPanel }, { text: T.Admin.btnKeyboard.addPanel }],
    [{ text: T.keyboard.quickSetTimePrice }, { text: T.keyboard.quickSetVolumePrice }],
    [{ text: T.Admin.btnKeyboard.manageUser }, { text: T.keyboard.shopSettings }],
    [{ text: T.keyboard.financial }, { text: T.keyboard.cronStatus }],
    [{ text: GATEWAY_BTN }],
    [{ text: T.keyboard.supportSection }, { text: T.keyboard.educationSection }],
    [{ text: T.keyboard.botReport }],
    [{ text: T.keyboard.generalSettings }, { text: T.keyboard.pendingReceipts }],
    [{ text: T.bottext.open_button }],
    [{ text: '🖥 پنل مدیریت (مینی‌اپ)' }],
    [{ text: T.users.backbtn }],
  ], resize_keyboard: true })
  if (rule === 'Seller') return J({ keyboard: [[{ text: T.Admin.Status.btn }], [{ text: T.keyboard.manageUser }], [{ text: T.users.backbtn }]], resize_keyboard: true })
  if (rule === 'support') return J({ keyboard: [[{ text: T.keyboard.manageUser }], [{ text: '🖥 پنل مدیریت (مینی‌اپ)' }], [{ text: T.users.backbtn }]], resize_keyboard: true })
  return null
}
export const backAdmin = (c) => J({ keyboard: [[{ text: c.T.Admin.backAdminBtn }, { text: c.T.Admin.backMenuBtn }]], resize_keyboard: true })
