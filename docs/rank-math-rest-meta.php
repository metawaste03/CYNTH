<?php
/**
 * Plugin Name: Rank Math REST meta for Cynth
 * Description: Exposes Rank Math's per-post SEO fields to the WordPress REST API so an authorised editor can write them. Without this, WordPress silently drops them.
 * Version:     1.0.0
 * Author:      Cynth
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Rank Math stores a post's SEO title, meta description, canonical URL and
 * focus keyword as ordinary post meta. It does not register those keys with
 * `show_in_rest`, and WordPress ignores unregistered meta keys sent to
 * /wp-json/wp/v2/posts — with no error. A push appears to succeed and the
 * fields are simply not there.
 *
 * This registers the four keys Cynth writes, and nothing else.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * - It does not make the fields public. `auth_callback` requires the same
 *   capability WordPress requires to edit the post itself, so only an
 *   authenticated user who could already edit the post can write them.
 * - It does not register every Rank Math key. The ones Cynth does not write
 *   stay exactly as they are, editable only in Rank Math's own interface.
 * - It does not read, change or delete anything. Registration only.
 *
 * INSTALL
 * -------
 * Copy to: wp-content/mu-plugins/rank-math-rest-meta.php
 *
 * `mu-plugins` is the "must-use" folder. Create it if it does not exist.
 * Plugins there activate automatically and cannot be deactivated from the
 * admin screen, which is what you want for a small integration shim: it
 * cannot be switched off by accident, and it survives plugin updates.
 *
 * To remove it, delete the file.
 */

if (!defined('ABSPATH')) {
    exit;
}

add_action('init', function () {
    $keys = [
        'rank_math_title',
        'rank_math_description',
        'rank_math_canonical_url',
        'rank_math_focus_keyword',
    ];

    foreach ($keys as $key) {
        register_post_meta('post', $key, [
            'type'         => 'string',
            'single'       => true,
            'show_in_rest' => true,
            'auth_callback' => function ($allowed, $meta_key, $post_id) {
                // The same permission WordPress requires to edit the post.
                // Nothing here grants access that the user did not already have.
                return current_user_can('edit_post', $post_id);
            },
            'sanitize_callback' => function ($value) {
                // Meta descriptions and titles are plain text. Stripping tags
                // here means a malformed value cannot become markup in the
                // page head.
                return wp_strip_all_tags((string) $value);
            },
        ]);
    }
});
