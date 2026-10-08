<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        entry_no VARCHAR(30) NULL,
        entry_date INT NOT NULL,
        memo VARCHAR(500) NULL,
        source_type VARCHAR(30) NOT NULL DEFAULT 'manual',
        source_id VARCHAR(60) NULL,
        source_key VARCHAR(100) NULL,
        source_hash VARCHAR(40) NULL,
        txn_id BIGINT UNSIGNED NULL,
        status ENUM('draft','posted','reversed','cancelled') NOT NULL DEFAULT 'posted',
        reversal_of BIGINT UNSIGNED NULL,
        reversed_by BIGINT UNSIGNED NULL,
        currency VARCHAR(8) NOT NULL DEFAULT 'IRT',
        rate DECIMAL(18,8) NOT NULL DEFAULT 1,
        reason VARCHAR(300) NULL,
        created_by VARCHAR(100) NULL,
        created_at INT NOT NULL DEFAULT 0,
        approved_by VARCHAR(100) NULL,
        approved_at INT NULL,
        UNIQUE KEY uq_fin_je_key (source_key),
        KEY idx_fin_je_date (entry_date),
        KEY idx_fin_je_src (source_type, source_id),
        KEY idx_fin_je_txn (txn_id),
        KEY idx_fin_je_status (status)
        SQL,
];
