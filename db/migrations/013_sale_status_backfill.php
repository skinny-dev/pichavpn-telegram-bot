<?php

// Category/product sale status: rows created before the column existed get an explicit 'active'
// (NULL already behaves as available; this just makes the web panel show «موجود»).
return static function (PDO $pdo, Schema $schema): void {
    if ($schema->tableExists('category')) {
        $pdo->exec("UPDATE category SET status = 'active' WHERE status IS NULL OR status = ''");
    }
    if ($schema->tableExists('product')) {
        $pdo->exec("UPDATE product SET status_product = 'active' WHERE status_product IS NULL OR status_product = ''");
    }
};
