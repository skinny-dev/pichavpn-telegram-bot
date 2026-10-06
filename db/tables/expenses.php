<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id INT(10) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        amount BIGINT NOT NULL DEFAULT 0,
        description VARCHAR(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
        created_at INT NOT NULL,
        admin_id VARCHAR(100) NULL
        SQL,
    'columns' => [
        ['kind', 'general', 'VARCHAR(30)'],
    ],
];
