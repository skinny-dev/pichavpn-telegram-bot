#!/usr/bin/env bash
# fresh test data in MySQL for the PHP side (the same seed the panel tests use) + the settings both bots read
set -e
mysql --default-character-set=utf8mb4 mirza < "${SEED:-/home/user/pichavpn-telegram-bot/tests/seed_test_db.sql}"
mysql mirza -e "UPDATE marzban_panel SET url_panel='http://127.0.0.1:8111', code_panel='P1', agent='all';
  UPDATE user SET roll_Status=1, joinchannel='active', last_message_time=0, message_count=0;
  DELETE FROM channels;"
rm -f "$PHP_ROOT/storage/cache/recent_updates.json"
