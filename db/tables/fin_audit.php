<?php

return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        at INT NOT NULL,
        user VARCHAR(100) NULL,
        action VARCHAR(40) NOT NULL,
        entity VARCHAR(40) NOT NULL,
        entity_id VARCHAR(60) NULL,
        detail TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NULL,
        KEY idx_fin_audit_at (at),
        KEY idx_fin_audit_entity (entity, entity_id)
        SQL,
];
