<?php
// Every 10 minutes: are the payment gateways reachable from the bot? Alerts go to «💳 خطای درگاه پرداخت».
require_once dirname(__DIR__) . '/config.php';
require_once dirname(__DIR__) . '/botapi.php';
require_once dirname(__DIR__) . '/jdf.php';
require_once dirname(__DIR__) . '/function.php';
paymentGatewayProbe();
