<?php
// Premium (custom) emoji layer.
//
// Reads storage/premium_emoji.json  {"enabled": true, "map": {"🔥": "5368324170671202286", ...}}
// and, at send time only, wraps mapped emoji in <tg-emoji emoji-id="..."> inside HTML messages/captions and
// converts the first mapped emoji of every button label into the button's icon. The existing layer in
// botapi.php then handles Telegram refusing custom emoji (it falls back to the plain emoji).
//
// Nothing is rewritten in lang/*.php or the database, so product names, comparisons and panel remarks are untouched.
// Incoming taps on reply-keyboard buttons are mapped back to the original label by premiumEmojiRestoreLabel().
//
// Manage it with: php scripts/premium_emoji.php help

const PREMIUM_EMOJI_MAX_PER_TEXT = 90; // Telegram caps entities per message

function premiumEmojiFile()
{
    $override = getenv('PICHA_PREMIUM_EMOJI_FILE'); // tests
    return $override ? $override : __DIR__ . '/storage/premium_emoji.json';
}

function premiumEmojiNormalize($emoji)
{
    return str_replace("\u{FE0F}", '', (string) $emoji);
}

/** Loads and caches the config. Returns ['enabled' => bool, 'map' => [emoji => id], 'regex' => string|null]. */
function premiumEmojiConfig($reload = false)
{
    static $cfg = null;
    if ($cfg !== null && !$reload) {
        return $cfg;
    }
    $cfg = ['enabled' => false, 'map' => [], 'regex' => null];
    $file = premiumEmojiFile();
    if (!is_file($file)) {
        return $cfg;
    }
    $raw = json_decode((string) @file_get_contents($file), true);
    if (!is_array($raw) || empty($raw['enabled']) || !is_array($raw['map'] ?? null)) {
        return $cfg;
    }
    $map = [];
    foreach ($raw['map'] as $emoji => $id) {
        $key = premiumEmojiNormalize($emoji);
        // never map plain ASCII (digits, #, *) or empty keys
        if ($key === '' || preg_match('/^[\x00-\x7F]+$/', $key) || !preg_match('/^\d{5,25}$/', (string) $id)) {
            continue;
        }
        $map[$key] = (string) $id;
    }
    if (!$map) {
        return $cfg;
    }
    $keys = array_keys($map);
    usort($keys, function ($a, $b) {
        return strlen($b) <=> strlen($a); // longest first so sequences win over their parts
    });
    $parts = array_map(function ($k) {
        return preg_quote($k, '/');
    }, $keys);
    $cfg = ['enabled' => true, 'map' => $map, 'regex' => '/(?:' . implode('|', $parts) . ")\u{FE0F}?/u"];
    return $cfg;
}

/** Wrap mapped emoji in an HTML string. Skips tags, <code>, <pre>, <a> and existing <tg-emoji>. */
function premiumEmojiWrapHtml($html)
{
    $cfg = premiumEmojiConfig();
    if (!$cfg['enabled'] || !is_string($html) || $html === '') {
        return $html;
    }
    $tokens = preg_split('/(<[^>]*>)/u', $html, -1, PREG_SPLIT_DELIM_CAPTURE);
    if ($tokens === false) {
        return $html;
    }
    $skip = 0;
    $count = 0;
    foreach ($tokens as $i => $tok) {
        if ($tok === '') {
            continue;
        }
        if ($tok[0] === '<' && substr($tok, -1) === '>') {
            if (preg_match('/^<\s*(code|pre|a|tg-emoji)\b/i', $tok)) {
                $skip++;
            } elseif (preg_match('/^<\s*\/\s*(code|pre|a|tg-emoji)\s*>/i', $tok)) {
                $skip = max(0, $skip - 1);
            }
            continue;
        }
        if ($skip > 0) {
            continue;
        }
        $tokens[$i] = preg_replace_callback($cfg['regex'], function ($m) use ($cfg, &$count) {
            if ($count >= PREMIUM_EMOJI_MAX_PER_TEXT) {
                return $m[0];
            }
            $id = $cfg['map'][premiumEmojiNormalize($m[0])] ?? null;
            if ($id === null) {
                return $m[0];
            }
            $count++;
            return '<tg-emoji emoji-id="' . $id . '">' . $m[0] . '</tg-emoji>';
        }, $tok);
    }
    return implode('', $tokens);
}

function premiumEmojiIsHtml(array $datas)
{
    $mode = $datas['parse_mode'] ?? '';
    return is_string($mode) && strtolower($mode) === 'html';
}

/** Apply to a Telegram payload (text/caption for HTML messages, button labels for any keyboard). */
function premiumEmojiApplyPayload(array $datas, $method = '')
{
    $cfg = premiumEmojiConfig();
    if (!$cfg['enabled']) {
        return $datas;
    }
    $method = strtolower((string) $method);
    $skipMethods = ['answercallbackquery', 'answerinlinequery', 'answerprecheckoutquery', 'answershippingquery', 'setmycommands', 'setchatmenubutton'];
    if (in_array($method, $skipMethods, true)) {
        return $datas;
    }
    if (premiumEmojiIsHtml($datas)) {
        foreach (['text', 'caption'] as $k) {
            if (isset($datas[$k]) && is_string($datas[$k])) {
                $datas[$k] = premiumEmojiWrapHtml($datas[$k]);
            }
        }
    }
    if (isset($datas['reply_markup']) && is_string($datas['reply_markup']) && $datas['reply_markup'] !== '') {
        $markup = json_decode($datas['reply_markup'], true);
        if (is_array($markup)) {
            $changed = false;
            foreach (['keyboard', 'inline_keyboard'] as $key) {
                if (!isset($markup[$key]) || !is_array($markup[$key])) {
                    continue;
                }
                foreach ($markup[$key] as $r => $row) {
                    if (!is_array($row)) {
                        continue;
                    }
                    foreach ($row as $b => $button) {
                        if (is_array($button) && isset($button['text']) && is_string($button['text']) && !isset($button['icon_custom_emoji_id'])) {
                            $wrapped = premiumEmojiWrapHtml(htmlspecialchars($button['text'], ENT_NOQUOTES, 'UTF-8'));
                            if ($wrapped !== htmlspecialchars($button['text'], ENT_NOQUOTES, 'UTF-8')) {
                                // botapi.php turns the first <tg-emoji> into the button icon and strips the rest
                                $markup[$key][$r][$b]['text'] = htmlspecialchars_decode($wrapped, ENT_NOQUOTES);
                                $changed = true;
                            }
                        }
                    }
                }
            }
            if ($changed) {
                $encoded = json_encode($markup, JSON_UNESCAPED_UNICODE);
                if ($encoded !== false) {
                    $datas['reply_markup'] = $encoded;
                }
            }
        }
    }
    return $datas;
}

/** The label Telegram will deliver when a user taps a button whose first emoji became its icon. */
function premiumEmojiButtonText($label)
{
    $wrapped = premiumEmojiWrapHtml(htmlspecialchars((string) $label, ENT_NOQUOTES, 'UTF-8'));
    if ($wrapped === htmlspecialchars((string) $label, ENT_NOQUOTES, 'UTF-8')) {
        return (string) $label;
    }
    // same rule as splitCustomEmojiLabel(): the first <tg-emoji> becomes the icon, the others stay as plain emoji
    $decoded = htmlspecialchars_decode($wrapped, ENT_NOQUOTES);
    $first = false;
    $text = preg_replace_callback('#<tg-emoji\b[^>]*>(.*?)</tg-emoji>#isu', function ($m) use (&$first) {
        if (!$first) {
            $first = true;
            return '';
        }
        return $m[1];
    }, $decoded);
    $text = trim(preg_replace('/[ \t]+/u', ' ', (string) $text));
    return $text === '' ? preg_replace('#<tg-emoji\b[^>]*>(.*?)</tg-emoji>#isu', '$1', $decoded) : $text;
}

/**
 * An incoming message text equal to a button label minus its (now icon) emoji -> the original label,
 * so `$text == $textbotlang[...]` comparisons keep working. Only runs for short texts.
 */
function premiumEmojiRestoreLabel($text)
{
    static $index = null;
    $cfg = premiumEmojiConfig();
    if (!$cfg['enabled'] || !is_string($text) || $text === '' || mb_strlen($text) > 120) {
        return $text;
    }
    if ($index === null) {
        $index = [];
        global $textbotlang;
        $walk = function ($node) use (&$walk, &$index) {
            if (is_array($node)) {
                foreach ($node as $v) {
                    $walk($v);
                }
            } elseif (is_string($node) && $node !== '' && mb_strlen($node) <= 120 && strpos($node, "\n") === false) {
                $plain = premiumEmojiButtonText($node);
                if ($plain !== $node && $plain !== '' && !isset($index[$plain])) {
                    $index[$plain] = $node;
                }
            }
        };
        if (isset($textbotlang) && is_array($textbotlang)) {
            $walk($textbotlang);
        }
    }
    return $index[$text] ?? $text;
}
