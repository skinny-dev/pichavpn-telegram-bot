<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        class VARCHAR(40) NOT NULL DEFAULT 'equipment',
        asset_account_id INT UNSIGNED NOT NULL,
        cost BIGINT NOT NULL,
        salvage BIGINT NOT NULL DEFAULT 0,
        purchase_date INT NOT NULL,
        useful_life_months INT NOT NULL DEFAULT 36,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        note VARCHAR(300) NULL,
        created_at INT NOT NULL DEFAULT 0
        SQL,
];
