<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        link_id INT UNSIGNED NOT NULL,
        amount BIGINT NOT NULL,
        note VARCHAR(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
        created_at INT NOT NULL,
        KEY ix_payout_link (link_id)
        SQL,
];
