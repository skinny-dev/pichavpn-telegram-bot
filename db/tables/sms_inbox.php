<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id INT(10) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        fingerprint CHAR(40) NOT NULL,
        received_at INT NOT NULL,
        bank VARCHAR(40) NULL,
        kind VARCHAR(20) NOT NULL,
        amount_rial BIGINT NOT NULL DEFAULT 0,
        balance_rial BIGINT NULL,
        sms_time VARCHAR(40) NULL,
        status VARCHAR(30) NOT NULL,
        id_order VARCHAR(200) NULL,
        note VARCHAR(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
        UNIQUE KEY uq_fingerprint (fingerprint),
        KEY idx_status (status)
        SQL,
    'columns' => [],
];
