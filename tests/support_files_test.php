<?php
// php tests/support_files_test.php
require __DIR__ . '/../support_files.php';
$fail = 0;
function ok($c, $m) { global $fail; echo ($c ? 'ok   ' : 'FAIL ') . $m . "\n"; if (!$c) $fail++; }
$m = supportMediaFromMessage(['photo' => [['file_id' => 'small', 'file_size' => 10], ['file_id' => 'big', 'file_size' => 99]], 'caption' => 'x']);
ok($m && $m['type'] === 'photo' && $m['file_id'] === 'big', 'photo: the largest size is used');
$m = supportMediaFromMessage(['video' => ['file_id' => 'v1', 'file_name' => 'a.mp4', 'file_size' => 5]]);
ok($m && $m['type'] === 'video' && $m['file_id'] === 'v1' && $m['name'] === 'a.mp4', 'video');
$m = supportMediaFromMessage(['document' => ['file_id' => 'd1', 'file_name' => 'report.pdf']]);
ok($m && $m['type'] === 'document' && $m['name'] === 'report.pdf', 'document');
ok(supportMediaFromMessage(['voice' => ['file_id' => 'o1']])['type'] === 'voice', 'voice');
ok(supportMediaFromMessage(['audio' => ['file_id' => 'a1']])['type'] === 'audio', 'audio');
ok(supportMediaFromMessage(['video_note' => ['file_id' => 'n1']])['type'] === 'video_note', 'video note');
ok(supportMediaFromMessage(['text' => 'hi']) === null && supportMediaFromMessage(null) === null && supportMediaFromMessage(['photo' => []]) === null, 'no attachment = null');
ok(supportMediaFromMessage(['document' => ['file_name' => 'x']]) === null, 'missing file_id = null');
ok(supportFileDelivery('photo') === ['image/jpeg', true], 'photo inline');
ok(supportFileDelivery('video', 'x.mov') === ['video/mp4', true], 'video inline');
ok(supportFileDelivery('voice') === ['audio/ogg', true], 'voice inline');
ok(supportFileDelivery('document', 'pic.PNG') === ['image/png', true], 'document that is an image is shown inline');
ok(supportFileDelivery('document', 'clip.webm') === ['video/webm', true], 'document that is a video is shown inline');
ok(supportFileDelivery('document', 'evil.html') === ['application/octet-stream', false], 'html is never inline (download only)');
ok(supportFileDelivery('document', 'evil.svg') === ['application/octet-stream', false], 'svg is never inline');
ok(supportFileDelivery('document', 'doc.pdf') === ['application/octet-stream', false], 'pdf is a download');
ok(supportFileDelivery('document', '') === ['application/octet-stream', false], 'unknown = download');
exit($fail ? 1 : 0);
