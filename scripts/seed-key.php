<?php
global $wpdb;
$table = $wpdb->prefix . 'woocommerce_api_keys';
$ck = getenv('WOO_CONSUMER_KEY') ?: 'ck_teambridge_local_key';
$cs = getenv('WOO_CONSUMER_SECRET') ?: 'cs_teambridge_local_secret';
$hash = hash('sha256', $ck);
$trunc = substr($ck, -7);

$existing = $wpdb->get_var($wpdb->prepare("SELECT key_id FROM {$table} WHERE consumer_key = %s", $hash));
if (!$existing) {
    $wpdb->insert($table, array(
        'user_id' => 1,
        'description' => 'TeamBridge MCP',
        'permissions' => 'read_write',
        'consumer_key' => $hash,
        'consumer_secret' => $cs,
        'truncated_key' => $trunc,
    ));
    echo "Key created with ID: " . $wpdb->insert_id . "\n";
} else {
    echo "Key already exists with ID: {$existing}\n";
}

// Also ensure permalink structure is /%postname%/
if (get_option('permalink_structure') !== '/%postname%/') {
    global $wp_rewrite;
    $wp_rewrite->set_permalink_structure('/%postname%/');
    update_option('permalink_structure', '/%postname%/');
    $wp_rewrite->flush_rules();
    echo "Permalinks updated to /%postname%/\n";
}

// Enable Cash on Delivery
$cod = array(
    'enabled' => 'yes',
    'title' => 'Cash on Delivery (Test)',
    'description' => 'Pay cash or test checkout without payment credentials.',
    'instructions' => 'Order placed via test COD method.',
    'enable_for_virtual' => 'yes'
);
update_option('woocommerce_cod_settings', $cod);
echo "COD payment method enabled\n";

// Seed sample products if none exist
$count = (int) wp_count_posts('product')->publish;
if ($count === 0) {
    $products = array(
        array('name' => 'Ergonomic Developer Chair', 'price' => '299.00', 'desc' => 'High performance mesh chair engineered for long programming sessions.'),
        array('name' => 'Mechanical Keyboard (RGB)', 'price' => '129.99', 'desc' => 'Hot-swappable mechanical switches with custom PBT keycaps.'),
        array('name' => 'TeamBridge Engineering Hoodie', 'price' => '45.00', 'desc' => 'Heavyweight cotton hoodie with embroidered Kubernetes & MCP logos.')
    );
    foreach ($products as $p) {
        $post_id = wp_insert_post(array(
            'post_title' => $p['name'],
            'post_content' => $p['desc'],
            'post_status' => 'publish',
            'post_type' => 'product',
        ));
        if ($post_id && !is_wp_error($post_id)) {
            update_post_meta($post_id, '_price', $p['price']);
            update_post_meta($post_id, '_regular_price', $p['price']);
            update_post_meta($post_id, '_visibility', 'visible');
            update_post_meta($post_id, '_stock_status', 'instock');
            wp_set_object_terms($post_id, 'simple', 'product_type');
            echo "Created sample product: {$p['name']} (ID: {$post_id})\n";
        }
    }
} else {
    echo "Store already has {$count} published products.\n";
}
