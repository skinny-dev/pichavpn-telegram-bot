<?php
// php tests/premium_emoji_test.php
$root = dirname(__DIR__);
$tmp = tempnam(sys_get_temp_dir(), 'pe');
putenv("PICHA_PREMIUM_EMOJI_FILE=$tmp");
require $root . '/premium_emoji.php';

// load the REAL upstream label functions from function.php so we test against them, not a copy
$src = file_get_contents($root . '/function.php');
foreach (['stripCustomEmojiTags', 'splitCustomEmojiLabel', 'containsHtmlMarkup'] as $fn) {
    preg_match('/\nfunction ' . $fn . '\(.*?\n}\n/s', $src, $m);
    eval($m[0]);
}

$fails = 0;
function t($name, $cond, $extra = '')
{
    global $fails;
    echo ($cond ? 'PASS ' : 'FAIL ') . $name . ($cond ? '' : "  -> $extra") . "\n";
    $fails += !$cond;
}
function cfg($enabled, $map, $buttons = true)
{
    global $tmp;
    file_put_contents($tmp, json_encode(['enabled' => $enabled, 'map' => $map, 'buttons' => $buttons]));
    premiumEmojiConfig(true);
}

// --- names typed by an admin with a premium emoji (what the bot received in your screenshot)
t('premium emoji in a name is accepted', containsHtmlMarkup('40 گیگ — 200,000 تومان <tg-emoji emoji-id="5368324170671202286">🔥</tg-emoji>') === false);
t('two premium emoji accepted', containsHtmlMarkup('<tg-emoji emoji-id="12345">🔥</tg-emoji> x <tg-emoji emoji-id="67890">❤</tg-emoji>') === false);
t('other HTML still rejected', containsHtmlMarkup('<b>x</b>') === true);
t('script injection still rejected', containsHtmlMarkup('<script>alert(1)</script>') === true);
t('tg-emoji with extra attributes rejected', containsHtmlMarkup('<tg-emoji emoji-id="12345" onclick="x">🔥</tg-emoji>') === true);
t('tg-emoji with non-numeric id rejected', containsHtmlMarkup('<tg-emoji emoji-id="abc">🔥</tg-emoji>') === true);
t('tg-emoji wrapping markup rejected', containsHtmlMarkup('<tg-emoji emoji-id="12345"><b>x</b></tg-emoji>') === true);
t('plain text still fine', containsHtmlMarkup('۴۰ گیگ | ۳۰ روز') === false);

// --- incoming premium emoji (messages and captions) -> tags
$ent = fn($o, $l, $id) => ['type' => 'custom_emoji', 'offset' => $o, 'length' => $l, 'custom_emoji_id' => $id];
t('entity at the start (🔥 is 2 UTF-16 units)', premiumEmojiEntitiesToTags('🔥 سلام', [$ent(0, 2, '5368324170671202286')]) === '<tg-emoji emoji-id="5368324170671202286">🔥</tg-emoji> سلام');
t('two entities, in any order', premiumEmojiEntitiesToTags('🔥 x ⭐', [$ent(5, 1, '22222'), $ent(0, 2, '11111')]) === '<tg-emoji emoji-id="11111">🔥</tg-emoji> x <tg-emoji emoji-id="22222">⭐</tg-emoji>', premiumEmojiEntitiesToTags('🔥 x ⭐', [$ent(5, 1, '22222'), $ent(0, 2, '11111')]));
t('Farsi text before the emoji keeps offsets right', premiumEmojiEntitiesToTags('خرید 🔥', [$ent(5, 2, '33333')]) === 'خرید <tg-emoji emoji-id="33333">🔥</tg-emoji>');
t('non custom-emoji entities ignored', premiumEmojiEntitiesToTags('hi', [['type' => 'bold', 'offset' => 0, 'length' => 2]]) === 'hi');
t('out-of-range entity ignored safely', premiumEmojiEntitiesToTags('hi', [$ent(0, 50, '44444')]) === 'hi');
t('non-numeric id rejected (no tag injection)', premiumEmojiEntitiesToTags('🔥', [$ent(0, 2, '1"><script>')]) === '🔥');
t('null entities fine', premiumEmojiEntitiesToTags('x', null) === 'x');
t('result is accepted by the name check', containsHtmlMarkup(premiumEmojiEntitiesToTags('40 گیگ 🔥', [$ent(7, 2, '5368324170671202286')])) === false);

// --- the screenshot bug #2: a premium emoji typed into a name must not vanish from reply keyboards
$tagName = '<tg-emoji emoji-id="5368324170671202286">✨</tg-emoji> 1 ماهه (حجمی)';
$rk = json_encode(['keyboard' => [[['text' => $tagName], ['text' => '🔥 نامحدود']]], 'resize_keyboard' => true], JSON_UNESCAPED_UNICODE);
cfg(true, ['✨' => '5368324170671202286'], true);
$m = json_decode(premiumEmojiPrepareButtons(['reply_markup' => $rk])['reply_markup'], true);
t('reply keyboard: tag stripped, emoji character kept', $m['keyboard'][0][0]['text'] === '✨ 1 ماهه (حجمی)' && $m['keyboard'][0][1]['text'] === '🔥 نامحدود' && $m['resize_keyboard'] === true, json_encode($m, JSON_UNESCAPED_UNICODE));
$ik = json_encode(['inline_keyboard' => [[['text' => $tagName, 'callback_data' => 'c']]]], JSON_UNESCAPED_UNICODE);
t('inline keyboard with icons ON: tag kept for the icon conversion', json_decode(premiumEmojiPrepareButtons(['reply_markup' => $ik])['reply_markup'], true)['inline_keyboard'][0][0]['text'] === $tagName);
cfg(true, ['✨' => '5368324170671202286'], false);
t('inline keyboard with icons OFF: tag stripped, emoji kept', json_decode(premiumEmojiPrepareButtons(['reply_markup' => $ik])['reply_markup'], true)['inline_keyboard'][0][0]['text'] === '✨ 1 ماهه (حجمی)');
unlink($tmp);
premiumEmojiConfig(true);
t('layer disabled entirely: tags still never reach a button as text', json_decode(premiumEmojiPrepareButtons(['reply_markup' => $ik])['reply_markup'], true)['inline_keyboard'][0][0]['text'] === '✨ 1 ماهه (حجمی)');
t('keyboard without tags untouched (byte for byte)', premiumEmojiPrepareButtons(['reply_markup' => '{"keyboard":[[{"text":"a"}]]}'])['reply_markup'] === '{"keyboard":[[{"text":"a"}]]}');

// --- tap on that reply-keyboard button: map the plain text back to the stored name (sqlite stands in for MySQL)
$pdo = new PDO('sqlite::memory:');
$pdo->exec("CREATE TABLE category (id INTEGER, remark TEXT); CREATE TABLE product (id INTEGER, name_product TEXT); CREATE TABLE marzban_panel (name_panel TEXT)");
$pdo->prepare("INSERT INTO category VALUES (1, ?), (2, '2 ماهه (حجمی)')")->execute([$tagName]);
$pdo->exec("INSERT INTO product VALUES (1, '40 گیگ')");
function convertPersianNumbersToEnglish($v) { return strtr($v, ['۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9']); }
t('tap "✨ 1 ماهه (حجمی)" maps back to the stored name', premiumEmojiRestoreName('✨ 1 ماهه (حجمی)') === $tagName, premiumEmojiRestoreName('✨ 1 ماهه (حجمی)'));
t('tap without the emoji also maps back', premiumEmojiRestoreName('1 ماهه (حجمی)') === $tagName);
t('a name without a tag is untouched', premiumEmojiRestoreName('2 ماهه (حجمی)') === '2 ماهه (حجمی)');
t('unrelated text untouched', premiumEmojiRestoreName('سلام') === 'سلام');
t('text with < is never remapped', premiumEmojiRestoreName('<b>x</b>') === '<b>x</b>');

// --- disabled = no-op
cfg(false, ['🔥' => '1111111']);
t('disabled: html unchanged', premiumEmojiWrapHtml('🔥 hi') === '🔥 hi');
$p = ['text' => '🔥', 'parse_mode' => 'HTML'];
t('disabled: payload unchanged', premiumEmojiApplyPayload($p, 'sendMessage') === $p);
unlink($tmp);
premiumEmojiConfig(true);
t('missing file = disabled', premiumEmojiWrapHtml('🔥') === '🔥');

// --- enabled
cfg(true, ['🔥' => '1111111', '❤' => '2222222', '🛍' => '3333333', '1' => '4444444', '👨‍💻' => '5555555']);
t('wraps with the right id', premiumEmojiWrapHtml('🔥 سلام') === '<tg-emoji emoji-id="1111111">🔥</tg-emoji> سلام');
t('matches emoji with variation selector (❤️ vs ❤)', premiumEmojiWrapHtml('❤️') === '<tg-emoji emoji-id="2222222">❤️</tg-emoji>', premiumEmojiWrapHtml('❤️'));
t('ZWJ sequence matched whole', premiumEmojiWrapHtml('👨‍💻') === '<tg-emoji emoji-id="5555555">👨‍💻</tg-emoji>');
t('ASCII keys ignored (digit 1 untouched)', premiumEmojiWrapHtml('1 2 3') === '1 2 3');
t('skips <code> and <pre>', premiumEmojiWrapHtml('<code>🔥</code> 🔥 <pre>🔥</pre>') === '<code>🔥</code> <tg-emoji emoji-id="1111111">🔥</tg-emoji> <pre>🔥</pre>');
t('skips <a> content and attributes', premiumEmojiWrapHtml('<a href="https://x/🔥">🔥</a>') === '<a href="https://x/🔥">🔥</a>');
t('no double wrap', premiumEmojiWrapHtml('<tg-emoji emoji-id="9">🔥</tg-emoji>') === '<tg-emoji emoji-id="9">🔥</tg-emoji>');
t('escaped HTML preserved', premiumEmojiWrapHtml('&lt;b&gt; 🔥') === '&lt;b&gt; <tg-emoji emoji-id="1111111">🔥</tg-emoji>');
t('unmapped emoji untouched', premiumEmojiWrapHtml('😀') === '😀');
t('entity cap respected', substr_count(premiumEmojiWrapHtml(str_repeat('🔥', 150)), '<tg-emoji') === PREMIUM_EMOJI_MAX_PER_TEXT);

// --- payloads
$p = premiumEmojiApplyPayload(['text' => '🔥 a', 'parse_mode' => 'HTML', 'chat_id' => 1], 'sendMessage');
t('HTML text wrapped', strpos($p['text'], '<tg-emoji emoji-id="1111111">') === 0);
$p = premiumEmojiApplyPayload(['text' => '🔥 a', 'parse_mode' => 'Markdown'], 'sendMessage');
t('Markdown text left alone', $p['text'] === '🔥 a');
$p = premiumEmojiApplyPayload(['text' => '🔥 a'], 'sendMessage');
t('no parse_mode left alone', $p['text'] === '🔥 a');
$p = premiumEmojiApplyPayload(['caption' => '🔥 c', 'parse_mode' => 'html'], 'sendPhoto');
t('caption wrapped (case-insensitive parse_mode)', strpos($p['caption'], 'tg-emoji') !== false);
$p = premiumEmojiApplyPayload(['text' => '🔥 alert'], 'answerCallbackQuery');
t('callback answers untouched', $p['text'] === '🔥 alert');
$kb = json_encode(['inline_keyboard' => [[['text' => '🔥 خرید', 'callback_data' => 'buy']]], 'x' => 1], JSON_UNESCAPED_UNICODE);
$p = premiumEmojiApplyPayload(['reply_markup' => $kb, 'text' => 'x'], 'sendMessage');
$m = json_decode($p['reply_markup'], true);
t('inline button label wrapped, callback_data kept', $m['inline_keyboard'][0][0]['text'] === '<tg-emoji emoji-id="1111111">🔥</tg-emoji> خرید' && $m['inline_keyboard'][0][0]['callback_data'] === 'buy', $p['reply_markup']);
$kb = json_encode(['keyboard' => [[['text' => '🛍 فروشگاه'], ['text' => 'بدون ایموجی']]], 'resize_keyboard' => true], JSON_UNESCAPED_UNICODE);
$m = json_decode(premiumEmojiApplyPayload(['reply_markup' => $kb], 'sendMessage')['reply_markup'], true);
t('reply-keyboard labels are left alone (Telegram draws no icons there), options kept', $m['keyboard'][0][0]['text'] === '🛍 فروشگاه' && $m['keyboard'][0][1]['text'] === 'بدون ایموجی' && $m['resize_keyboard'] === true);
$kb = json_encode(['inline_keyboard' => [[['text' => 'a < b 🔥 & c', 'callback_data' => 'x']]]], JSON_UNESCAPED_UNICODE);
$m = json_decode(premiumEmojiApplyPayload(['reply_markup' => $kb], 'sendMessage')['reply_markup'], true);
t('label with < and & survives the HTML round trip', $m['inline_keyboard'][0][0]['text'] === 'a < b <tg-emoji emoji-id="1111111">🔥</tg-emoji> & c', $m['inline_keyboard'][0][0]['text']);
$kb = json_encode(['inline_keyboard' => [[['text' => '🔥 x', 'icon_custom_emoji_id' => '77', 'callback_data' => 'x']]]], JSON_UNESCAPED_UNICODE);
t('button that already has an icon is left alone', json_decode(premiumEmojiApplyPayload(['reply_markup' => $kb], 'sendMessage')['reply_markup'], true)['inline_keyboard'][0][0]['text'] === '🔥 x');
t('invalid reply_markup string survives', premiumEmojiApplyPayload(['reply_markup' => 'not json'], 'sendMessage')['reply_markup'] === 'not json');

// --- aliases: a close premium emoji stands in for one the pack lacks
cfg(true, ['✔' => '80001', '🔴' => '80002', '🛍' => '80003']);
t('✅ shows the ✔ premium emoji (alias)', premiumEmojiWrapHtml('✅ ok') === '<tg-emoji emoji-id="80001">✅</tg-emoji> ok', premiumEmojiWrapHtml('✅ ok'));
t('fallback char stays the original ✅', strpos(premiumEmojiWrapHtml('✅'), '>✅<') !== false);
t('⭕ -> 🔴, 🛒 -> 🛍', premiumEmojiConfig()['map']['⭕'] === '80002' && premiumEmojiConfig()['map']['🛒'] === '80003');
t('alias inactive when the target is not in the pack', !isset(premiumEmojiConfig()['map']['💰']));
cfg(true, ['✔' => '80001', '✅' => '90009']);
t('a real mapping always beats an alias', premiumEmojiConfig()['map']['✅'] === '90009');
file_put_contents($tmp, json_encode(['enabled' => true, 'map' => ['✔' => '80001'], 'use_default_aliases' => false, 'alias' => ['❓' => '✔']]));
premiumEmojiConfig(true);
t('defaults can be turned off, custom alias still works', !isset(premiumEmojiConfig()['map']['✅']) && premiumEmojiConfig()['map']['❓'] === '80001');

// --- catalog emoji (display only), using the real catalog from the backup
cfg(true, ['⚡' => '10001', '⭐' => '10002', '💎' => '10003', '👑' => '10004', '🔥' => '10005', '🚨' => '10006', '🗓' => '10007']);
$cat = fn($name, $id = 1) => ['id' => $id, 'remark' => $name];
$prod = fn($name, $gb, $days, $category = '1 ماهه (حجمی)', $id = 1) => ['id' => $id, 'name_product' => $name, 'Volume_constraint' => (string) $gb, 'Service_time' => (string) $days, 'category' => $category];
t('catalog OFF by default: labels unchanged', premiumCatalogLabel('product', $prod('10 گیگ', 10, 30), '10 گیگ — 60,000 تومان') === '10 گیگ — 60,000 تومان');
file_put_contents($tmp, json_encode(['enabled' => true, 'catalog' => true, 'buttons' => true, 'map' => ['⚡' => '10001', '⭐' => '10002', '💎' => '10003', '👑' => '10004', '🔥' => '10005', '🚨' => '10006', '🗓' => '10007']]));
premiumEmojiConfig(true);
$expect = [
    [10, 30, '⚡'], [25, 30, '⚡'], [40, 30, '⭐'], [80, 30, '⭐'], [90, 60, '⭐'], [120, 30, '💎'], [130, 60, '💎'],
    [200, 60, '💎'], [250, 90, '💎'], [300, 90, '👑'], [400, 90, '👑'], [0, 30, '🔥'], [0, 120, '🔥'], [1, 0, '🚨'], [5, 0, '🚨'],
];
$bad = [];
foreach ($expect as [$gb, $days, $want]) {
    $got = premiumCatalogEmoji('product', $prod("x", $gb, $days, $days === 0 ? '💀 اضطراری' : 'c'));
    if ($got !== $want) { $bad[] = "$gb GB/$days d: $got != $want"; }
}
t('every product of the real catalog gets its intended emoji', !$bad, implode('; ', $bad));
t('category 1/2/3 months -> 🗓', premiumCatalogEmoji('category', $cat('1 ماهه (حجمی)')) === '🗓' && premiumCatalogEmoji('category', $cat('3 ماهه (حجمی)')) === '🗓');
t('unlimited and emergency categories', premiumCatalogEmoji('category', $cat('نامحدود (نت معمولی)')) === '🔥' && premiumCatalogEmoji('category', $cat('اضطراری (نت ملی)')) === '🚨');
t('unknown category gets nothing', premiumCatalogEmoji('category', $cat('متفرقه')) === '');
t('label gets the emoji in front', premiumCatalogLabel('product', $prod('x', 40, 30), '40 گیگ — 200,000 تومان') === '⭐ 40 گیگ — 200,000 تومان');
t('a label that already starts with an emoji is left alone', premiumCatalogLabel('category', $cat('🔥 نامحدود (نت معمولی)'), '🔥 نامحدود (نت معمولی)') === '🔥 نامحدود (نت معمولی)');
t('a label starting with a premium tag is left alone', premiumCatalogLabel('category', $cat('x'), '<tg-emoji emoji-id="55555">🔥</tg-emoji> x') === '<tg-emoji emoji-id="55555">🔥</tg-emoji> x');
t('plain Farsi label is not mistaken for an emoji', premiumEmojiStartsWithEmoji('۴۰ گیگ') === false);
file_put_contents($tmp, json_encode(['enabled' => true, 'catalog' => true, 'buttons' => true, 'map' => ['🔥' => '50005', '⭐' => '20002'], 'catalog_override' => ['product' => ['13' => '🔥']]]));
premiumEmojiConfig(true);
t('per-item override wins', premiumCatalogEmoji('product', $prod('x', 10, 30, 'c', 13)) === '🔥');
// the full path a button takes: label -> premium icon
$label = premiumCatalogLabel('product', $prod('x', 40, 30), '40 گیگ — 200,000 تومان');
$btn = json_decode(premiumEmojiApplyPayload(['reply_markup' => json_encode(['inline_keyboard' => [[['text' => $label, 'callback_data' => 'c']]]], JSON_UNESCAPED_UNICODE)], 'sendMessage')['reply_markup'], true)['inline_keyboard'][0][0]['text'];
t('product button ends up with the ⭐ premium emoji and the same text', $btn === '<tg-emoji emoji-id="20002">⭐</tg-emoji> 40 گیگ — 200,000 تومان', $btn);

// --- the screenshot bug: running the conversion twice must not nest or leak tags
cfg(true, ['🗓' => '70007', '🔥' => '50005']);
$kb1 = json_encode(['inline_keyboard' => [[['text' => '🗓 1 ماهه (حجمی)', 'callback_data' => 'c']]]]); // KeyboardCategory uses plain json_encode
$once = premiumEmojiApplyPayload(['reply_markup' => $kb1], 'sendMessage');
$twice = premiumEmojiApplyPayload($once, 'sendMessage');
t('applying twice gives the same keyboard', $once['reply_markup'] === $twice['reply_markup'], $twice['reply_markup']);
t('no nested or stray tags after two passes', substr_count(json_decode($twice['reply_markup'], true)['inline_keyboard'][0][0]['text'], '<tg-emoji') === 1 && substr_count(json_decode($twice['reply_markup'], true)['inline_keyboard'][0][0]['text'], '</tg-emoji>') === 1);
$m = ['text' => 'a'];
$h1 = premiumEmojiApplyPayload(['text' => '🔥 x', 'parse_mode' => 'HTML'], 'sendMessage'); $h2 = premiumEmojiApplyPayload($h1, 'sendMessage');
t('HTML text is idempotent too', $h1['text'] === $h2['text']);
// buttons are opt-in
cfg(true, ['🗓' => '70007', '🔥' => '50005'], false);
$off = premiumEmojiApplyPayload(['reply_markup' => $kb1, 'text' => '🔥 x', 'parse_mode' => 'HTML'], 'sendMessage');
t('buttons OFF: labels keep the plain emoji', $off['reply_markup'] === $kb1);
t('buttons OFF: message text still gets premium emoji', strpos($off['text'], '<tg-emoji emoji-id="50005">') === 0);
cfg(true, ['🗓' => '70007', '🔥' => '50005'], true);

unlink($tmp);
echo "\nFAILED: $fails\n";
exit($fails ? 1 : 0);
