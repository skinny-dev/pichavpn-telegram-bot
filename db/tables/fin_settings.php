<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        k VARCHAR(80) NOT NULL PRIMARY KEY,
        v TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL
        SQL,
];
