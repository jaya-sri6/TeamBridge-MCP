<?php
$_GET['consumer_key'] = 'ck_teambridge_local_key';
$_GET['consumer_secret'] = 'cs_teambridge_local_secret';
$user_id = apply_filters('determine_current_user', false);
echo "Filtered user ID: " . var_export($user_id, true) . "\n";
