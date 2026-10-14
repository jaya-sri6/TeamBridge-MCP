<?php
$auth = new WC_REST_Authentication();
$_SERVER['REQUEST_METHOD'] = 'GET';
$_GET['consumer_key'] = 'ck_teambridge_local_key';
$_GET['consumer_secret'] = 'cs_teambridge_local_secret';

$res = $auth->authenticate(false);
echo "Authentication result: ";
var_dump($res);
echo "Current user ID after auth: " . get_current_user_id() . "\n";

// Let's also check is_ssl()
echo "is_ssl(): " . (is_ssl() ? "TRUE" : "FALSE") . "\n";
