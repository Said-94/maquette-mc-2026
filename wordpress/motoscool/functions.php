<?php
/**
 * Thème Moto's Cool : affiche le site Moto's Cool (dossier site/) tel quel, à la racine du domaine,
 * et gère les demandes de rendez-vous dans WordPress (email à l'accueil, 3 clients max par créneau,
 * lien « Libérer la place »). Réglages : Réglages › Moto's Cool RDV.
 */
if (!defined('ABSPATH')) exit;

define('MC_DIR', __DIR__ . '/site');
define('MC_DB_VERSION', '1');

/* ---------- Installation ---------- */
function mc_table() { global $wpdb; return $wpdb->prefix . 'mc_resa'; }
function mc_install() {
    global $wpdb;
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    $t = mc_table(); $cs = $wpdb->get_charset_collate();
    dbDelta("CREATE TABLE $t (
  id char(36) NOT NULL,
  jour char(10) NOT NULL,
  heure char(5) NOT NULL,
  cree bigint(20) NOT NULL,
  libere tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY  (id),
  KEY creneau (jour,heure,libere)
) $cs;");
    if (!get_option('mc_sign_key')) update_option('mc_sign_key', wp_generate_password(48, false, false), false);
    if (!get_option('mc_to_email')) update_option('mc_to_email', 'contact@motoscool.fr', false);
    if (!get_option('mc_capacite')) update_option('mc_capacite', 3, false);
    update_option('mc_db_version', MC_DB_VERSION, false);
    // Les liens « jolis » sont nécessaires pour les adresses du site (/services/…, /mc-rdv) :
    // le réglage ET l'objet des réécritures sont mis à jour, puis le fichier .htaccess est réécrit
    global $wp_rewrite;
    if (!get_option('permalink_structure') && $wp_rewrite) $wp_rewrite->set_permalink_structure('/%postname%/');
    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/misc.php'; // save_mod_rewrite_rules(), absent hors administration
    flush_rewrite_rules(true);
}
add_action('after_switch_theme', 'mc_install');
add_action('init', function () { if (get_option('mc_db_version') !== MC_DB_VERSION) mc_install(); }, 1);

// Apache (OVH) : images et vidéos servies directement depuis le thème, sans passer par PHP
add_filter('mod_rewrite_rules', function ($rules) {
    // Seulement pour une installation classique (site à la racine du domaine) ; sinon PHP sert les fichiers
    if (!function_exists('get_home_path')) return $rules;
    $home = trailingslashit(wp_normalize_path(get_home_path()));
    $dir = wp_normalize_path(MC_DIR);
    if (strpos($dir, $home) !== 0 || rtrim((string) wp_parse_url(home_url('/'), PHP_URL_PATH), '/') !== '' || preg_match('/[\s"]/', $dir)) return $rules;
    $rel = substr($dir, strlen($home));
    $add = "# BEGIN Moto's Cool\n<IfModule mod_rewrite.c>\nRewriteEngine On\nRewriteCond " . $dir . '/assets/$1 -f' . "\nRewriteRule ^assets/(.+)$ " . $rel . '/assets/$1 [L]' . "\n</IfModule>\n# END Moto's Cool\n";
    return $add . $rules;
});

// Référencement : plan du site Moto's Cool (sitemap.xml) au lieu de celui de WordPress
add_filter('wp_sitemaps_enabled', '__return_false');
add_filter('robots_txt', function ($out) {
    $out = preg_replace('/^Sitemap:.*$/mi', '', (string) $out);
    return rtrim($out) . "\nSitemap: " . home_url('/sitemap.xml') . "\n";
}, 99);

/* ---------- Réglages ---------- */
add_action('admin_menu', function () {
    add_options_page("Moto's Cool RDV", "Moto's Cool RDV", 'manage_options', 'mc-rdv', 'mc_settings_page');
});
add_action('admin_init', function () {
    register_setting('mc_rdv', 'mc_to_email', ['sanitize_callback' => 'sanitize_email']);
    register_setting('mc_rdv', 'mc_from_email', ['sanitize_callback' => 'sanitize_email']);
    register_setting('mc_rdv', 'mc_capacite', ['sanitize_callback' => function ($v) { return max(1, min(20, (int) $v)); }]);
});
function mc_settings_page() { ?>
<div class="wrap"><h1>Moto's Cool : demandes de rendez-vous</h1>
<form method="post" action="options.php"><?php settings_fields('mc_rdv'); ?>
<table class="form-table">
<tr><th>Email de l'accueil (reçoit les demandes)</th><td><input type="email" class="regular-text" name="mc_to_email" value="<?php echo esc_attr(get_option('mc_to_email')); ?>"></td></tr>
<tr><th>Expéditeur (facultatif)</th><td><input type="email" class="regular-text" name="mc_from_email" value="<?php echo esc_attr(get_option('mc_from_email')); ?>" placeholder="rdv@<?php echo esc_attr(wp_parse_url(home_url(), PHP_URL_HOST)); ?>"><p class="description">Une adresse du domaine du site. Vide : rdv@ + le domaine.</p></td></tr>
<tr><th>Clients maximum par créneau</th><td><input type="number" min="1" max="20" name="mc_capacite" value="<?php echo (int) get_option('mc_capacite', 3); ?>"></td></tr>
</table><?php submit_button(); ?></form>
<form method="post"><?php wp_nonce_field('mc_test'); ?><input type="hidden" name="mc_test" value="1"><?php submit_button("Envoyer un email de test à l'accueil", 'secondary'); ?></form>
<?php if (!empty($_POST['mc_test']) && check_admin_referer('mc_test')) {
    $ok = wp_mail(get_option('mc_to_email'), "Test Moto's Cool", "Si vous lisez ce message, les demandes de rendez-vous du site arriveront bien ici.", mc_headers(null));
    echo $ok ? '<div class="notice notice-success"><p>Email de test envoyé. Vérifiez la boîte (et les indésirables).</p></div>' : '<div class="notice notice-error"><p>L\'envoi a échoué : installez l\'extension « WP Mail SMTP » et reliez-la à la boîte email du garage.</p></div>';
} ?></div>
<?php }

/* ---------- Affichage du site ---------- */
function mc_types() {
    return ['html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'json' => 'application/json', 'webmanifest' => 'application/manifest+json',
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp', 'avif' => 'image/avif', 'svg' => 'image/svg+xml', 'ico' => 'image/x-icon', 'gif' => 'image/gif',
        'mp4' => 'video/mp4', 'webm' => 'video/webm', 'woff2' => 'font/woff2', 'woff' => 'font/woff', 'glb' => 'model/gltf-binary', 'txt' => 'text/plain; charset=utf-8', 'xml' => 'application/xml'];
}
// Chemin demandé, relatif à l'adresse du site WordPress
function mc_path() {
    $p = rawurldecode((string) wp_parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH));
    $base = rtrim((string) wp_parse_url(home_url('/'), PHP_URL_PATH), '/');
    if ($base !== '' && strpos($p, $base) === 0) $p = substr($p, strlen($base));
    return '/' . ltrim($p, '/');
}
function mc_file($p) {
    if ($p === '/' || $p === '') $p = '/index.html';
    if (strpos($p, "\0") !== false || preg_match('#(^|/)\.#', $p)) return null; // pas de fichiers cachés ni de « .. »
    $f = realpath(MC_DIR . $p);
    $root = realpath(MC_DIR);
    if (!$f || strpos($f, $root . DIRECTORY_SEPARATOR) !== 0 || !is_file($f)) return null;
    $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
    return isset(mc_types()[$ext]) ? $f : null;
}
// Réponse envoyée telle quelle : aucune extension de cache ou d'optimisation (WP Rocket, W3TC, Autoptimize…)
// ne la réécrit, sinon les empreintes de sécurité des scripts ne correspondraient plus
function mc_raw() {
    foreach (['DONOTCACHEPAGE', 'DONOTROCKETOPTIMIZE', 'DONOTMINIFY', 'DONOTCDN'] as $c) if (!defined($c)) define($c, true);
    while (ob_get_level() > 0 && @ob_end_clean()) {}
}
function mc_send_static($f) {
    mc_raw();
    $ext = strtolower(pathinfo($f, PATHINFO_EXTENSION));
    $size = filesize($f); $start = 0; $end = $size - 1;
    status_header(200);
    header('Content-Type: ' . mc_types()[$ext]);
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: public, max-age=604800');
    header('Accept-Ranges: bytes');
    // Lecture par morceaux (vidéos sur iPhone)
    if (!empty($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', $_SERVER['HTTP_RANGE'], $m)) {
        if ($m[1] === '' && $m[2] !== '') { $start = max(0, $size - (int) $m[2]); }
        else { $start = (int) $m[1]; if ($m[2] !== '') $end = min($end, (int) $m[2]); }
        if ($start > $end || $start >= $size) { status_header(416); header("Content-Range: bytes */$size"); exit; }
        status_header(206); header("Content-Range: bytes $start-$end/$size");
    }
    header('Content-Length: ' . ($end - $start + 1));
    if ($_SERVER['REQUEST_METHOD'] === 'HEAD') exit;
    $h = fopen($f, 'rb'); fseek($h, $start); $left = $end - $start + 1;
    while ($left > 0 && !feof($h)) { $chunk = fread($h, min(65536, $left)); echo $chunk; $left -= strlen($chunk); flush(); }
    fclose($h); exit;
}
function mc_send_page($f) {
    mc_raw();
    $html = file_get_contents($f);
    // Adresse du service de rendez-vous : ce WordPress
    $html = str_replace("bookingEndpoint: ''", "bookingEndpoint: '" . esc_js((string) wp_parse_url(home_url('/mc-rdv'), PHP_URL_PATH)) . "'", $html);
    // Site réel : visible par Google
    $html = preg_replace('#<meta name="robots" content="[^"]*noindex[^"]*">\s*#i', '', $html);
    // Empreintes de sécurité (CSP) recalculées pour les scripts intégrés
    if (preg_match('/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/', $html, $csp)) {
        preg_match_all('#<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>#', $html, $m);
        $hashes = [];
        // Le navigateur calcule l'empreinte après avoir ramené les fins de ligne Windows (CRLF) à LF : même calcul ici
        foreach ($m[1] as $i => $body) { if (preg_match('#type="application/ld\+json"#', $m[0][$i])) continue; $hashes[] = "'sha256-" . base64_encode(hash('sha256', str_replace(["\r\n", "\r"], "\n", $body), true)) . "'"; }
        $new = preg_replace("/'sha256-[A-Za-z0-9+\/=]+'\s*/", '', $csp[1]);
        $new = preg_replace('/script-src /', 'script-src ' . implode(' ', $hashes) . ' ', $new, 1);
        // Le service de rendez-vous est ce WordPress : plus besoin d'autoriser les services Cloudflare Workers
        $new = str_replace(' https://*.workers.dev', '', $new);
        // Page ouverte en http:// : sans cette règle, l'envoi au service de rendez-vous partirait en https (autre origine) et échouerait
        if (!is_ssl()) $new = preg_replace('/\s*upgrade-insecure-requests;?/', '', $new);
        $html = str_replace($csp[0], '<meta http-equiv="Content-Security-Policy" content="' . $new . '"', $html);
    }
    status_header(200);
    header('Content-Type: text/html; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('X-Frame-Options: SAMEORIGIN');
    header('Cache-Control: no-cache');
    echo $html; exit;
}

// Prioritaire sur WordPress : les adresses du site Moto's Cool sont servies avant toute page WordPress
add_action('parse_request', function () {
    if (is_admin() || isset($_GET['rest_route'])) return; // API WordPress (éditeur, extensions) : non touchée
    $p = mc_path();
    if ($p === '/sitemap.xml' && is_file(MC_DIR . '/sitemap.xml')) {
        mc_raw(); status_header(200); header('Content-Type: application/xml; charset=utf-8'); header('X-Content-Type-Options: nosniff');
        echo str_replace('https://motoscool.fr/', esc_url(home_url('/')), file_get_contents(MC_DIR . '/sitemap.xml')); exit;
    }
    if (strpos($p, '/mc-rdv') === 0) { mc_api(substr($p, 7)); exit; }
    $f = mc_file($p);
    if (!$f && substr($p, -1) === '/') $f = mc_file($p . 'index.html');
    if (!$f && !preg_match('/\.[a-z0-9]+$/i', $p)) {
        $f = mc_file(rtrim($p, '/') . '.html'); // /services/depannage → .html
        // /services/depannage/ : redirigée, sinon ses liens relatifs (../assets/…) pointeraient vers /services/assets/…
        if ($f && $p !== '/' && substr($p, -1) === '/') { wp_safe_redirect(home_url(rtrim($p, '/') . '.html'), 301); exit; }
    }
    if (!$f && strpos($p, '/assets/') === 0) { mc_raw(); status_header(404); nocache_headers(); header('Content-Type: text/plain; charset=utf-8'); echo 'Introuvable'; exit; } // fichier du site absent
    if (!$f) return;
    if (substr($f, -5) === '.html') mc_send_page($f);
    mc_send_static($f);
}, 0);
// Toute autre adresse → accueil Moto's Cool (robots.txt et flux gérés par WordPress)
add_action('template_redirect', function () {
    if (is_robots() || is_feed() || is_trackback() || (function_exists('is_favicon') && is_favicon())) return;
    if (is_404()) {
        wp_redirect_admin_locations(); // /admin, /login, /dashboard → administration, comme WordPress
        if (preg_match('/\.[a-z0-9]{2,5}$/i', mc_path())) { mc_raw(); status_header(404); nocache_headers(); header('Content-Type: text/plain; charset=utf-8'); echo 'Introuvable'; exit; } // fichier absent : vraie erreur 404
        wp_safe_redirect(home_url('/'), 302); exit;
    }
    // Anciennes pages WordPress (/contact/, articles, catégories…) : redirigées vers l'accueil,
    // dont les liens relatifs (assets/…) ne fonctionnent qu'à la racine du site
    if (!in_array(mc_path(), ['/', '/index.php'], true)) { wp_safe_redirect(home_url('/'), 301); exit; }
    mc_send_page(MC_DIR . '/index.html');
}, 99);

/* ---------- Demandes de rendez-vous ---------- */
const MC_DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
function mc_date_fr($iso) { return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', (string) $iso, $m) ? "$m[3]/$m[2]/$m[1]" : ''; }
function mc_day_fr($iso) { return preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', (string) $iso, $m) ? MC_DAYS[(int) gmdate('w', gmmktime(0, 0, 0, (int) $m[2], (int) $m[3], (int) $m[1]))] : ''; }
function mc_hour_fr($h) { return preg_match('/^\d{2}:\d{2}$/', (string) $h) ? ((int) substr($h, 0, 2)) . ':' . substr($h, 3) : ''; }
function mc_norm_tel($s) { $s = preg_replace('/[\s.\-()\/]/u', '', (string) $s); $s = preg_replace('/^00/', '+', $s); return preg_replace('/^\+330/', '+33', $s); }
function mc_tel_ok($s) { return (bool) preg_match('/^(?:0[1-9]\d{8}|\+33[1-9]\d{8}|\+(?!33)[1-9]\d{6,14})$/', mc_norm_tel($s)); }
function mc_str($v, $max) { if (!is_string($v)) return ''; $v = preg_replace('/[\x{0000}-\x{001f}\x{007f}\x{2028}\x{2029}]/u', ' ', $v); $v = trim(preg_replace('/\s{2,}/u', ' ', $v)); return mb_substr($v, 0, $max); }
function mc_txt($v, $max) { if (!is_string($v)) return ''; return mb_substr(trim(preg_replace('/[\x{0000}-\x{0009}\x{000b}\x{000c}\x{000e}-\x{001f}\x{007f}]/u', '', $v)), 0, $max); }
function mc_int($v, $min, $max) { return is_int($v) && $v >= $min && $v <= $max ? $v : null; }
function mc_num($v, $min, $max) { return (is_int($v) || is_float($v)) && is_finite($v) && $v >= $min && $v <= $max ? $v : null; }
function mc_sign($data) { return rtrim(strtr(base64_encode(hash_hmac('sha256', $data, get_option('mc_sign_key'), true)), '+/', '-_'), '='); }

function mc_clean($b) {
    if (!is_array($b)) return null;
    $v = $b['vehicule'] ?? null; $r = $b['rdv'] ?? null; $c = $b['contact'] ?? null;
    if (!is_array($v) || !is_array($r) || !is_array($c)) return null;
    $pos = isset($r['position']) && is_array($r['position']) ? $r['position'] : null;
    $lat = $pos ? mc_num($pos['lat'] ?? null, 41, 52) : null; $lng = $pos ? mc_num($pos['lng'] ?? null, -6, 10) : null;
    $p = [
        'vehicule' => ['type' => mc_str($v['type'] ?? '', 20), 'immatriculation' => mb_strtoupper(mc_str($v['immatriculation'] ?? '', 12)), 'marque' => mc_str($v['marque'] ?? '', 40), 'modele' => mc_str($v['modele'] ?? '', 60),
            'cylindree' => mc_int($v['cylindree'] ?? null, 49, 3000), 'annee' => mc_int($v['annee'] ?? null, 1950, 2100), 'kilometrage' => mc_int($v['kilometrage'] ?? null, 0, 999999),
            'intervention' => mc_str($v['intervention'] ?? '', 40), 'interventionLabel' => mc_str($v['interventionLabel'] ?? '', 60)],
        'rdv' => ['lieu' => ($r['lieu'] ?? '') === 'Dépannage à domicile' ? 'Dépannage à domicile' : "A l'atelier", 'adresse' => mc_str($r['adresse'] ?? '', 200), 'date' => mc_str($r['date'] ?? '', 10), 'heure' => mc_str($r['heure'] ?? '', 5),
            'position' => ($lat !== null && $lng !== null) ? ['lat' => round($lat, 6), 'lng' => round($lng, 6), 'accuracy' => min(100000, max(0, (int) round((float) ($pos['accuracy'] ?? 0))))] : null],
        'contact' => ['nom' => mc_str($c['nom'] ?? '', 80), 'telephone' => mc_str($c['telephone'] ?? '', 30), 'email' => mc_str($c['email'] ?? '', 120)],
        'message' => mc_txt($b['message'] ?? '', 1000),
        'id' => (isset($b['id']) && is_string($b['id']) && preg_match('/^[0-9a-f-]{36}$/i', $b['id'])) ? strtolower($b['id']) : null,
    ];
    $dOk = false;
    if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $p['rdv']['date'], $d) && checkdate((int) $d[2], (int) $d[3], (int) $d[1])) {
        $t = gmmktime(0, 0, 0, (int) $d[2], (int) $d[3], (int) $d[1]); $today = gmmktime(0, 0, 0, (int) gmdate('n'), (int) gmdate('j'), (int) gmdate('Y'));
        $dOk = $t >= $today - 86400 && $t <= $today + 366 * 86400 && gmdate('w', $t) !== '0';
    }
    $hOk = preg_match('/^(\d{2}):(\d{2})$/', $p['rdv']['heure'], $h) && (int) $h[1] >= 8 && (int) $h[1] <= 19 && ($h[2] === '00' || $h[2] === '30');
    $ok = $p['vehicule']['immatriculation'] !== '' && $p['vehicule']['marque'] !== '' && $p['vehicule']['modele'] !== '' && $p['vehicule']['intervention'] !== ''
        && $dOk && $hOk && $p['contact']['nom'] !== '' && mc_tel_ok($p['contact']['telephone'])
        && preg_match('/^[^\s@<>()",;:\\\\]+@[^\s@<>()",;:\\\\]+\.[a-z]{2,}$/i', $p['contact']['email'])
        && ($p['rdv']['lieu'] === "A l'atelier" || $p['rdv']['adresse'] !== '');
    return $ok ? $p : null;
}
function mc_mail_text($p) {
    $ve = $p['vehicule']; $r = $p['rdv']; $c = $p['contact'];
    $l = ["🏍️ NOUVELLE DEMANDE DE RDV — Moto's Cool", '', '— VÉHICULE —',
        'Type : ' . $ve['type'], 'Immatriculation : ' . $ve['immatriculation'], 'Marque / Modèle : ' . trim($ve['marque'] . ' ' . $ve['modele']),
        'Cylindrée : ' . ($ve['cylindree'] ? $ve['cylindree'] . 'cc' : ''), 'Année : ' . ($ve['annee'] ?? ''), 'Kilométrage : ' . ($ve['kilometrage'] !== null ? $ve['kilometrage'] . ' km' : ''),
        'Intervention : ' . ($ve['interventionLabel'] ?: $ve['intervention']), '', '— RENDEZ-VOUS —', 'Lieu : ' . $r['lieu'], 'Adresse : ' . $r['adresse']];
    if ($r['position']) $l[] = 'Position GPS : https://maps.google.com/?q=' . $r['position']['lat'] . ',' . $r['position']['lng'] . ' (précision ± ' . $r['position']['accuracy'] . ' m)';
    array_push($l, 'Date : ' . mc_day_fr($r['date']) . ' ' . mc_date_fr($r['date']), 'Heure : ' . mc_hour_fr($r['heure']), '', '— CONTACT —',
        'Nom : ' . $c['nom'], 'Téléphone : ' . $c['telephone'], 'Email : ' . $c['email'], '', 'Message :', $p['message']);
    return implode("\n", $l);
}
function mc_headers($p) {
    $from = get_option('mc_from_email') ?: 'rdv@' . preg_replace('/^www\./', '', (string) wp_parse_url(home_url(), PHP_URL_HOST));
    $h = ['Content-Type: text/html; charset=UTF-8', "From: Moto's Cool <$from>"];
    if ($p) $h[] = 'Reply-To: ' . str_replace(['"', "\r", "\n"], '', $p['contact']['nom']) . ' <' . $p['contact']['email'] . '>';
    return $h;
}
function mc_json($status, $body, $extra = []) {
    mc_raw(); status_header($status); nocache_headers();
    header('Content-Type: application/json; charset=utf-8'); header('X-Content-Type-Options: nosniff');
    foreach ($extra as $k => $v) header("$k: $v");
    echo wp_json_encode($body); exit;
}
function mc_ip() { return preg_replace('/[^0-9a-f:.]/i', '', (string) ($_SERVER['REMOTE_ADDR'] ?? '?')); }
// Compteur dans le cache WordPress : renvoie true si la limite est atteinte.
// Lecture et écriture sous verrou : des envois simultanés ne passent pas tous à travers la limite.
function mc_limited($key, $limit, $window) {
    global $wpdb;
    $lk = "'" . esc_sql(mc_table()) . "_rl'";
    $got = $wpdb->get_var("SELECT GET_LOCK($lk, 5)");
    $k = 'mc_l_' . md5($key);
    $list = array_filter((array) get_transient($k), function ($t) use ($window) { return time() - $t < $window; });
    $hit = count($list) >= $limit;
    if (!$hit) { $list[] = time(); set_transient($k, array_values($list), $window); }
    if ($got) $wpdb->query("SELECT RELEASE_LOCK($lk)");
    return $hit;
}
function mc_full_slots() {
    global $wpdb; $t = mc_table();
    $rows = $wpdb->get_results($wpdb->prepare("SELECT jour, heure FROM $t WHERE libere = 0 AND jour >= %s GROUP BY jour, heure HAVING COUNT(*) >= %d", gmdate('Y-m-d'), (int) get_option('mc_capacite', 3)));
    return array_map(function ($r) { return $r->jour . ' ' . $r->heure; }, (array) $rows);
}
function mc_page($title, $body) {
    mc_raw(); status_header(200); nocache_headers();
    header('Content-Type: text/html; charset=utf-8'); header('X-Robots-Tag: noindex'); header('Referrer-Policy: no-referrer');
    echo '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' . esc_html($title) . '</title><style>body{font-family:Arial,sans-serif;background:#2b2b31;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;padding:20px;box-sizing:border-box}main{max-width:460px;text-align:center}h1{font-size:1.4rem}p{color:#cfcfd6;line-height:1.5}button{font:inherit;font-weight:700;background:#d92b22;color:#fff;border:0;border-radius:999px;padding:14px 26px;cursor:pointer}</style></head><body><main><h1>' . esc_html($title) . '</h1>' . $body . '</main></body></html>';
    exit;
}
function mc_release() {
    global $wpdb; $t = mc_table();
    $id = (string) ($_REQUEST['id'] ?? ''); $s = (string) ($_REQUEST['s'] ?? '');
    if (!preg_match('/^[0-9a-f-]{36}$/', $id) || !hash_equals(mc_sign('liberer.' . $id), $s)) mc_page('Lien invalide', '<p>Ce lien est incorrect ou incomplet.</p>');
    $row = $wpdb->get_row($wpdb->prepare("SELECT jour, heure, libere FROM $t WHERE id = %s", $id));
    if (!$row) mc_page('Rendez-vous introuvable', '<p>Ce rendez-vous est trop ancien ou n\'existe plus.</p>');
    $when = 'le ' . mc_date_fr($row->jour) . ' à ' . mc_hour_fr($row->heure);
    if ((int) $row->libere) mc_page('Place déjà libérée', '<p>La place du créneau ' . esc_html($when) . ' est déjà libre.</p>');
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') mc_page('Libérer ce créneau ?', '<p>Le client a annulé ou déplacé son rendez-vous ' . esc_html($when) . ' ?<br>Libérez sa place pour qu\'un autre client puisse la réserver sur le site.</p><form method="post"><input type="hidden" name="id" value="' . esc_attr($id) . '"><input type="hidden" name="s" value="' . esc_attr($s) . '"><button type="submit">Libérer la place</button></form>');
    $wpdb->update($t, ['libere' => 1], ['id' => $id]);
    mc_page('Place libérée', '<p>Le créneau ' . esc_html($when) . ' a de nouveau une place disponible sur le site.</p>');
}
function mc_api($sub) {
    global $wpdb; $t = mc_table();
    $sub = rtrim($sub, '/');
    if ($sub === '/liberer') mc_release();
    $m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($sub === '/creneaux' && $m === 'GET') mc_json(200, ['ok' => true, 'complets' => mc_full_slots()]);
    if ($sub !== '' || $m !== 'POST') mc_json(405, ['ok' => false], ['Allow' => 'GET, POST']);
    // Même site seulement
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    $host = wp_parse_url(home_url(), PHP_URL_HOST);
    if ($origin !== '' && preg_replace('/^www\./', '', (string) wp_parse_url($origin, PHP_URL_HOST)) !== preg_replace('/^www\./', '', (string) $host)) mc_json(403, ['ok' => false]);
    if (!preg_match('#^application/json\b#i', $_SERVER['CONTENT_TYPE'] ?? '')) mc_json(415, ['ok' => false]);
    $raw = file_get_contents('php://input', false, null, 0, 12001);
    if ($raw === false || strlen($raw) > 12000) mc_json(413, ['ok' => false]);
    $body = json_decode($raw, true);
    if (!is_array($body)) mc_json(400, ['ok' => false]);
    // Robot (champ piège rempli ou formulaire rempli trop vite) : réponse normale, rien n'est envoyé
    if (mc_str($body['site_web'] ?? '', 200) !== '' || !((is_int($body['duree'] ?? null) || is_float($body['duree'] ?? null)) && $body['duree'] >= 4)) mc_json(200, ['ok' => true]);
    $p = mc_clean($body);
    if (!$p) mc_json(422, ['ok' => false]);
    if (mc_limited('ip' . mc_ip(), 5, 600)) mc_json(429, ['ok' => false], ['Retry-After' => '600']);
    if (mc_limited('global', 60, 3600)) mc_json(429, ['ok' => false], ['Retry-After' => '3600']);

    // Même demande encore en cours d'envoi (nouvel essai après une coupure) : on attend qu'elle se termine
    // (verrou rendu automatiquement à la fin de la requête), pour répondre selon son vrai résultat
    if ($p['id'] && $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 8)', 'mc_rdv_' . $p['id'])) === '0') mc_json(503, ['ok' => false]);
    // Même demande renvoyée (coupure réseau) : déjà reçue et envoyée
    if ($p['id'] && $wpdb->get_var($wpdb->prepare("SELECT 1 FROM $t WHERE id = %s", $p['id']))) mc_json(200, ['ok' => true]);
    $wpdb->query($wpdb->prepare("DELETE FROM $t WHERE jour < %s", gmdate('Y-m-d', time() - 2 * 86400)));
    $seat = $p['id'] ?: wp_generate_uuid4();
    $cap = (int) get_option('mc_capacite', 3);
    // Verrou : deux clients au même instant ne prennent pas la même dernière place
    $lock = $wpdb->get_var("SELECT GET_LOCK('" . esc_sql($t) . "_lock', 10)");
    $n = (int) $wpdb->get_var($wpdb->prepare("SELECT COUNT(*) FROM $t WHERE jour = %s AND heure = %s AND libere = 0", $p['rdv']['date'], $p['rdv']['heure']));
    $took = $n < $cap && $wpdb->insert($t, ['id' => $seat, 'jour' => $p['rdv']['date'], 'heure' => $p['rdv']['heure'], 'cree' => time(), 'libere' => 0]);
    if ($lock) $wpdb->query("SELECT RELEASE_LOCK('" . esc_sql($t) . "_lock')");
    if (!$took) {
        if ($p['id'] && $wpdb->get_var($wpdb->prepare("SELECT 1 FROM $t WHERE id = %s", $p['id']))) mc_json(200, ['ok' => true]);
        if ($n >= $cap) mc_json(409, ['ok' => false, 'complet' => true]);
        mc_json(503, ['ok' => false]);
    }
    $link = home_url('/mc-rdv/liberer') . '?id=' . $seat . '&s=' . mc_sign('liberer.' . $seat);
    $text = mc_mail_text($p);
    $html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#1d1d1f">' . nl2br(esc_html($text), false) . '</div>'
        . '<p style="font-family:Arial,sans-serif;font-size:14px;color:#555;margin-top:22px">Rendez-vous annulé ou déplacé ?</p><p><a href="' . esc_url($link) . '" style="display:inline-block;background:#d92b22;color:#fff;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;padding:12px 22px;border-radius:999px">Libérer la place de ce créneau</a></p>';
    $subject = '🏍️ NOUVELLE DEMANDE DE RDV — ' . mc_day_fr($p['rdv']['date']) . ' ' . mc_date_fr($p['rdv']['date']) . ' à ' . mc_hour_fr($p['rdv']['heure']) . ' — ' . $p['contact']['nom'];
    $alt = function ($phpmailer) use ($text, $link) { $phpmailer->AltBody = $text . "\n\n—\nRendez-vous annulé ou déplacé ? Libérez la place sur le site : " . $link; };
    add_action('phpmailer_init', $alt);
    $sent = wp_mail(get_option('mc_to_email', 'contact@motoscool.fr'), $subject, $html, mc_headers($p));
    remove_action('phpmailer_init', $alt);
    if (!$sent) { $wpdb->delete($t, ['id' => $seat]); mc_json(502, ['ok' => false]); }
    mc_json(200, ['ok' => true]);
}
