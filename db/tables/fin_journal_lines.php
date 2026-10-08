<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        entry_id BIGINT UNSIGNED NOT NULL,
        account_id INT UNSIGNED NOT NULL,
        debit BIGINT NOT NULL DEFAULT 0,
        credit BIGINT NOT NULL DEFAULT 0,
        party_id BIGINT UNSIGNED NULL,
        memo VARCHAR(300) NULL,
        KEY idx_fin_jl_entry (entry_id),
        KEY idx_fin_jl_acc (account_id, entry_id),
        KEY idx_fin_jl_party (party_id)
        SQL,
];
