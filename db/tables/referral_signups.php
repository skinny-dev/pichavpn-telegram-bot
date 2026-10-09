<?php

// First-touch attribution: a user belongs to the first campaign link they ever opened.
return [
    'options' => 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci',
    'create' => <<<SQL
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        link_id INT UNSIGNED NOT NULL,
        user_id VARCHAR(30) NOT NULL,
        created_at INT NOT NULL,
        UNIQUE KEY uq_referral_user (user_id),
        KEY ix_referral_link (link_id)
        SQL,
];
