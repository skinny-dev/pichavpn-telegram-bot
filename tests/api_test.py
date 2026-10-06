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

s, r = call('logout', {}); check('logout', s == 200, (s, r))
s, r = call('list', res='users'); check('after logout 401', s == 401, (s, r))
print('\nFAILED:', fails); sys.exit(1 if fails else 0)
