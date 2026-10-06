<?php

// Everyone who exists today already has the bottom menu on their screen: they get the welcome as ONE message.
// New users (menu_sent stays 0) get the bottom menu once, with their first /start.
return static function (PDO $pdo, Schema $schema): void {
    if ($schema->tableExists('user')) {
        $pdo->exec("UPDATE user SET menu_sent = '1' WHERE menu_sent IS NULL OR menu_sent = '' OR menu_sent = '0'");
    }
};
