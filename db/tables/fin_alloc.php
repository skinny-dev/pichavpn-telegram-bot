<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        payment_txn_id BIGINT UNSIGNED NOT NULL,
        doc_txn_id BIGINT UNSIGNED NOT NULL,
        amount BIGINT NOT NULL,
        created_at INT NOT NULL DEFAULT 0,
        KEY idx_fin_alloc_pay (payment_txn_id),
        KEY idx_fin_alloc_doc (doc_txn_id)
        SQL,
];
