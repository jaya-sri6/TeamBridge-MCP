<?php
global $wpdb;
$ck = 'ck_teambridge_local_key';
$cs = 'cs_teambridge_local_secret';
$hash = hash('sha256', $ck);

$row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$wpdb->prefix}woocommerce_api_keys WHERE consumer_key = %s", $hash));
echo "Key row found: " . ($row ? "YES (ID: {$row->key_id})" : "NO") . "\n";
if ($row) {
    echo "User ID: {$row->user_id}\n";
    echo "Permissions: {$row->permissions}\n";
    echo "Consumer secret in DB: {$row->consumer_secret}\n";
    $user = get_user_by('id', $row->user_id);
    echo "User login: {$user->user_login}\n";
    echo "User roles: " . implode(', ', $user->roles) . "\n";
    echo "Can manage_woocommerce: " . (user_can($user, 'manage_woocommerce') ? "YES" : "NO") . "\n";
    echo "Can read_private_products: " . (user_can($user, 'read_private_products') ? "YES" : "NO") . "\n";
}

// Test what WC_REST_Authentication does:
if (class_exists('WC_REST_Authentication')) {
    echo "WC_REST_Authentication exists\n";
}
