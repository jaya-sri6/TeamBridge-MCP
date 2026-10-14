<?php
/**
 * Plugin Name: TeamBridge Auto-Provisioner & WooCommerce Seeder
 * Description: Automatically initializes WooCommerce, permalinks, Cash on Delivery, REST API keys, and demo products for Kubernetes deployment.
 * Version: 1.0.0
 * Author: TeamBridge MCP
 */

add_action('init', function() {
    // 0. Ensure WordPress core is installed
    if (!is_blog_installed()) {
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        wp_install('TeamBridge WooCommerce Store', 'admin', 'admin@teambridge.local', true, '', 'adminpassword123');
    }

    if (!function_exists('is_plugin_active')) {
        require_once ABSPATH . 'wp-admin/includes/plugin.php';
    }

    // 1. Ensure WooCommerce is active
    if (!is_plugin_active('woocommerce/woocommerce.php')) {
        activate_plugin('woocommerce/woocommerce.php');
    }

    // 2. Ensure permalink structure is set (required for REST API v3)
    if (get_option('permalink_structure') !== '/%postname%/') {
        global $wp_rewrite;
        $wp_rewrite->set_permalink_structure('/%postname%/');
        update_option('permalink_structure', '/%postname%/');
        $wp_rewrite->flush_rules();
    }

    // 3. Configure WooCommerce Options for Seamless Testing
    update_option('woocommerce_currency', 'USD');
    update_option('woocommerce_enable_guest_checkout', 'yes');
    update_option('woocommerce_enable_checkout_login_reminder', 'no');
    update_option('woocommerce_enable_myaccount_registration', 'yes');
    update_option('woocommerce_store_address', '100 Innovation Way');
    update_option('woocommerce_store_city', 'San Francisco');
    update_option('woocommerce_default_country', 'US:CA');

    // Enable Cash on Delivery (COD)
    $cod_settings = array(
        'enabled' => 'yes',
        'title' => 'Cash on Delivery (Test)',
        'description' => 'Pay cash or test checkout without payment credentials.',
        'instructions' => 'Order placed via test COD method.',
        'enable_for_virtual' => 'yes'
    );
    update_option('woocommerce_cod_settings', $cod_settings);

    // 4. Ensure TeamBridge REST API Key exists
    global $wpdb;
    $table_name = $wpdb->prefix . 'woocommerce_api_keys';
    
    // Check if table exists (WooCommerce creates it)
    if ($wpdb->get_var("SHOW TABLES LIKE '{$table_name}'") == $table_name) {
        $existing = $wpdb->get_row("SELECT * FROM {$table_name} WHERE description = 'TeamBridge MCP'");
        
        $consumer_key = getenv('WOO_CONSUMER_KEY') ?: 'ck_teambridge_local_key';
        $consumer_secret = getenv('WOO_CONSUMER_SECRET') ?: 'cs_teambridge_local_secret';
        $hashed_key = hash('sha256', $consumer_key);
        $truncated_key = substr($consumer_key, -7);

        if (!$existing) {
            $wpdb->insert($table_name, array(
                'user_id' => 1,
                'description' => 'TeamBridge MCP',
                'permissions' => 'read_write',
                'consumer_key' => $hashed_key,
                'consumer_secret' => $consumer_secret,
                'truncated_key' => $truncated_key,
            ));
        } else {
            // Update to match current environment secrets
            $wpdb->update($table_name, array(
                'consumer_key' => $hashed_key,
                'consumer_secret' => $consumer_secret,
                'truncated_key' => $truncated_key,
            ), array('key_id' => $existing->key_id));
        }
    }

    // 5. Seed Initial Test Products if none exist
    if (post_type_exists('product')) {
        $count = (int) wp_count_posts('product')->publish;
        if ($count === 0) {
            $initial_products = array(
                array(
                    'name' => 'Ergonomic Developer Chair',
                    'price' => '299.00',
                    'description' => 'High performance mesh chair engineered for long programming sessions.',
                ),
                array(
                    'name' => 'Mechanical Keyboard (RGB)',
                    'price' => '129.99',
                    'description' => 'Hot-swappable mechanical switches with custom PBT keycaps.',
                ),
                array(
                    'name' => 'TeamBridge Engineering Hoodie',
                    'price' => '45.00',
                    'description' => 'Heavyweight cotton hoodie with embroidered Kubernetes & MCP logos.',
                ),
            );

            foreach ($initial_products as $p_data) {
                $post_id = wp_insert_post(array(
                    'post_title' => $p_data['name'],
                    'post_content' => $p_data['description'],
                    'post_status' => 'publish',
                    'post_type' => 'product',
                ));

                if ($post_id && !is_wp_error($post_id)) {
                    update_post_meta($post_id, '_price', $p_data['price']);
                    update_post_meta($post_id, '_regular_price', $p_data['price']);
                    update_post_meta($post_id, '_visibility', 'visible');
                    update_post_meta($post_id, '_stock_status', 'instock');
                    wp_set_object_terms($post_id, 'simple', 'product_type');
                }
            }
        }
    }
});

// Enable WooCommerce REST API authentication over internal cluster HTTP
add_filter('determine_current_user', function($user_id) {
    if ($user_id) {
        return $user_id;
    }

    $ck = null;
    $cs = null;

    if (!empty($_GET['consumer_key']) && !empty($_GET['consumer_secret'])) {
        $ck = sanitize_text_field($_GET['consumer_key']);
        $cs = sanitize_text_field($_GET['consumer_secret']);
    } elseif (!empty($_SERVER['PHP_AUTH_USER']) && !empty($_SERVER['PHP_AUTH_PW'])) {
        $ck = sanitize_text_field($_SERVER['PHP_AUTH_USER']);
        $cs = sanitize_text_field($_SERVER['PHP_AUTH_PW']);
    } elseif (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
        if (strpos($_SERVER['HTTP_AUTHORIZATION'], 'Basic ') === 0) {
            $decoded = base64_decode(substr($_SERVER['HTTP_AUTHORIZATION'], 6));
            if ($decoded && strpos($decoded, ':') !== false) {
                list($ck, $cs) = explode(':', $decoded, 2);
            }
        }
    }

    if ($ck && $cs) {
        global $wpdb;
        $hash = hash('sha256', $ck);
        $key = $wpdb->get_row($wpdb->prepare("SELECT user_id, consumer_secret FROM {$wpdb->prefix}woocommerce_api_keys WHERE consumer_key = %s", $hash));
        if ($key && hash_equals($key->consumer_secret, $cs)) {
            return (int) $key->user_id;
        }
    }

    return $user_id;
}, 20);
