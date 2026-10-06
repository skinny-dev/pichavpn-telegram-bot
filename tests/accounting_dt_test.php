<?php
// php tests/accounting_dt_test.php
chdir(__DIR__ . '/..');
date_default_timezone_set('Asia/Tehran');
require __DIR__ . '/../stats_report.php';
$fail = 0;
function ok($c, $m) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) $fail++; }
$tehran = fn($s) => (new DateTime($s, new DateTimeZone('Asia/Tehran')))->getTimestamp();
$now = 1790000000;
ok(accParseDateTime('', $now) === $now, 'empty = now');
ok(accParseDateTime('  ', $now) === $now, 'blank = now');
ok(accParseDateTime('2020-01-05 10:00') === $tehran('2020-01-05 10:00:00'), 'Gregorian date + time');
ok(accParseDateTime('1398/10/15 10:00') === $tehran('2020-01-05 10:00:00'), 'Jalali date + time (1398/10/15 = 2020-01-05)');
ok(accParseDateTime('۱۳۹۸/۱۰/۱۵ ۱۰:۰۰') === $tehran('2020-01-05 10:00:00'), 'Persian digits');
ok(accParseDateTime('1398-10-15') === $tehran('2020-01-05 12:00:00'), 'date without time = 12:00');
ok(accParseDateTime('1405.07.14 9:05') === $tehran('2026-10-06 09:05:00'), 'dots and one-digit hour (1405/07/14 = 2026-10-06)');
ok(accParseDateTime('1405/13/40') === null, 'impossible date rejected');
ok(accParseDateTime('1405/07/14 25:00') === null, 'impossible hour rejected');
ok(accParseDateTime('دیروز') === null, 'free text rejected');
ok(accParseDateTime('1790000000') === 1790000000, 'a unix time passes through (re-import of old rows)');
ok(accFormatDateTime($tehran('2020-01-05 10:00:00')) === '1398/10/15 10:00', 'format = Jalali, Latin digits');
ok(accParseDateTime(accFormatDateTime($tehran('2026-10-06 15:30:00'))) === $tehran('2026-10-06 15:30:00'), 'format → parse round trip');
ok(isset(accExpenseKinds()['advertising']) && accExpenseKinds()['advertising'] === 'تبلیغات', 'advertising kind is «تبلیغات»');
exit($fail ? 1 : 0);
