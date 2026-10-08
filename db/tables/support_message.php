<?php

return [
    'create' => <<<SQL
        id INT(6) UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        Tracking VARCHAR(100) NOT NULL,
        idsupport VARCHAR(100) NOT NULL,
        iduser VARCHAR(100) NOT NULL,
        name_departman VARCHAR(600) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        text TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        result TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        time VARCHAR(200) NOT NULL,
        status ENUM('Answered','Pending','Unseen','Customerresponse','close') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL
        SQL,
    'columns' => [
        ['result', '0', 'TEXT'],
        ['result_time', '', 'VARCHAR(50)'],
        ['result_by', '', 'VARCHAR(100)'],
        // attachments (Telegram file ids; the files themselves stay on Telegram): customer side and support side
        ['file_id', '', 'VARCHAR(300)'],
        ['file_type', '', 'VARCHAR(20)'],
        ['file_name', '', 'VARCHAR(255)'],
        ['result_file_id', '', 'VARCHAR(300)'],
        ['result_file_type', '', 'VARCHAR(20)'],
        ['result_file_name', '', 'VARCHAR(255)'],
    ],
];
