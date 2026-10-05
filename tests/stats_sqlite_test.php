<?php
date_default_timezone_set('Asia/Tehran');
require __DIR__ . "/../stats_report.php";
$pdo = new PDO('sqlite::memory:'); $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
$pdo->sqliteCreateFunction('REGEXP', fn($p,$s)=>preg_match('/'.$p.'/',(string)$s)?1:0, 2);
$pdo->exec("CREATE TABLE invoice(id_invoice,id_user,time_sell,name_product,price_product,Volume,Status);
CREATE TABLE user(id,agent,register);
CREATE TABLE service_other(id_user,type,time,price,value,status);
CREATE TABLE Payment_report(price,time,payment_Status,Payment_Method,id_invoice);
CREATE TABLE expenses(amount,created_at); CREATE TABLE capital_entries(amount,created_at);");
$now=time(); $reg=$now-300;
$pdo->exec("INSERT INTO user VALUES (1,'f',$reg),(2,'n',".($now-99999)."),(3,'f',$now-50)");
$pdo->exec("INSERT INTO invoice VALUES ('a',1,".($now-200).",'30GB',60000,30,'active'),('b',2,".($now-100).",'20GB',986,20,'active'),('c',2,".($now-5000000).",'old',5000,10,'active'),('t',3,$now-10,'سرویس تست',0,1,'active')");
$d=date('Y/m/d H:i:s',$now-60);
$pdo->exec("INSERT INTO service_other VALUES (2,'extend_user','$d',100000,'x','paid'),(2,'extend_user','$d',165724,'x','paid'),(2,'extra_user','$d',5000,'10','paid')");
$pdo->exec("INSERT INTO Payment_report VALUES (200542,'$d','paid','cart to cart','none'),(1000,'$d','paid','low balance by admin','none'),(9999,'$d','paid','zarinpal','abc')");
$pdo->exec("INSERT INTO expenses VALUES (7000,$now-10); INSERT INTO capital_entries VALUES (500000,$now-10)");
foreach (['today','all','lastmonth'] as $k) { echo statsReport($pdo,$k),"\n=========\n"; }
