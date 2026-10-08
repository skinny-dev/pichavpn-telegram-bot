<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        party_id BIGINT UNSIGNED NOT NULL,
        percent DECIMAL(7,4) NOT NULL DEFAULT 0,
        shares DECIMAL(18,4) NULL,
        share_value BIGINT NULL,
        voting_percent DECIMAL(7,4) NULL,
        effective_from INT NOT NULL,
        note VARCHAR(300) NULL,
        created_by VARCHAR(100) NULL,
        created_at INT NOT NULL DEFAULT 0,
        KEY idx_fin_own_party (party_id, effective_from),
        KEY idx_fin_own_date (effective_from)
        SQL,
];
