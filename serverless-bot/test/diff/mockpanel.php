<?php
// PUTLOG
// MANAGE: users m<N> for the bot's service actions (m8 disabled, m9 on hold); create / revoke / delete / reset
$mp = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH); $mm = [];
if (preg_match('#^/api/user/(m\d+)(/[a-z_]+)?$#', $mp, $mm) || ($_SERVER['REQUEST_METHOD'] === 'POST' && $mp === '/api/user') || preg_match('#^/sub/tok_(m\d+)(_new)?/links$#', $mp, $mm)) {
  header('Content-Type: application/json');
  $method = $_SERVER['REQUEST_METHOD'];
  if (str_starts_with($mp, '/sub/')) { header('Content-Type: text/plain'); echo "vless://x@a.b:443?type=ws#%F0%9F%87%A9%F0%9F%87%AA%20Germany\nvmess://" . base64_encode(json_encode(['ps' => 'NL-2', 'add' => 'c.d'])); exit; }
  if ($method === 'POST' && $mp === '/api/user') { $in = json_decode(file_get_contents('php://input'), true) ?: []; echo json_encode(['username' => $in['username'] ?? null, 'status' => 'active', 'subscription_url' => '/sub/tok_' . ($in['username'] ?? 'x')]); exit; }
  $name = $mm[1]; $act = $mm[2] ?? '';
  if ($act === '/revoke_sub') { echo json_encode(['username' => $name, 'subscription_url' => "/sub/tok_{$name}_new"]); exit; }
  if ($act === '/reset') { echo json_encode(['username' => $name]); exit; }
  if ($act === '/sub_update') { echo json_encode(['updates' => [['created_at' => '2026-01-02T03:04:05', 'user_agent' => 'Happ/3.2.1']]]); exit; }
  if ($method === 'DELETE') { echo json_encode(['detail' => 'User successfully deleted']); exit; }
  $i = (int) substr($name, 1);
  echo json_encode(['username' => $name, 'status' => $i % 100 === 8 ? 'disabled' : ($i % 100 === 9 ? 'on_hold' : 'active'), 'data_limit' => 50 * 1024 ** 3, 'used_traffic' => 10 * 1024 ** 3,
    'expire' => gmdate('Y-m-d\TH:i:s', time() + 20 * 86400 + 3600), 'online_at' => '2026-01-02T01:00:00', 'subscription_url' => "/sub/tok_$name", 'proxy_settings' => ['vless' => ['id' => 'x']]]);
  exit;
}
if ($_SERVER['REQUEST_METHOD']==='PUT' && preg_match('#^/api/user/([^/]+)$#', parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), $mm)) { file_put_contents(__DIR__.'/put.log', $mm[1].' '.file_get_contents('php://input')."\n", FILE_APPEND); header('Content-Type: application/json'); echo json_encode(['username'=>$mm[1]]); exit; }
if (preg_match('#^/api/user/(u\\d+)$#', parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), $mm)) { header('Content-Type: application/json'); echo json_encode(['username'=>$mm[1],'status'=>'active','proxy_settings'=>['vless'=>['id'=>'x']],'subscription_url'=>'/sub/x','data_limit'=>1]); exit; }
header('Content-Type: application/json');
$u = parse_url($_SERVER['REQUEST_URI']);
if ($u['path'] === '/api/admin/token') { echo json_encode(['access_token' => 'T']); exit; }
if ($u['path'] === '/api/groups') { echo json_encode(['groups' => [['id' => 1, 'name' => 'main', 'inbound_tags' => ['vless-ws']], ['id' => 2, 'name' => 'old', 'inbound_tags' => ['vmess-old']]]]); exit; }
if (preg_match('#^/api/user/u(\d+)/sub_update#', $u['path'], $m)) { $i=(int)$m[1]; echo json_encode(['updates' => $i % 10 === 0 ? [] : [['created_at' => gmdate('Y-m-d\TH:i:s', time()-3600), 'user_agent' => 'Happ/3.2.1']]]); exit; }
if ($u['path'] === '/api/user/monitor') { echo json_encode(['username' => 'monitor', 'status' => 'active', 'subscription_url' => '/sub/monitortoken', 'expire' => null, 'data_limit' => null, 'used_traffic' => 0, 'online_at' => null, 'proxy_settings' => []]); exit; }
if ($u['path'] === '/sub/monitortoken/links') { header('Content-Type: text/plain'); echo implode("\n", json_decode(file_get_contents(__DIR__ . '/links.json'), true)); exit; }
if ($u['path'] === '/api/user/monitor/sub_update') { echo json_encode(['updates' => []]); exit; }
parse_str($u['query'] ?? '', $q);
mt_srand(1); $all = [];
for ($i = 0; $i < 450; $i++) {
  $old = $i % 10 === 0;              // 10% on the "old" group, never online
  $stale = $i % 7 === 0;
  $all[] = ['username' => "u$i", 'status' => ($i % 9 === 0 ? 'limited' : 'active'), 'created_at' => gmdate('Y-m-d\TH:i:s', time() - 86400 * (2 + $i % 60)),
    'online_at' => $old ? null : gmdate('Y-m-d\TH:i:s', time() - 3600 * ($stale ? 100 : 2)),
    'subscription_url' => "/sub/tok_u$i", 'x_sub' => gmdate('Y-m-d\TH:i:s', time() - 86400 * ($old ? 40 : 1)), 'x_ua' => $old ? 'v2rayNG/1.8.5' : 'Happ/3.2.1/Android',
    'group_ids' => [$old ? 2 : 1], 'proxy_settings' => ['vless' => ['id' => 'x', 'flow' => ''], 'vmess' => ['id' => 'y']], 'lifetime_used_traffic' => $old ? 0 : 1e9, 'data_limit' => 1e10, 'data_limit_reset_strategy' => 'no_reset'];
}
$all = array_values(array_filter($all, fn($u) => $u['status'] === ($q['status'] ?? 'active')));
foreach ($all as $k => &$u) { if ($k % 5 === 0) $u['data_limit'] = 0; } unset($u);
echo json_encode(['users' => array_slice($all, (int) $q['offset'], (int) $q['limit']), 'total' => count($all)]);
