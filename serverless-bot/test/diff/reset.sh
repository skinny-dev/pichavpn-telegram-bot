#!/usr/bin/env bash
# fresh test data in MySQL for the PHP side (the same seed the panel tests use) + the settings both bots read
set -e
mysql --default-character-set=utf8mb4 mirza < "${SEED:-/home/user/pichavpn-telegram-bot/tests/seed_test_db.sql}"
# the settings tables as they were before any scenario (scenarios change them): saved once, restored every time
BASE="${DIFF_DIR:-/tmp}/base_settings.sql"
TABLES="setting shopSetting PaySetting affiliates marzban_panel admin topicid DiscountSell Giftcodeconsumed category help departman support_message cancel_service"
if [ -s "$BASE" ]; then mysql --default-character-set=utf8mb4 mirza < "$BASE"; else mysqldump --default-character-set=utf8mb4 mirza $TABLES > "$BASE"; fi
mysql mirza -e "UPDATE marzban_panel SET url_panel='http://127.0.0.1:8111', code_panel='P1', agent='all';
  UPDATE user SET roll_Status=1, joinchannel='active', last_message_time=0, message_count=0;
  DELETE FROM channels; DELETE FROM marzban_panel WHERE name_panel <> 'Picha-1';"
rm -f "$PHP_ROOT/storage/cache/recent_updates.json"
