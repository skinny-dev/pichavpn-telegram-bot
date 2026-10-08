<?php
// Pure helpers for support attachments (no database, no Telegram calls): shared by the bot and the web panel API.

/** The attachment of a Telegram message (photo/video/document/voice/audio/animation/video note) or null. $msg = $update['message']. */
function supportMediaFromMessage($msg)
{
    if (!is_array($msg)) {
        return null;
    }
    foreach (['photo', 'video', 'document', 'voice', 'audio', 'animation', 'video_note'] as $kind) {
        if (empty($msg[$kind]) || !is_array($msg[$kind])) {
            continue;
        }
        $o = $kind === 'photo' ? end($msg[$kind]) : $msg[$kind]; // photo = list of sizes, the last is the largest
        if (empty($o['file_id'])) {
            continue;
        }
        return ['type' => $kind, 'file_id' => (string) $o['file_id'], 'name' => (string) ($o['file_name'] ?? ''), 'size' => (int) ($o['file_size'] ?? 0)];
    }
    return null;
}

/**
 * How the panel may show a support attachment: [content type, inline?]. Only plain images, video and audio are shown inline;
 * everything else is offered as a download so an uploaded html/svg/js file can never run in the panel's origin.
 */
function supportFileDelivery($type, $name = '')
{
    $ext = strtolower(pathinfo((string) $name, PATHINFO_EXTENSION));
    $byExt = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'gif' => 'image/gif', 'webp' => 'image/webp',
        'mp4' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime', 'mp3' => 'audio/mpeg', 'ogg' => 'audio/ogg', 'oga' => 'audio/ogg', 'wav' => 'audio/wav', 'm4a' => 'audio/mp4'];
    switch ($type) {
        case 'photo':
            return ['image/jpeg', true];
        case 'video':
        case 'animation':
        case 'video_note':
            return ['video/mp4', true];
        case 'voice':
            return ['audio/ogg', true];
        case 'audio':
            return [$byExt[$ext] ?? 'audio/mpeg', true];
    }
    return isset($byExt[$ext]) ? [$byExt[$ext], true] : ['application/octet-stream', false];
}
