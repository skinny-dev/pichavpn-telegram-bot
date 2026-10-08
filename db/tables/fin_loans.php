<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        party_id BIGINT UNSIGNED NOT NULL,
        direction VARCHAR(10) NOT NULL,
        principal BIGINT NOT NULL,
        interest_rate DECIMAL(7,3) NOT NULL DEFAULT 0,
        start_date INT NOT NULL,
        installments INT NOT NULL DEFAULT 1,
        note VARCHAR(300) NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at INT NOT NULL DEFAULT 0,
        KEY idx_fin_loan_party (party_id)
        SQL,
];
