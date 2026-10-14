FROM wordpress:6.7-apache

# Install unzip, curl, and WP-CLI
RUN apt-get update && apt-get install -y unzip curl mariadb-client && \
    curl -o /tmp/wc.zip -L https://downloads.wordpress.org/plugin/woocommerce.9.3.3.zip && \
    mkdir -p /usr/src/wordpress/wp-content/plugins && \
    unzip -q /tmp/wc.zip -d /usr/src/wordpress/wp-content/plugins/ && \
    rm /tmp/wc.zip && \
    curl -o /usr/local/bin/wp -L https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && \
    chmod +x /usr/local/bin/wp && \
    rm -rf /var/lib/apt/lists/*

# Copy mu-plugin to auto-initialize WooCommerce
COPY scripts/teambridge-init.php /usr/src/wordpress/wp-content/mu-plugins/teambridge-init.php
