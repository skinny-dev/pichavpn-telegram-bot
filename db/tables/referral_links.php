<?php

// Advertising / influencer campaign links: https://t.me/<bot>?start=<code>. No Telegram account needed
// (Instagram, YouTube, channels...). price = what the campaign cost us; pays_commission = checkbox.
return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        platform VARCHAR(30) NOT NULL DEFAULT 'other',
        code VARCHAR(40) NOT NULL,
        tg_user_id VARCHAR(30) NULL,
        contact VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
        price BIGINT NOT NULL DEFAULT 0,
        pays_commission TINYINT(1) NOT NULL DEFAULT 0,
        commission_percent INT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        notes VARCHAR(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
        expense_id INT UNSIGNED NULL,
        created_at INT NOT NULL,
        UNIQUE KEY uq_referral_code (code)
        SQL,
];
