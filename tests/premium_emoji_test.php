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
function cfg($enabled, $map)
{
    global $tmp;
    file_put_contents($tmp, json_encode(['enabled' => $enabled, 'map' => $map]));
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
t('reply-keyboard label wrapped, others and options kept', strpos($m['keyboard'][0][0]['text'], 'emoji-id="3333333"') !== false && $m['keyboard'][0][1]['text'] === 'بدون ایموجی' && $m['resize_keyboard'] === true);
$kb = json_encode(['inline_keyboard' => [[['text' => 'a < b 🔥 & c', 'callback_data' => 'x']]]], JSON_UNESCAPED_UNICODE);
$m = json_decode(premiumEmojiApplyPayload(['reply_markup' => $kb], 'sendMessage')['reply_markup'], true);
t('label with < and & survives the HTML round trip', $m['inline_keyboard'][0][0]['text'] === 'a < b <tg-emoji emoji-id="1111111">🔥</tg-emoji> & c', $m['inline_keyboard'][0][0]['text']);
$kb = json_encode(['inline_keyboard' => [[['text' => '🔥 x', 'icon_custom_emoji_id' => '77', 'callback_data' => 'x']]]], JSON_UNESCAPED_UNICODE);
t('button that already has an icon is left alone', json_decode(premiumEmojiApplyPayload(['reply_markup' => $kb], 'sendMessage')['reply_markup'], true)['inline_keyboard'][0][0]['text'] === '🔥 x');
t('invalid reply_markup string survives', premiumEmojiApplyPayload(['reply_markup' => 'not json'], 'sendMessage')['reply_markup'] === 'not json');

// --- tap restore: matches what upstream sends (first emoji becomes the icon)
foreach (['🔥 خرید', '🔥 خرید ❤', '🛍 فروشگاه', 'بدون ایموجی'] as $label) {
    $mine = premiumEmojiButtonText($label);
    $theirs = splitCustomEmojiLabel(htmlspecialchars_decode(premiumEmojiWrapHtml(htmlspecialchars($label, ENT_NOQUOTES))))['text'];
    t("button text equals upstream split for \"$label\" -> \"$mine\"", $mine === $theirs, "$mine vs $theirs");
}
cfg(true, ['🔥' => '1111111', '🛍' => '3333333']);
$textbotlang = ['keyboard' => ['buy' => '🔥 خرید سرویس', 'shop' => '🛍 فروشگاه', 'plain' => 'بدون ایموجی'], 'msg' => ['long' => str_repeat('x', 300)]];
t('tap on "خرید سرویس" maps back to the original label', premiumEmojiRestoreLabel('خرید سرویس') === '🔥 خرید سرویس');
t('tap on "فروشگاه" maps back', premiumEmojiRestoreLabel('فروشگاه') === '🛍 فروشگاه');
t('unrelated text unchanged', premiumEmojiRestoreLabel('سلام') === 'سلام');
t('label without emoji unchanged', premiumEmojiRestoreLabel('بدون ایموجی') === 'بدون ایموجی');
t('very long text skipped', premiumEmojiRestoreLabel(str_repeat('y', 200)) === str_repeat('y', 200));

// --- real language file: speed + no crash
$textbotlang = require $root . '/lang/fa.php';
$wrapN = 0;
$t0 = microtime(true);
cfg(true, ['🛍' => '1', '💰' => '2', '💳' => '3', '🔑' => '4', '👤' => '5', '📊' => '6', '🔙' => '7', '✅' => '8', '❌' => '9', '⚠️' => '10', '📌' => '11'] + array_combine(['🔹', '🔸', '⭕️', '💵'], ['12', '13', '14', '15']));
$cfgMap = premiumEmojiConfig()['map'];
foreach ($cfgMap as $k => $v) { $cfgMap[$k] = (string) (10000 + (int) $v); }
cfg(true, $cfgMap);
$first = premiumEmojiRestoreLabel('خرید سرویس');
$ms = (microtime(true) - $t0) * 1000;
t(sprintf('restore index over the full Farsi language file builds in %.0f ms (limit 400)', $ms), $ms < 400, $ms);
$t0 = microtime(true); premiumEmojiRestoreLabel('x'); $ms2 = (microtime(true) - $t0) * 1000;
t('later lookups are instant', $ms2 < 5, $ms2);
unlink($tmp);
echo "\nFAILED: $fails\n";
exit($fails ? 1 : 0);
