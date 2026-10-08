<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        roles VARCHAR(200) NOT NULL DEFAULT 'customer',
        phone VARCHAR(40) NULL,
        email VARCHAR(200) NULL,
        tg_user_id VARCHAR(100) NULL,
        note TEXT NULL,
        archived TINYINT(1) NOT NULL DEFAULT 0,
        created_at INT NOT NULL DEFAULT 0,
        UNIQUE KEY uq_fin_party_tg (tg_user_id),
        KEY idx_fin_party_name (name(100))
        SQL,
];
