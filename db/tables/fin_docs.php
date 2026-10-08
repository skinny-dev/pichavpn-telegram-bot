<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        txn_id BIGINT UNSIGNED NULL,
        party_id BIGINT UNSIGNED NULL,
        kind VARCHAR(30) NOT NULL DEFAULT 'attachment',
        name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        path VARCHAR(500) NOT NULL,
        mime VARCHAR(100) NULL,
        size BIGINT NOT NULL DEFAULT 0,
        created_by VARCHAR(100) NULL,
        created_at INT NOT NULL DEFAULT 0,
        KEY idx_fin_docs_txn (txn_id),
        KEY idx_fin_docs_party (party_id)
        SQL,
];
