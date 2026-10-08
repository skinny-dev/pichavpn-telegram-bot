<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(20) NOT NULL,
        name VARCHAR(200) NOT NULL,
        type ENUM('asset','liability','equity','revenue','expense') NOT NULL,
        parent_code VARCHAR(20) NULL,
        money_kind VARCHAR(20) NULL,
        system_key VARCHAR(40) NULL,
        is_postable TINYINT(1) NOT NULL DEFAULT 1,
        allow_negative TINYINT(1) NOT NULL DEFAULT 0,
        archived TINYINT(1) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        currency VARCHAR(8) NOT NULL DEFAULT 'IRT',
        created_at INT NOT NULL DEFAULT 0,
        UNIQUE KEY uq_fin_acc_code (code),
        UNIQUE KEY uq_fin_acc_key (system_key),
        KEY idx_fin_acc_type (type)
        SQL,
    'seed' => require __DIR__ . '/../../finance/chart_seed.php',
];
