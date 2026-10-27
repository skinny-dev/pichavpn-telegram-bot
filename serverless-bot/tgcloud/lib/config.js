// Built-in settings of this deployment. The copy of the project that runs `tgcloud push` gets the real values from
// `php scripts/serverless_setup.php project --main --full` (the PHP server's address and key, the admins who may use /mode).
// With api_url set the bot starts in «relay» mode (the PHP bot answers); without it the bot runs by itself.
export default { api_url: '', api_key: '', admin_ids: [], mode: 'native' }
