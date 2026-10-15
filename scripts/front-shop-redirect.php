<?php
/**
 * Plugin Name: TeamBridge Storefront Front Page Redirect
 * Description: Automatically directs visitors on the root domain to the WooCommerce Shop catalog with sorting and product filters.
 */

add_action('template_redirect', function () {
    if (is_front_page() && !is_shop() && function_exists('wc_get_page_permalink')) {
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
        if ($path === '/' || $path === '') {
            $shop_url = wc_get_page_permalink('shop');
            if ($shop_url) {
                wp_safe_redirect($shop_url, 302);
                exit;
            }
        }
    }
});
