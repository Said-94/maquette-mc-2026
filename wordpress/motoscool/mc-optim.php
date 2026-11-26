<?php
/**
 * Moto's Cool : vitesse, sécurité et référencement.
 * Tout est prudent : chaque réglage du serveur est testé et retiré tout seul s'il pose problème.
 */
if (!defined('ABSPATH')) exit;

if (function_exists('header_remove') && !headers_sent()) header_remove('X-Powered-By'); // ne jamais annoncer la version de PHP (toutes les réponses)

/* ---------- Outils ---------- */
// Page Moto's Cool vue par un visiteur (pas l'éditeur Elementor, pas un aperçu)
function mc_is_mc_front() {
    return function_exists('mc_mode') && mc_mode() && !is_admin() && is_page() && mc_key_of(get_queried_object_id()) !== ''
        && !mc_is_editor_preview() && !is_preview() && !isset($_GET['elementor-preview']);
}
// La page (ou son en-tête / pied de page) contient-elle des éléments Elementor ordinaires ajoutés par le client ?
function mc_sections_native($post_id) {
    $data = get_post_meta($post_id, '_elementor_data', true);
    if (is_string($data)) $data = json_decode($data, true);
    if (!is_array($data)) return false;
    foreach ($data as $sec) if (is_array($sec) && !mc_is_ours($sec)) return true;
    return false;
}
function mc_page_has_native($id) {
    static $cache = [];
    if (isset($cache[$id])) return $cache[$id];
    $r = mc_sections_native($id);
    if (!$r) {
        $p = mc_page_data(mc_key_of($id)); $ids = mc_ids();
        foreach (['header', 'footer'] as $k) {
            if ($p && !empty($p[$k]) && !empty($ids['t:' . $p[$k]]) && mc_sections_native((int) $ids['t:' . $p[$k]])) { $r = true; break; }
        }
    }
    return $cache[$id] = $r;
}
// La requête arrive-t-elle en https ? (OVH, proxys, Cloudflare)
function mc_req_https() {
    if (is_ssl()) return true;
    $s = $_SERVER;
    return (isset($s['HTTP_X_FORWARDED_PROTO']) && stripos($s['HTTP_X_FORWARDED_PROTO'], 'https') !== false)
        || (isset($s['HTTP_X_FORWARDED_SSL']) && strtolower($s['HTTP_X_FORWARDED_SSL']) === 'on')
        || (isset($s['REQUEST_SCHEME']) && strtolower($s['REQUEST_SCHEME']) === 'https')
        || (isset($s['HTTP_CF_VISITOR']) && strpos($s['HTTP_CF_VISITOR'], 'https') !== false);
}
function mc_home_https() { return wp_parse_url(home_url('/'), PHP_URL_SCHEME) === 'https'; }

/* ---------- En-têtes de sécurité ---------- */
function mc_sec_headers($page = true) {
    if (headers_sent()) return;
    if (function_exists('header_remove')) header_remove('X-Powered-By'); // ne pas annoncer la version de PHP
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: camera=(), microphone=(), payment=(), usb=(), interest-cohort=()');
    if (mc_home_https() && mc_req_https()) header('Strict-Transport-Security: max-age=31536000');
    if ($page) {
        header('X-Frame-Options: SAMEORIGIN');
        header("Content-Security-Policy: object-src 'none'; base-uri 'self'; frame-ancestors 'self'; upgrade-insecure-requests");
    }
}
add_action('send_headers', function () { if (!is_admin()) mc_sec_headers(true); });
add_action('login_init', function () { mc_sec_headers(true); });
add_filter('wp_headers', function ($h) { unset($h['X-Pingback']); return $h; });

/* ---------- Une seule adresse : https:// et sans (ou avec) « www », comme réglé dans WordPress ---------- */
// Sonde : le serveur sait-il reconnaître une visite en https ? (sinon pas de redirection, jamais de boucle)
add_action('init', function () {
    if (!isset($_GET['mc_sonde'])) return;
    $tok = (string) get_option('mc_sonde_jeton', '');
    if ($tok === '' || !hash_equals($tok, (string) $_GET['mc_sonde'])) return;
    nocache_headers(); header('Content-Type: application/json');
    echo wp_json_encode(['https' => mc_req_https()]); exit;
}, 0);
function mc_https_check() {
    if (!mc_home_https()) { update_option('mc_https_ok', '0', false); return; }
    $tok = wp_generate_password(24, false);
    update_option('mc_sonde_jeton', $tok, false);
    $r = wp_remote_get(add_query_arg('mc_sonde', $tok, home_url('/')), ['timeout' => 12, 'sslverify' => false, 'redirection' => 0]);
    $j = is_wp_error($r) ? null : json_decode((string) wp_remote_retrieve_body($r), true);
    update_option('mc_https_ok', (wp_remote_retrieve_response_code($r) === 200 && is_array($j) && !empty($j['https'])) ? '1' : '0', false);
    update_option('mc_sonde_jeton', '', false);
}
add_action('init', function () {
    if (is_admin() || wp_doing_ajax() || wp_doing_cron() || (defined('REST_REQUEST') && REST_REQUEST) || php_sapi_name() === 'cli' || isset($_GET['mc_sonde'])) return;
    if (!in_array(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET', ['GET', 'HEAD'], true)) return; // formulaires : jamais redirigés
    $home = wp_parse_url(home_url('/'));
    if (empty($home['host'])) return;
    $hh = strtolower($home['host']);
    $host = strtolower(preg_replace('/:\d+$/', '', isset($_SERVER['HTTP_HOST']) ? (string) $_SERVER['HTTP_HOST'] : ''));
    $other = $host !== '' && $host !== $hh && ('www.' . $hh === $host || 'www.' . $host === $hh); // www ↔ sans www
    $http = get_option('mc_https_ok') === '1' && mc_home_https() && !mc_req_https(); // jamais vers une adresse http (pas de boucle)
    if (!$other && !$http) return;
    $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '/';
    wp_redirect($home['scheme'] . '://' . $hh . (isset($home['port']) ? ':' . $home['port'] : '') . $uri, 301, "Moto's Cool");
    exit;
}, 1);

/* ---------- Réglages du serveur (.htaccess) : liste des dossiers fermée, cache long des images ---------- */
// Chaque bloc est ajouté seul, puis le site est testé : en cas d'erreur, le bloc est retiré aussitôt.
define('MC_HT_VER', '1');
function mc_ht_try($file, $marker, $lines) {
    $ok0 = wp_remote_retrieve_response_code(wp_remote_get(home_url('/'), ['timeout' => 15, 'sslverify' => false, 'redirection' => 0]));
    if (!$ok0 || $ok0 >= 500) return 'test-impossible';
    if (!insert_with_markers($file, $marker, $lines)) return 'non-ecrit';
    $ok1 = wp_remote_retrieve_response_code(wp_remote_get(home_url('/'), ['timeout' => 15, 'sslverify' => false, 'redirection' => 0]));
    $ok2 = wp_remote_retrieve_response_code(wp_remote_get(home_url('/assets/icons/favicon.svg'), ['timeout' => 15, 'sslverify' => false, 'redirection' => 0]));
    if (!$ok1 || $ok1 >= 500 || ($ok2 && $ok2 >= 500)) { insert_with_markers($file, $marker, []); return 'retire'; }
    return 'ok';
}
function mc_htaccess() {
    if (get_option('mc_ht_ver') === MC_HT_VER) return;
    update_option('mc_ht_ver', MC_HT_VER, false); // une seule tentative par version (jamais en boucle)
    if (!function_exists('insert_with_markers')) require_once ABSPATH . 'wp-admin/includes/misc.php';
    if (!function_exists('get_home_path')) require_once ABSPATH . 'wp-admin/includes/file.php';
    $f = get_home_path() . '.htaccess';
    if (!is_file($f) || !is_writable($f)) { update_option('mc_ht_etat', 'non-modifiable', false); return; }
    $etat = [];
    $etat['dossiers'] = mc_ht_try($f, "Moto's Cool securite", ['Options -Indexes']);
    $y = '"access plus 1 year"'; $w = '"access plus 7 days"';
    $etat['cache'] = mc_ht_try($f, "Moto's Cool cache", ['<IfModule mod_expires.c>', 'ExpiresActive On',
        "ExpiresByType image/jpeg $y", "ExpiresByType image/png $y", "ExpiresByType image/webp $y", "ExpiresByType image/avif $y",
        "ExpiresByType image/svg+xml $y", "ExpiresByType image/x-icon $y", "ExpiresByType font/woff2 $y", "ExpiresByType video/mp4 $y",
        "ExpiresByType video/webm $y", "ExpiresByType model/gltf-binary $y",
        "ExpiresByType text/css $w", "ExpiresByType text/javascript $w", "ExpiresByType application/javascript $w", '</IfModule>']);
    update_option('mc_ht_etat', $etat, false);
}
// Une fois, à la première page de l'administration après l'installation (et vérification https chaque jour)
add_action('admin_init', function () {
    if (wp_doing_ajax() || !current_user_can('manage_options')) return;
    if (function_exists('mc_ready') && !mc_ready()) return;
    if (get_option('mc_ht_ver') !== MC_HT_VER) mc_htaccess();
    if (!get_transient('mc_https_vu')) { set_transient('mc_https_vu', 1, DAY_IN_SECONDS); mc_https_check(); }
}, 50);
add_action('switch_theme', function () { // thème changé : les réglages Moto's Cool du serveur sont retirés
    if (!function_exists('insert_with_markers')) require_once ABSPATH . 'wp-admin/includes/misc.php';
    if (!function_exists('get_home_path')) require_once ABSPATH . 'wp-admin/includes/file.php';
    $f = get_home_path() . '.htaccess';
    if (is_file($f) && is_writable($f)) { insert_with_markers($f, "Moto's Cool cache", []); }
    delete_option('mc_ht_ver'); update_option('mc_https_ok', '0', false); delete_transient('mc_https_vu');
});

/* ---------- Discrétion : versions et noms d'utilisateurs non affichés ---------- */
add_filter('the_generator', '__return_empty_string');
add_filter('xmlrpc_enabled', '__return_false');
add_filter('rest_endpoints', function ($e) {
    if (is_user_logged_in()) return $e;
    foreach (array_keys($e) as $k) if (strpos($k, '/wp/v2/users') === 0) unset($e[$k]);
    return $e;
});
add_action('parse_request', function () {
    if (!is_admin() && isset($_GET['author']) && !is_user_logged_in()) { wp_safe_redirect(home_url('/'), 301); exit; }
}, -5);
add_filter('oembed_response_data', function ($d) { unset($d['author_name'], $d['author_url']); return $d; });

/* ---------- Vitesse : rien d'inutile sur les pages Moto's Cool ---------- */
add_action('wp', function () {
    if (!mc_is_mc_front()) return;
    foreach ([['wp_head', 'wp_generator', 10], ['wp_head', 'rsd_link', 10], ['wp_head', 'wlwmanifest_link', 10], ['wp_head', 'wp_shortlink_wp_head', 10],
        ['wp_head', 'rest_output_link_wp_head', 10], ['wp_head', 'wp_oembed_add_discovery_links', 10], ['wp_head', 'feed_links', 2],
        ['wp_head', 'feed_links_extra', 3], ['template_redirect', 'rest_output_link_header', 11], ['template_redirect', 'wp_shortlink_header', 11]] as $a)
        remove_action($a[0], $a[1], $a[2]);
}, 1);
// Styles et scripts des extensions (Contact Form 7, Elementor, polices Google…) : retirés, sauf si le client a ajouté
// des éléments Elementor ordinaires à la page (ils gardent alors ce dont ils ont besoin)
function mc_dequeue_all() {
    if (!mc_is_mc_front()) return;
    $native = mc_page_has_native(get_queried_object_id());
    global $wp_styles, $wp_scripts;
    if ($wp_styles) foreach ((array) $wp_styles->queue as $h) {
        if (in_array($h, ['admin-bar', 'dashicons'], true)) continue;
        if ($native && preg_match('/^(elementor|e-|swiper|font-awesome|fa-|eicons)/', $h)) continue;
        wp_dequeue_style($h);
    }
    if ($wp_scripts) foreach ((array) $wp_scripts->queue as $h) {
        if (in_array($h, ['admin-bar'], true)) continue;
        if ($native && preg_match('/^(elementor|e-|swiper|jquery|wp-)/', $h)) continue;
        wp_dequeue_script($h);
    }
}
add_action('wp_enqueue_scripts', 'mc_dequeue_all', PHP_INT_MAX);
add_action('wp_print_styles', 'mc_dequeue_all', 1);
add_action('wp_print_scripts', 'mc_dequeue_all', 1);
// Polices de l'ancien site chargées chez Google : jamais sur nos pages (vitesse, et loi RGPD : aucune adresse IP envoyée à Google)
add_filter('elementor/frontend/print_google_fonts', function ($v) { return mc_is_mc_front() ? false : $v; });
add_filter('style_loader_src', function ($src) {
    return (strpos((string) $src, 'fonts.googleapis.com') !== false && mc_is_mc_front()) ? false : $src;
}, 99);
// Balises <script> et <style> sans l'attribut « type » inutile (code HTML valide W3C)
add_action('after_setup_theme', function () { add_theme_support('html5', ['script', 'style']); });

/* ---------- Référencement : FAQ pour Google construite à partir de la FAQ réellement affichée ---------- */
// (si le garage modifie, ajoute ou retire une question dans Elementor, Google reçoit exactement la même chose)
function mc_faq_jsonld($html) {
    if (!preg_match('~<section\b[^>]*\bid="faq"[\s\S]*?</section>~', $html, $sec)) return '';
    preg_match_all('~<details\b[^>]*>\s*<summary\b[^>]*>([\s\S]*?)</summary>([\s\S]*?)</details>~', $sec[0], $m, PREG_SET_ORDER);
    $items = [];
    foreach ($m as $d) {
        $q = trim(preg_replace('/\s+/u', ' ', html_entity_decode(wp_strip_all_tags($d[1]), ENT_QUOTES, 'UTF-8')));
        $a = preg_replace('~<a\b[^>]*>[\s\S]*?</a>~', '', $d[2]); // liens « Prendre rendez-vous »… : pas dans la réponse
        $a = trim(preg_replace('/\s+/u', ' ', html_entity_decode(wp_strip_all_tags($a), ENT_QUOTES, 'UTF-8')));
        if ($q !== '' && $a !== '') $items[] = ['@type' => 'Question', 'name' => $q, 'acceptedAnswer' => ['@type' => 'Answer', 'text' => $a]];
    }
    if (!$items) return '';
    return '<script type="application/ld+json">' . wp_json_encode(['@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => $items], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '</script>';
}
function mc_head_without_faq($head) {
    $head = preg_replace('~[ \t]*<!-- FAQ structurée[^\n]*-->\n?~', '', $head);
    return preg_replace('~[ \t]*<script type="application/ld\+json">(?:(?!</script>)[\s\S])*?"FAQPage"[\s\S]*?</script>\n?~', '', $head);
}
