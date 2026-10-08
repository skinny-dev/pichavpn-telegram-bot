#!/usr/bin/env python3
"""Integration test for dashboard/api.php. Usage: api_test.py http://127.0.0.1:8099 admin testpass123
Needs a DB seeded with tests/seed_test_db.sql."""
import sys, json, urllib.request, urllib.parse, http.cookiejar

base, user, pw = sys.argv[1].rstrip('/'), sys.argv[2], sys.argv[3]
jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
csrf = ''
fails = 0


def call(route, body=None, **q):
    url = f"{base}/dashboard/api.php?r={route}" + ''.join(f"&{k}={urllib.parse.quote(str(v))}" for k, v in q.items())
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method='POST' if body is not None else 'GET')
    req.add_header('Content-Type', 'application/json')
    if csrf:
        req.add_header('X-CSRF-Token', csrf)
    try:
        r = op.open(req)
        return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')


def check(name, cond, extra=''):
    global fails
    print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'  -> {extra}'))
    if not cond:
        fails += 1


s, r = call('list', res='users'); check('unauthenticated list is 401', s == 401, (s, r))
s, r = call('login', {'username': user, 'password': 'wrong'}); check('bad password 401', s == 401, (s, r))
s, r = call('login', {'username': user, 'password': pw}); check('login ok', s == 200 and r['ok'], (s, r)); csrf = r.get('csrf', '')
csrf_bak, csrf = csrf, 'bad'
s, r = call('update', {'res': 'users', 'id': '1001', 'field': 'Balance', 'value': '1'}); check('write without CSRF is 403', s == 403, (s, r))
csrf = csrf_bak

s, r = call('schema'); check('schema has 7 resources', s == 200 and len(r['resources']) == 7, r)
s, r = call('list', res='users'); check('list users total=3', r.get('total') == 3, r)
s, r = call('list', res='users', q='sara'); check('search finds sara', r.get('total') == 1, r)
s, r = call('list', res='users', sort='Balance', dir='ASC'); check('numeric sort asc', [x['id'] for x in r['rows']][:1] == ['1002'], r)
s, r = call('list', res='users', **{'f[agent]': 'n2'}); check('filter agent=n2', r.get('total') == 1, r)
s, r = call('list', res='users', sort="id`;DROP TABLE user;--"); check('bad sort key ignored (no 500)', s == 200, (s, r))

# balance edit logs accounting entry
s, r = call('update', {'res': 'users', 'id': '1001', 'field': 'Balance', 'value': '75,000'}); check('balance edit with comma', s == 200 and r['ok'], (s, r))
s, r = call('list', res='payments', q='admin'); check('balance change logged as payment', r.get('total') == 1 and r['rows'][0]['Payment_Method'] == 'add balance by admin' and r['rows'][0]['price'] == '25000', r)
s, r = call('update', {'res': 'users', 'id': '1001', 'field': 'Balance', 'value': 'abc'}); check('non-numeric balance rejected 422', s == 422, (s, r))
s, r = call('update', {'res': 'users', 'id': '1001', 'field': 'id', 'value': '9'}); check('pk not editable 403', s == 403, (s, r))
s, r = call('update', {'res': 'users', 'id': '1001', 'field': 'agent', 'value': 'zzz'}); check('bad enum rejected', s == 422, (s, r))
s, r = call('update', {'res': 'users', 'id': 'nope', 'field': 'score', 'value': '1'}); check('missing row 404', s == 404, (s, r))
s, r = call('update', {'res': 'payments', 'id': '1', 'field': 'price', 'value': '1'}); check('payments read-only', s == 403, (s, r))

# products + categories
s, r = call('create', {'res': 'products', 'row': {'name_product': 'محصول تازه', 'price_product': '12 000', 'Volume_constraint': 10, 'category': 'خالی'}}); check('create product', s == 200 and r['ok'], (s, r)); newp = r.get('id')
s, r = call('list', res='products', q='محصول تازه'); check('new product sorted last', int(r['rows'][0]['sort_order']) > 4, r)
s, r = call('create', {'res': 'products', 'row': {'name_product': 'محصول تازه'}}); check('duplicate product name rejected', s == 422, (s, r))
s, r = call('create', {'res': 'products', 'row': {}}); check('missing required rejected', s == 422, (s, r))
s, r = call('update', {'res': 'categories', 'id': '3', 'field': 'remark', 'value': 'جدید'}); check('rename category', s == 200, (s, r))
s, r = call('list', res='products', **{'f[category]': 'جدید'}); check('rename cascades to products', r.get('total') == 1, r)
s, r = call('delete', {'res': 'categories', 'id': '3'}); check('delete non-empty category blocked 409', s == 409, (s, r))
s, r = call('tree'); check('tree: 3 categories + 1 uncategorized', len(r['categories']) == 3 and len(r['uncategorized']) == 1, [c['remark'] for c in r['categories']])
cats = r['categories']
order = [{'id': c['id'], 'products': [p['id'] for p in c['products']]} for c in cats]
# move 'uncategorized' product into the first category (at the top) and swap category order
unc = [p['id'] for p in r['uncategorized']]
order[0]['products'] = unc + order[0]['products']
order = [order[1], order[0], order[2]]
s, r = call('tree_save', {'categories': order, 'uncategorized': []}); check('tree_save', s == 200 and r['ok'], (s, r))
s, r = call('tree'); check('tree order persisted', [c['id'] for c in r['categories']] == [o['id'] for o in order] and r['uncategorized'] == [], r)
check('moved product got category', any(p['id'] == unc[0] for p in [x for c in r['categories'] if c['id'] == order[1]['id'] for x in c['products']]), r)
s, r = call('delete', {'res': 'products', 'id': newp}); check('delete product', s == 200, (s, r))

# sale status (category + product) from the web panel
s, r = call('update', {'res': 'categories', 'id': '1', 'field': 'status', 'value': 'disable'}); check('category can be switched to sold out', s == 200 and r['ok'], (s, r))
s, r = call('list', res='categories'); check('category sold-out state persisted', any(str(x['id']) == '1' and x['status'] == 'disable' for x in r['rows']) and all(x['status'] in ('active', 'disable') for x in r['rows']), r)
s, r = call('update', {'res': 'categories', 'id': '1', 'field': 'status', 'value': 'zzz'}); check('bad category status rejected', s == 422, (s, r))
s, r = call('update', {'res': 'categories', 'id': '1', 'field': 'status', 'value': 'active'}); check('category switched back to available', s == 200, (s, r))
s, r = call('update', {'res': 'products', 'id': '1', 'field': 'status_product', 'value': 'disable'}); check('product can be marked sold out', s == 200 and r['ok'], (s, r))
s, r = call('update', {'res': 'products', 'id': '1', 'field': 'status_product', 'value': 'active'}); check('product available again', s == 200, (s, r))

# import
rows = [{'id': '1', 'price_product': '65000'}, {'name_product': 'ایمپورت ۱', 'price_product': '5'}, {'name_product': 'بد', 'price_product': 'x'}]
s, r = call('import', {'res': 'products', 'rows': rows, 'dry': True}); check('import dry-run reports error line 3', s == 200 and r['errors'] and r['errors'][0]['line'] == 3 and not r['applied'], (s, r))
s, r = call('list', res='products', q='ایمپورت'); check('dry-run changed nothing', r.get('total') == 0, r)
s, r = call('import', {'res': 'products', 'rows': rows}); check('import with errors rolls back (422)', s == 422, (s, r))
s, r = call('list', res='products', q='ایمپورت'); check('rollback left no rows', r.get('total') == 0, r)
s, r = call('import', {'res': 'products', 'rows': rows[:2]}); check('import applies', s == 200 and r['applied'] and r['inserted'] == 1 and r['updated'] == 1, (s, r))
s, r = call('import', {'res': 'orders', 'rows': [{'id_invoice': 'inv1', 'note': 'ok'}]}); check('import updates existing order note', r.get('updated') == 1, (s, r))
s, r = call('import', {'res': 'payments', 'rows': []}); check('payments import forbidden', s == 403, (s, r))

# accounting
s, r = call('create', {'res': 'expenses', 'row': {'amount': '7,000', 'description': 'سرور'}}); check('create expense', s == 200, (s, r)); eid = r.get('id')
s, r = call('create', {'res': 'capital', 'row': {'amount': 500000, 'description': 'سرمایه'}}); check('create capital', s == 200, (s, r))
s, r = call('stats', period='today')
d = r.get('data', {})
check('stats today: 2 orders', d.get('orders') == 2 and d.get('orders_sum') == 60986, d)
check('stats today: expenses = Pro cost row + own table', d.get('exp_sum') == 1282000 and d.get('exp') == 2, d)
check('stats today: capital = Pro capital_injection + own table', d.get('cap_sum') == 5500000 and d.get('cap') == 2, d)
check('revenue is cash-basis: gateway 200000 + admin sale 30000', d.get('wallet_in_sum') == 200000 and d.get('admin_in_sum') == 30000 and d.get('revenue') == 230000, d)
check('internal wallet payment, expired payment and balance gifts are NOT revenue', d.get('wallet_in') == 1 and d.get('count_all') == 2, d)
check('net = revenue - expenses - withdrawals', d.get('net') == 230000 - 1282000, d)
check('stats today: first purchases = 2', d.get('first') == 2, d)
check('stats all: tests excluded from orders', r['all']['orders'] == 3, r['all'])
s, r = call('stats', period='nope'); check('bad period 422', s == 422, (s, r))
for p in ['all', 'hour', 'yesterday', 'month', 'lastmonth']:
    s, r = call('stats', period=p); check(f'stats {p} ok', s == 200 and r['ok'], (s, r))
s, r = call('overview'); check('overview', s == 200 and r['users'] == 3 and len(r['series']) == 30 and r['active_services'] >= 2, r)
s, r = call('export', res='users'); check('export users', len(r['rows']) == 3, r)
s, r = call('delete', {'res': 'expenses', 'id': eid}); check('delete expense', s == 200, (s, r))
# advertising expense: kind, editable date/time (default now), counted in that day's expenses
s, r = call('stats', period='today'); exp_before = r['data']['exp_sum']; ads_before = r['data']['exp_ads_sum']
s, r = call('create', {'res': 'expenses', 'row': {'description': 'کمپین تست', 'amount': '250,000', 'kind': 'advertising', 'created_at': ''}}); check('create advertising expense (date empty = now)', s == 200 and r['ok'], (s, r)); adid = r.get('id')
s, r = call('stats', period='today'); d = r['data']
check('advertising expense counts in today\'s expenses', d['exp_sum'] == exp_before + 250000 and d['exp_ads_sum'] == ads_before + 250000, d)
s, r = call('list', res='expenses', q='کمپین تست'); row = r['rows'][0] if r.get('rows') else {}
check('expense date is shown as Jalali text', isinstance(row.get('created_at'), str) and len(row['created_at']) == 16 and row['created_at'][4] == '/', row)
check('expense kind saved', row.get('kind') == 'advertising', row)
s, r = call('create', {'res': 'expenses', 'row': {'description': 'قدیمی', 'amount': 1000, 'kind': 'advertising', 'created_at': '2020-01-05 10:00'}}); check('create expense on a past date', s == 200, (s, r)); oldid = r.get('id')
s, r = call('list', res='expenses', q='قدیمی'); check('past date stored and shown as Jalali (2020-01-05 = 1398/10/15)', r['rows'][0]['created_at'] == '1398/10/15 10:00', r)
s, r = call('stats', period='today'); check('a past-dated expense does NOT count in today', r['data']['exp_ads_sum'] == ads_before + 250000, r['data'])
s, r = call('create', {'res': 'expenses', 'row': {'description': 'بد', 'amount': 5, 'created_at': 'فردا'}}); check('bad date rejected 422', s == 422, (s, r))
s, r = call('create', {'res': 'expenses', 'row': {'description': 'بدون نوع', 'amount': 5}}); check('kind defaults to general', s == 200, (s, r)); gid = r.get('id')
s, r = call('update', {'res': 'expenses', 'id': str(adid), 'field': 'created_at', 'value': '1398/10/15 08:30'}); check('date can be edited', s == 200 and r['ok'], (s, r))
s, r = call('update', {'res': 'expenses', 'id': str(adid), 'field': 'kind', 'value': 'zzz'}); check('bad kind rejected', s == 422, (s, r))
for i in (adid, oldid, gid):
    call('delete', {'res': 'expenses', 'id': str(i)})

# ---- admin management
s, r = call('admins'); check('admins list', s == 200 and any(a['self'] for a in r['rows']) and set(r['roles']) == {'administrator', 'Seller', 'support'}, (s, r))
me = [a for a in r['rows'] if a['self']][0]
s, r = call('admin_save', {'id_admin': '109617420', 'username': '', 'rule': 'support'}); check('create support admin (bot-only)', s == 200, (s, r))
s, r = call('admin_save', {'id_admin': '109617420', 'username': '', 'rule': 'support'}); check('duplicate id rejected 409', s == 409, (s, r))
s, r = call('admin_save', {'id_admin': 'abc', 'rule': 'support'}); check('bad telegram id 422', s == 422, (s, r))
s, r = call('admin_save', {'id_admin': '222333444', 'rule': 'root'}); check('bad role 422', s == 422, (s, r))
s, r = call('admin_save', {'id_admin': '222333444', 'username': 'ab', 'rule': 'Seller'}); check('short username 422', s == 422, (s, r))
s, r = call('admin_save', {'id_admin': '222333444', 'username': me['username'], 'rule': 'Seller'}); check('duplicate username 409', s == 409, (s, r))
s, r = call('admin_save', {'id_admin': '222333444', 'username': 'webadm1', 'rule': 'administrator', 'password': 'short'}); check('short password 422', s == 422, (s, r))
s, r = call('admin_save', {'id_admin': '222333444', 'username': 'webadm1', 'rule': 'administrator', 'password': 'longenough1'}); check('create administrator with web login', s == 200, (s, r))
s, r = call('admin_save', {'id': '109617420', 'username': '', 'rule': 'administrator'}); check('promote to administrator', s == 200, (s, r))
s, r = call('admin_save', {'id': '109617420', 'username': '', 'rule': 'Seller'}); check('demote to Seller', s == 200, (s, r))
s, r = call('admin_save', {'id': me['id_admin'], 'username': me['username'], 'rule': 'support'}); check('cannot demote yourself 409', s == 409, (s, r))
s, r = call('admin_delete', {'id': me['id_admin']}); check('cannot delete yourself 409', s == 409, (s, r))
s, r = call('admin_delete', {'id': 'nope'}); check('delete unknown 404', s == 404, (s, r))
# the new admin can log in on a second session; a Seller cannot
def login_as(u, p):
    global op, csrf
    saved = (op, csrf)
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())); csrf = ''
    st, rr = call('login', {'username': u, 'password': p})
    op, csrf = saved
    return st
check('new administrator can log in', login_as('webadm1', 'longenough1') == 200)
s, r = call('admin_save', {'id': '222333444', 'username': 'webadm1', 'rule': 'Seller'}); check('demote web admin', s == 200, (s, r))
check('demoted admin cannot log in', login_as('webadm1', 'longenough1') == 401)
for i in ('109617420', '222333444'):
    s, r = call('admin_delete', {'id': i}); check('delete admin ' + i, s == 200, (s, r))

# ---- live support chat
import subprocess
def sql(q): subprocess.run(['mysql', '-uroot', '--default-character-set=utf8mb4', 'mirza', '-e', q], check=True)
sql("DELETE FROM support_message WHERE iduser IN ('1001','1002')")
sql("INSERT INTO support_message (Tracking,idsupport,iduser,name_departman,text,result,time,status) VALUES ('t1','9','1001','عمومی','سلام، کانفیگ وصل نمیشه','0','2026/10/08 10:00:00','Unseen'),('t2','9','1001','عمومی','فوری لطفا','0','2026/10/08 10:05:00','Customerresponse'),('t3','9','1002','مالی','پرداخت من تایید نشد','0','2026/10/08 09:00:00','Answered')")
sql("UPDATE support_message SET result='پیگیری شد', result_time='2026/10/08 09:10:00', result_by='9' WHERE Tracking='t3'")
s, r = call('support_unread'); check('unread counts customers with unseen messages', r.get('unread') == 1, r)
s, r = call('support_threads'); th = {t['iduser']: t for t in r.get('threads', [])}
check('threads list: unread thread first, counts', r['threads'][0]['iduser'] == '1001' and th['1001']['unread'] == 2 and th['1001']['name'] == 'Ali', r)
check('thread snippet shows last support reply', th['1002']['snippet'].startswith('شما:'), th)
s, r = call('support_threads', q='sara'); check('thread search by user name', [t['iduser'] for t in r['threads']] == ['1002'], r)
s, r = call('support_thread', uid='1001'); check('thread messages in order', [m['from'] for m in r['messages']] == ['customer', 'customer'] and r['messages'][0]['text'].startswith('سلام'), r)
s, r = call('support_thread', uid='1002'); check('support reply is shown with time and author', r['messages'][1]['from'] == 'support' and r['messages'][1]['time'] == '2026/10/08 09:10:00' and r['messages'][1]['by'] == '9', r)
s, r = call('support_unread'); check('opening a thread marks it seen', r.get('unread') == 0, r)
s, r = call('support_reply', {'uid': '1001', 'text': ''}); check('empty reply 422', s == 422, (s, r))
s, r = call('support_reply', {'uid': 'nobody', 'text': 'x'}); check('reply to unknown thread 404', s == 404, (s, r))
s, r = call('support_reply', {'uid': '1001', 'text': 'سلام'}); check('reply fails cleanly when Telegram is unreachable (502)', s == 502, (s, r))
s, r = call('support_thread', uid='1001'); check('failed delivery leaves no reply behind', [m['from'] for m in r['messages']] == ['customer', 'customer'], r)
s, r = call('support_close', {'uid': '1001'}); check('close thread', s == 200, (s, r))
s, r = call('support_threads'); check('closed thread leaves the open list', '1001' not in [t['iduser'] for t in r['threads']], r)
s, r = call('support_threads', f='closed'); check('closed list has it', '1001' in [t['iduser'] for t in r['threads']], r)
# a support-role account only reaches the chat
s, r = call('admin_save', {'id_admin': '555666777', 'username': 'sup1', 'rule': 'support', 'password': 'supportpass1'}); check('create support web login', s == 200, (s, r))
op_saved, csrf_saved = op, csrf
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())); csrf = ''
s, r = call('login', {'username': 'sup1', 'password': 'supportpass1'}); check('support user can log in', s == 200, (s, r)); csrf = r.get('csrf', '')
s, r = call('me'); check('me reports the support role', r.get('role') == 'support', r)
s, r = call('support_threads'); check('support can read the inbox', s == 200, (s, r))
for route, q in (('list', {'res': 'users'}), ('stats', {}), ('admins', {}), ('overview', {}), ('schema', {})):
    s, r = call(route, **q); check('support is denied ' + route, s == 403, (s, r))
s, r = call('admin_save', {'id_admin': '999888777', 'rule': 'administrator'}); check('support cannot create admins', s == 403, (s, r))
op, csrf = op_saved, csrf_saved
call('admin_delete', {'id': '555666777'})
sql("DELETE FROM support_message WHERE iduser IN ('1001','1002')")

# ---- professional accounting: sales - purchases = gross; - opex = net; - dividends = retained; capital separate
s, r = call('stats', period='today'); b = r['data']
check('stats lists the expense categories', [k['key'] for k in r['kinds']][:2] == ['purchase', 'salary'] and 'dividend' in [k['key'] for k in r['kinds']], r['kinds'])
ids = []
for kind, amt in (('purchase', 3000), ('salary', 500), ('advertising', 200), ('dividend', 700)):
    s, r = call('create', {'res': 'expenses', 'row': {'description': 'acc-' + kind, 'amount': amt, 'kind': kind, 'created_at': ''}}); check('create ' + kind, s == 200, (s, r)); ids.append(r.get('id'))
s, r = call('create', {'res': 'capital', 'row': {'description': 'acc-cap', 'amount': 90000, 'created_at': ''}}); check('create capital entry', s == 200, (s, r)); capid = r.get('id')
s, r = call('stats', period='today'); a = r['data']
check('purchase goes to cost of goods', a['cogs_sum'] == b['cogs_sum'] + 3000 and a['by_kind']['purchase']['s'] == b['by_kind']['purchase']['s'] + 3000, a)
check('salary + ads are operating expenses', a['opex_sum'] == b['opex_sum'] + 700 and a['by_kind']['salary']['s'] == b['by_kind']['salary']['s'] + 500, a)
check('dividend is NOT an expense', a['exp_sum'] == b['exp_sum'] + 3700 and a['div_sum'] == b['div_sum'] + 700, a)
check('gross = sales - refunds - purchases', a['gross'] == a['revenue'] - a['wallet_out_sum'] - a['cogs_sum'], a)
check('net = gross - operating expenses', a['net'] == a['gross'] - a['opex_sum'], a)
check('retained = net - dividends', a['retained'] == a['net'] - a['div_sum'], a)
check('capital is separate: sales unchanged, capital up', a['revenue'] == b['revenue'] and a['cap_sum'] == b['cap_sum'] + 90000 and a['net'] == b['net'] - 3700, (a['revenue'], b['revenue'], a['net'], b['net']))
s, r = call('stats', period='all'); check('text report has the P&L lines', 'سود ناخالص' in r['text'] and 'سود باقی‌مانده' in r['text'] and 'سرمایه' in r['text'], r['text'][:400])
for i in ids: call('delete', {'res': 'expenses', 'id': str(i)})
call('delete', {'res': 'capital', 'id': str(capid)})

# ---- support attachments (Telegram itself is unreachable here, so delivery fails cleanly; validation and storage are tested)
def post_multipart(route, fields, files):
    import uuid
    bd = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f'--{bd}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    for k, (fn, ct, data) in files.items():
        parts.append(f'--{bd}\r\nContent-Disposition: form-data; name="{k}"; filename="{fn}"\r\nContent-Type: {ct}\r\n\r\n'.encode() + data + b'\r\n')
    parts.append(f'--{bd}--\r\n'.encode())
    req = urllib.request.Request(f"{base}/dashboard/api.php?r={route}", data=b''.join(parts), method='POST')
    req.add_header('Content-Type', f'multipart/form-data; boundary={bd}')
    if csrf: req.add_header('X-CSRF-Token', csrf)
    try:
        r = op.open(req); return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b'{}')
sql("DELETE FROM support_message WHERE iduser IN ('1001','1002')")
sql("INSERT INTO support_message (Tracking,idsupport,iduser,name_departman,text,result,time,status,file_id,file_type,file_name,result_file_id,result_file_type,result_file_name,result_time,result_by) VALUES ('f1','9','1001','عمومی','عکس مشکل','0','2026/10/08 10:00:00','Unseen','AgACfake','photo','','','','','',''),('f2','9','1001','عمومی','','0','2026/10/08 10:05:00','Unseen','BQACfake','document','report.pdf','','','','',''),('f3','9','1001','عمومی','فایل شما','فایل شما','2026/10/08 10:06:00','Answered','','','','BAACfake','video','demo.mp4','2026/10/08 10:07:00','9')")
s, r = call('support_thread', uid='1001'); msgs = r.get('messages', [])
check('thread shows customer photo with caption', msgs[0]['from'] == 'customer' and msgs[0]['text'] == 'عکس مشکل' and msgs[0]['file']['kind'] == 'image' and msgs[0]['file']['side'] == 'c', msgs[:1])
check('file-only message (no text) is listed with its file', msgs[1]['text'] == '' and msgs[1]['file']['kind'] == 'file' and msgs[1]['file']['name'] == 'report.pdf', msgs[1:2])
check('support reply with a video attachment is listed', any(m['from'] == 'support' and m.get('file', {}).get('kind') == 'video' and m['file']['side'] == 's' for m in msgs), msgs)
s, r = call('support_threads'); t = [x for x in r['threads'] if x['iduser'] == '1001']
check('thread snippet marks attachments', t and '📎' in t[0]['snippet'], t)
s, r = call('support_file', row='99999', side='c'); check('file of an unknown message is 404', s == 404, (s, r))
s, r = call('support_file', row='1', side='s'); check('side without a file is 404', s == 404, (s, r))
s, r = post_multipart('support_reply', {'uid': '1001', 'text': ''}, {}); check('empty reply without file is 422', s == 422, (s, r))
s, r = post_multipart('support_reply', {'uid': '1001', 'text': 'x'}, {'file': ('big.bin', 'application/octet-stream', b'0' * (21 * 1024 * 1024))}); check('file over 20MB is refused (413)', s == 413, (s, r))
s, r = post_multipart('support_reply', {'uid': '1001', 'text': ''}, {'file': ('a.png', 'image/png', b'\x89PNG\r\n\x1a\n' + b'0' * 50)}); check('file-only reply passes validation, then fails cleanly at Telegram (502)', s == 502, (s, r))
csrf_keep = csrf; csrf = 'bad'
s, r = post_multipart('support_reply', {'uid': '1001', 'text': 'x'}, {'file': ('a.png', 'image/png', b'123')}); check('multipart upload without CSRF is 403', s == 403, (s, r))
csrf = csrf_keep
s, r = call('support_thread', uid='1001'); check('failed delivery stores nothing', len([m for m in r['messages'] if m['from'] == 'support']) == 1, r)
op_saved, csrf_saved = op, csrf
call('admin_save', {'id_admin': '555666778', 'username': 'sup2', 'rule': 'support', 'password': 'supportpass2'})
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())); csrf = ''
s, r = call('login', {'username': 'sup2', 'password': 'supportpass2'}); csrf = r.get('csrf', '')
s, r = call('support_file', row='99999', side='c'); check('support role may open the file route (404, not 403)', s == 404, (s, r))
op, csrf = op_saved, csrf_saved
call('admin_delete', {'id': '555666778'})
sql("DELETE FROM support_message WHERE iduser IN ('1001','1002')")

s, r = call('logout', {}); check('logout', s == 200, (s, r))
s, r = call('list', res='users'); check('after logout 401', s == 401, (s, r))
print('\nFAILED:', fails); sys.exit(1 if fails else 0)
