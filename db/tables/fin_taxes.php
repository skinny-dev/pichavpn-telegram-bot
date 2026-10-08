<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        rate DECIMAL(7,3) NOT NULL DEFAULT 0,
        kind VARCHAR(20) NOT NULL DEFAULT 'sales',
        archived TINYINT(1) NOT NULL DEFAULT 0
        SQL,
];
