<?php
// Endpoint for the server-status agent (a server inside Iran). Every call needs the agent key from
// storage/server_status.json (php scripts/server_status.php agent-setup prints the install commands).
//   ?a=script  the agent's bash script        ?a=xray    the Xray binary
//   ?a=config  a fresh test job (Xray config) ?a=list    «index<TAB>port» of that job
//   POST ?a=result  the agent's raw numbers → the status message is posted / updated
chdir(__DIR__);
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/botapi.php';
require_once __DIR__ . '/jdf.php';
require_once __DIR__ . '/function.php';
require_once __DIR__ . '/panels.php';
require_once __DIR__ . '/premium_emoji.php';
require_once __DIR__ . '/server_status.php';

$cfg = ssConfig();
$key = (string) ($_GET['key'] ?? '');
if ($cfg['agent_key'] === '' || !hash_equals((string) $cfg['agent_key'], $key)) {
    http_response_code(403);
    exit('forbidden');
}
$a = (string) ($_GET['a'] ?? '');
try {
    switch ($a) {
        case 'script':
            header('Content-Type: text/plain; charset=utf-8');
            echo ssAgentScript('https://' . $domainhosts . '/status_agent.php', $cfg['agent_key'], $cfg);
            break;
        case 'xray':
            $x = ssXrayPath($cfg);
            if (!$x) {
                throw new RuntimeException('xray is not installed on the bot server');
            }
            header('Content-Type: application/octet-stream');
            header('Content-Length: ' . filesize($x));
            readfile($x);
            break;
        case 'config':
            header('Content-Type: application/json');
            echo json_encode(ssAgentJob($cfg)['config'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            break;
        case 'list':
            header('Content-Type: text/plain');
            foreach ((ssState()['agent_job']['ports'] ?? []) as $i => $p) {
                echo $i . "\t" . $p . "\n";
            }
            break;
        case 'result':
            $job = ssState()['agent_job'] ?? null;
            if (!$job || time() - (int) $job['at'] > 3600) {
                throw new RuntimeException('no recent job');
            }
            $results = ssAgentResults((string) file_get_contents('php://input'), $job, $cfg);
            $cfg['from_label'] = $cfg['agent_label'];
            $id = ssPost(ssMessage($results, $cfg), $cfg);
            ssSaveState(['last_results' => $results, 'last_ok' => time(), 'last_run' => time()] + ssState());
            echo "ok $id";
            break;
        default:
            http_response_code(400);
            echo 'unknown action';
    }
} catch (Throwable $e) {
    http_response_code(500);
    error_log('status_agent: ' . $e->getMessage());
    echo 'error: ' . $e->getMessage();
}
