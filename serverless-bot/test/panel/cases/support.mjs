export default async function ({ compare }) {
  await compare('unread', 'support_unread')
  for (const f of ['open', 'all', 'closed']) await compare('threads ' + f, 'support_threads', { f })
  await compare('threads q', 'support_threads', { q: '700' })
  await compare('thread', 'support_thread', { uid: '7001' })
  await compare('thread missing', 'support_thread', { uid: '1' })
  await compare('reply', 'support_reply', {}, { uid: '7001', text: 'سلام <b>' })
  await compare('reply empty', 'support_reply', {}, { uid: '7001', text: '' })
  await compare('reply missing', 'support_reply', {}, { uid: '999', text: 'x' })
  const mask = (x) => JSON.parse(JSON.stringify(x).replace(/"(time|by|id)":"[^"]*"/g, '"$1":"x"'))
  await compare('thread after', 'support_thread', { uid: '7001' }, undefined, { pick: mask })
  await compare('close', 'support_close', {}, { uid: '7001' })
  await compare('threads after', 'support_threads', { f: 'all' }, undefined, { pick: mask })
}
