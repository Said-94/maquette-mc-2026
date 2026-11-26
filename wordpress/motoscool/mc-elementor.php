<?php
/**
 * Site Moto's Cool modifiable dans WordPress avec Elementor.
 * - Chaque page du site est une page WordPress (« Moto's Cool – … ») construite avec des blocs Moto's Cool :
 *   textes, liens et photos modifiables, listes où l'on ajoute / retire des éléments, et mode « Code HTML ».
 * - En-têtes et pieds de page : Modèles Elementor (une seule modification pour toutes les pages).
 * - Référencement : champs Rank Math pré-remplis.
 * - Les anciennes pages du site ne sont ni modifiées ni supprimées (leurs adresses mènent à l'accueil).
 * Sans Elementor, le site s'affiche tel quel (pages fixes), comme avant.
 */
if (!defined('ABSPATH')) exit;

define('MC_DATA', __DIR__ . '/mc');
define('MC_PAGES_VER', '2'); // 2 : version optimisée (vitesse, référencement, vidéos) — remplace nos pages de la version 1

/* ---------- Données générées (wordpress/tools/build-elementor.mjs) ---------- */
function mc_data($name) {
    static $c = [];
    if (!array_key_exists($name, $c)) { $j = json_decode((string) @file_get_contents(MC_DATA . '/' . $name . '.json'), true); $c[$name] = is_array($j) ? $j : []; }
    return $c[$name];
}
function mc_page_data($key) { $i = mc_data('pages'); return isset($i[$key]) ? mc_data('pages/' . substr($i[$key]['file'], 0, -5)) : null; }
function mc_el_ok() { return did_action('elementor/loaded') && class_exists('\Elementor\Plugin'); }
function mc_ids() { $ids = get_option('mc_pages'); return is_array($ids) ? $ids : []; }
// Mode « pages modifiables » : Elementor actif et pages Moto's Cool créées
function mc_mode() {
    static $m = null;
    if ($m !== null) return $m;
    if (!did_action('plugins_loaded')) return false;
    $ids = mc_ids();
    return $m = mc_el_ok() && !empty($ids['accueil']) && get_post_status($ids['accueil']) === 'publish';
}
function mc_key_of($id) { $k = get_post_meta((int) $id, '_mc_key', true); return is_string($k) ? $k : ''; }
function mc_url_of_key($key) { return $key === 'accueil' ? '/' : '/' . $key . '.html'; }
function mc_key_for_path($p) {
    if (in_array($p, ['/', '/index.html', '/index.php'], true)) return 'accueil';
    $k = trim(preg_replace('/\.html$/', '', $p), '/');
    $i = mc_data('pages');
    return ($k !== 'accueil' && isset($i[$k])) ? $k : '';
}
function mc_is_editor_preview() {
    if (!is_user_logged_in() || !current_user_can('edit_posts')) return false;
    return isset($_GET['elementor-preview']) || (mc_el_ok() && isset(\Elementor\Plugin::$instance->preview) && \Elementor\Plugin::$instance->preview->is_preview_mode());
}
function mc_seo_plugin() { return defined('RANK_MATH_VERSION') || defined('WPSEO_VERSION'); }

/* ---------- Réglages modifiables du site (Réglages › Moto's Cool RDV) ---------- */
function mc_digits($s) { return preg_replace('/\D+/', '', (string) $s); }
function mc_wa_number() { $v = get_option('mc_whatsapp', null); if ($v === null || $v === false) return null; $d = mc_digits($v); if (strpos($d, '00') === 0) $d = substr($d, 2); if (preg_match('/^0[1-9]\d{8}$/', $d)) $d = '33' . substr($d, 1); return $d; }

// Adresses et réglages appliqués au HTML affiché
function mc_fix_html($html) {
    $home = home_url('/');
    $html = str_replace('https://motoscool.fr/', esc_url($home), $html);
    $base = rtrim((string) wp_parse_url($home, PHP_URL_PATH), '/');
    if ($base !== '') $html = preg_replace('#(\s(?:href|src|action|poster|data-src|data-poster)=")/(?!/)#', '$1' . $base . '/', $html);
    return mc_asset_versions($html);
}
// Fichiers du site (images, vidéos, polices, scripts, styles) appelés avec leur numéro de version : le navigateur les garde
// en mémoire 1 an, et une nouvelle version du site les remplace aussitôt (le numéro suit le contenu des fichiers)
function mc_asset_ver() {
    static $v = null;
    if ($v === null) { $m = dirname(MC_DIR) . '/site-files.json'; $v = is_file($m) ? substr(md5((string) @file_get_contents($m)), 0, 8) : '1'; }
    return $v;
}
function mc_asset_versions($html) {
    $v = mc_asset_ver();
    $html = preg_replace('#(\s(?:href|src|poster|data-src|data-poster)=["\'])((?:\.\./|/|[^"\'\s]*?/)?assets/[^"\'?\#\s]+\.(?:js|css|jpe?g|png|webp|avif|svg|mp4|webm|woff2|glb))(["\'])#i', '$1$2?v=' . $v . '$3', $html);
    $html = preg_replace('#(url\(\s*[\'"]?)((?:\.\./|/)?assets/[^)\'"?\s]+\.(?:woff2|jpe?g|png|webp|svg))([\'"]?\s*\))#i', '$1$2?v=' . $v . '$3', $html);
    // images citées dans les scripts (ex. image d'attente de la vidéo d'ouverture) : même adresse que dans la page
    $html = preg_replace('#(\'(?:\.\./|/)?assets/(?:video|photos)/[a-z0-9-]+\.(?:webp|jpe?g))(\')#i', '$1?v=' . $v . '$2', $html);
    return $html;
}
function mc_fix_scripts($html) {
    $html = str_replace("bookingEndpoint: ''", "bookingEndpoint: '" . esc_js((string) wp_parse_url(home_url('/mc-rdv'), PHP_URL_PATH)) . "'", $html);
    $wa = mc_wa_number();
    if ($wa !== null) $html = preg_replace("/whatsapp: '\\d*',/", "whatsapp: '" . $wa . "',", $html, 1);
    $sms = get_option('mc_sms', null);
    if ($sms !== null && $sms !== false) $html = preg_replace("/sms: '[\\d ]*',/", "sms: '" . mc_digits($sms) . "',", $html, 1);
    $avis = get_option('mc_avis_url', null);
    if ($avis !== null && $avis !== false) $html = preg_replace_callback("/googleReviewsUrl: '[^']*',/", function () use ($avis) { return 'googleReviewsUrl: ' . wp_json_encode(esc_url_raw($avis)) . ','; }, $html, 1);
    $tk = get_option('mc_tiktok', null);
    if ($tk !== null && $tk !== false) $html = str_replace("url: 'https://www.tiktok.com/@motos.cool'", 'url: ' . wp_json_encode(esc_url_raw($tk)), $html);
    return $html;
}

/* ---------- Contenu des blocs ---------- */
function mc_esc_field($f, $v) {
    switch ($f['t']) {
        case 'text': return esc_html(is_scalar($v) ? (string) $v : '');
        case 'attr': return esc_attr(is_scalar($v) ? (string) $v : '');
        case 'link': return is_scalar($v) && (string) $v !== '' ? esc_url((string) $v) : '';
        case 'media': $u = is_array($v) ? (isset($v['url']) ? $v['url'] : '') : $v; return is_scalar($u) && (string) $u !== '' ? esc_url((string) $u) : '';
        default: return is_scalar($v) ? (string) $v : ''; // texte avec mise en forme (saisi par l'administrateur)
    }
}
function mc_fill($tpl, $fields, $vals, $p) {
    $map = [];
    foreach ($fields as $f) {
        $v = (is_array($vals) && array_key_exists($f['k'], $vals)) ? $vals[$f['k']] : $f['d'];
        $map['{{' . $p . ':' . $f['k'] . '}}'] = mc_esc_field($f, $v);
    }
    return strtr($tpl, $map);
}
function mc_widget_html($name, $s) {
    $w = mc_data('widgets');
    if (!isset($w[$name])) return '';
    $d = $w[$name]; $s = is_array($s) ? $s : [];
    if (isset($s['mc_code_on']) && $s['mc_code_on'] === 'yes' && isset($s['mc_code']) && trim((string) $s['mc_code']) !== '') return (string) $s['mc_code'];
    if ($d['kind'] === 'texte') {
        $c = isset($s['contenu']) ? (string) $s['contenu'] : '';
        if (isset($s['enveloppe']) && $s['enveloppe'] === 'wrap') {
            $cls = isset($s['classe']) ? trim((string) $s['classe']) : '';
            return "<div class=\"wrap\">\n      <section" . ($cls !== '' ? ' class="' . esc_attr($cls) . '"' : '') . ">\n        " . $c . "\n      </section>\n    </div>";
        }
        return $c;
    }
    if ($d['kind'] === 'videos') return mc_videos_html($s);
    $out = $d['template'];
    foreach ($d['reps'] as $r) {
        $items = (isset($s[$r['k']]) && is_array($s[$r['k']])) ? $s[$r['k']] : (array_key_exists($r['k'], $s) ? [] : $r['def']);
        $parts = [];
        foreach ($items as $it) $parts[] = mc_fill($r['tpl'], $r['fields'], $it, 'mci');
        $out = str_replace('{{mcr:' . $r['k'] . '}}', implode($r['sep'], $parts), $out);
    }
    return mc_fill($out, $d['fields'], $s, 'mc');
}

/* ---------- Blocs dans Elementor ---------- */
add_action('elementor/elements/categories_registered', function ($m) {
    $m->add_category('motoscool', ['title' => "Moto's Cool", 'icon' => 'eicon-site-identity']);
});
add_action('elementor/widgets/register', function ($wm) {
    require_once __DIR__ . '/mc-widget.php';
    require_once MC_DATA . '/widgets-classes.php';
    foreach (array_keys(mc_data('widgets')) as $n) { $c = 'MC_W_' . $n; if (class_exists($c)) $wm->register(new $c()); }
});

/* ---------- Affichage des pages (en dehors de l'éditeur : HTML d'origine, sans enveloppes Elementor) ---------- */
function mc_is_ours($el) {
    if (($el['elType'] ?? '') === 'widget') return strpos((string) ($el['widgetType'] ?? ''), 'mc_') === 0;
    foreach (($el['elements'] ?? []) as $c) if (!mc_is_ours($c)) return false;
    return true;
}
function mc_collect($el, &$out) {
    if (($el['elType'] ?? '') === 'widget') { $out[] = $el; return; }
    foreach (($el['elements'] ?? []) as $c) mc_collect($c, $out);
}
function mc_render_el_data($post_id) {
    $data = get_post_meta($post_id, '_elementor_data', true);
    if (is_string($data)) $data = json_decode($data, true);
    if (!is_array($data)) return '';
    $out = []; $native = [];
    $flush = function () use (&$native, &$out, $post_id) { if ($native) { $out[] = mc_render_native($native, $post_id); $native = []; } };
    foreach ($data as $sec) {
        if (!is_array($sec)) continue;
        if (mc_is_ours($sec)) {
            $flush();
            $ws = []; mc_collect($sec, $ws);
            foreach ($ws as $w) $out[] = mc_widget_html((string) $w['widgetType'], isset($w['settings']) ? $w['settings'] : []);
        } else $native[] = $sec;
    }
    $flush();
    return implode("\n\n  ", $out);
}
// Sections ajoutées par le client avec les éléments ordinaires d'Elementor : rendues par Elementor
function mc_render_native($sections, $post_id) {
    if (!mc_el_ok()) return '';
    $pl = \Elementor\Plugin::$instance;
    ob_start();
    foreach ($sections as $sec) { $el = $pl->elements_manager->create_element_instance($sec); if ($el) $el->print_element(); }
    $h = ob_get_clean();
    if (class_exists('\Elementor\Core\Files\CSS\Post')) { $css = \Elementor\Core\Files\CSS\Post::create($post_id); $css->enqueue(); }
    $pl->frontend->enqueue_styles();
    $pl->frontend->enqueue_scripts();
    return '<div class="elementor elementor-' . (int) $post_id . '">' . $h . '</div>';
}
function mc_template_html($tk, $current_url) {
    $ids = mc_ids();
    $id = isset($ids['t:' . $tk]) ? (int) $ids['t:' . $tk] : 0;
    if ($id && get_post_status($id) === 'publish') $h = mc_render_el_data($id);
    else { $t = mc_data('templates'); $h = isset($t[$tk]) ? mc_widget_html($t[$tk]['widget'], $t[$tk]['settings']) : ''; }
    // lien « Vidéos » du menu : masqué tant qu'aucune vidéo n'est publiée (la partie Vidéos n'est alors pas affichée)
    if (strpos($h, 'href="#videos"') !== false && function_exists('mc_videos_list') && !mc_videos_count()) $h = preg_replace('~\s*<li>\s*<a href="#videos"[^>]*>[^<]*</a>\s*</li>~', '', $h);
    // lien de la page en cours
    return preg_replace('#(<a href="' . preg_quote($current_url, '#') . '")#', '$1 aria-current="page"', $h);
}

/* ---------- Adresses ---------- */
// /services/depannage.html → page « Moto's Cool – Dépannage moto »
add_action('parse_request', function ($wp) {
    if (is_admin() || isset($_GET['rest_route']) || !mc_mode() || !mc_ready()) return;
    // Adresses de WordPress qui visent un contenu précis (aperçu d'un modèle Elementor, recherche, article…) : laissées à WordPress
    foreach (['elementor_library', 'p', 'page_id', 'post_type', 'attachment_id', 's', 'feed', 'cat', 'tag', 'author', 'm', 'name', 'pagename', 'rest_route', 'sitemap'] as $q) if (isset($_GET[$q])) return;
    $p = mc_path();
    $k = mc_key_for_path($p);
    if ($k === '') { $k2 = mc_key_for_path(rtrim($p, '/') . '.html'); if ($k2 !== '' && $p !== '/') { wp_safe_redirect(home_url(mc_url_of_key($k2)) . (empty($_SERVER['QUERY_STRING']) ? '' : '?' . $_SERVER['QUERY_STRING']), 301); exit; } return; }
    $ids = mc_ids();
    if (empty($ids[$k]) || get_post_status($ids[$k]) !== 'publish') return;
    if ($p !== mc_url_of_key($k)) { wp_safe_redirect(home_url(mc_url_of_key($k)) . (empty($_SERVER['QUERY_STRING']) ? '' : '?' . $_SERVER['QUERY_STRING']), 301); exit; }
    $wp->query_vars = ['page_id' => (int) $ids[$k]];
    if (isset($_GET['preview'])) $wp->query_vars['preview'] = sanitize_text_field(wp_unslash($_GET['preview'])); // « Prévisualiser » de WordPress / Elementor
    $wp->matched_rule = '';
    $GLOBALS['mc_routed'] = true;
}, -1);
add_filter('page_link', function ($link, $id) {
    if (!mc_mode()) return $link;
    $k = mc_key_of($id);
    return $k !== '' ? home_url(mc_url_of_key($k)) : $link;
}, 10, 2);
// Accueil du site = page « Moto's Cool – Accueil » (réglage de WordPress non modifié : l'ancien revient avec l'ancien thème)
add_filter('pre_option_show_on_front', function ($v) { return (!is_admin() && mc_mode()) ? 'page' : $v; });
add_filter('pre_option_page_on_front', function ($v) { if (is_admin() || !mc_mode()) return $v; $ids = mc_ids(); return empty($ids['accueil']) ? $v : (int) $ids['accueil']; });
add_filter('template_include', function ($t) {
    if (!mc_mode()) return $t;
    if (is_page() && mc_key_of(get_queried_object_id()) !== '') return __DIR__ . '/mc-page.php';
    if (is_singular('elementor_library') && get_post_meta(get_queried_object_id(), '_mc_tpl', true)) return __DIR__ . '/mc-template.php';
    return $t;
}, 1000);
// Pages Moto's Cool : rien d'inutile de WordPress, et la couleur du « kit » Elementor de l'ancien site ne déteint pas
add_action('wp_enqueue_scripts', function () {
    if (!mc_mode() || mc_is_editor_preview() || !is_page() || mc_key_of(get_queried_object_id()) === '') return;
    foreach (['wp-block-library', 'wp-block-library-theme', 'classic-theme-styles', 'global-styles'] as $h) wp_dequeue_style($h);
}, 100);
add_filter('body_class', function ($c) {
    if (!mc_mode() || !(is_page() && mc_key_of(get_queried_object_id()) !== '') && !is_singular('elementor_library')) return $c;
    return array_values(array_filter($c, function ($x) { return strpos($x, 'elementor-kit-') !== 0; }));
}, 1000);
// Adresses en .html : WordPress ne doit pas y ajouter de « / »
add_filter('redirect_canonical', function ($r) { return (mc_mode() && is_page() && mc_key_of(get_queried_object_id()) !== '') ? false : $r; });
// Titre de la page : celui du site ; Rank Math (s'il est réglé) le remplace par le sien, modifiable dans la page
add_filter('pre_get_document_title', function ($t) {
    if (!mc_mode() || !is_page() || ($k = mc_key_of(get_queried_object_id())) === '') return $t;
    $p = mc_page_data($k);
    return $p ? $p['seo']['title'] : $t;
}, 5);
add_action('wp', function () {
    if (!mc_mode() || !is_page() || mc_key_of(get_queried_object_id()) === '') return;
    remove_action('wp_head', 'rel_canonical'); // adresse canonique : Rank Math, sinon celle du site (mc-page.php)
    remove_action('wp_head', 'print_emoji_detection_script', 7);
    remove_action('wp_print_styles', 'print_emoji_styles');
});
add_action('after_setup_theme', function () { add_theme_support('title-tag'); add_theme_support('post-thumbnails', ['mc_video']); });

/* ---------- Création des pages et des modèles (une seule fois ; jamais d'écrasement des modifications du client) ---------- */
function mc_el_id() { return substr(md5(uniqid('', true) . wp_rand()), 0, 7); }
function mc_el_section($widget, $settings) {
    return ['id' => mc_el_id(), 'elType' => 'section', 'isInner' => false,
        'settings' => ['layout' => 'full_width', 'gap' => 'no', 'css_classes' => 'mc-s', 'padding' => ['unit' => 'px', 'top' => '0', 'right' => '0', 'bottom' => '0', 'left' => '0', 'isLinked' => true]],
        'elements' => [['id' => mc_el_id(), 'elType' => 'column', 'isInner' => false, 'settings' => ['_column_size' => 100, '_inline_size' => null, 'padding' => ['unit' => 'px', 'top' => '0', 'right' => '0', 'bottom' => '0', 'left' => '0', 'isLinked' => true]],
            'elements' => [['id' => mc_el_id(), 'elType' => 'widget', 'widgetType' => $widget, 'settings' => $settings, 'elements' => []]]]]];
}
function mc_set_el_data($id, $data, $type) {
    update_post_meta($id, '_elementor_edit_mode', 'builder');
    update_post_meta($id, '_elementor_template_type', $type);
    update_post_meta($id, '_elementor_version', defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : '3.6.0');
    update_post_meta($id, '_elementor_data', wp_slash(wp_json_encode($data)));
}
// Texte brut de la page (recherche WordPress, analyse Rank Math)
function mc_plain_content($p) {
    $h = '';
    foreach ($p['blocks'] as $b) $h .= mc_widget_html($b['w'], $b['s']) . "\n";
    $h = preg_replace('#<(script|style|svg|video|dialog|form|noscript)\b[\s\S]*?</\1>#i', '', $h);
    return trim(preg_replace("/\n\s*\n+/", "\n\n", wp_kses($h, ['h1' => [], 'h2' => [], 'h3' => [], 'p' => [], 'ul' => [], 'ol' => [], 'li' => [], 'a' => ['href' => true], 'strong' => [], 'b' => [], 'em' => []])));
}
// Ancienne version d'une page ou d'un modèle Moto's Cool : gardée dans l'historique d'Elementor (icône horloge) avant remplacement
function mc_keep_revision($id, $old_ver) {
    $old = get_post_meta($id, '_elementor_data', true);
    if ($old) update_post_meta($id, '_mc_sauvegarde_v' . preg_replace('/\W/', '', (string) $old_ver), wp_slash(is_string($old) ? $old : wp_json_encode($old)));
    if (!function_exists('wp_save_post_revision') || !wp_revisions_enabled(get_post($id))) return;
    add_filter('wp_save_post_revision_check_for_changes', '__return_false');
    wp_save_post_revision($id);
    remove_filter('wp_save_post_revision_check_for_changes', '__return_false');
}
function mc_page_secs($p) {
    $secs = [];
    foreach ($p['blocks'] as $b) {
        $s = $b['s'];
        if (mc_data('widgets')[$b['w']]['kind'] === 'bloc') $s['mc_code'] = mc_widget_html($b['w'], $b['s']);
        $secs[] = mc_el_section($b['w'], $s);
    }
    return $secs;
}
function mc_page_seo($id, $p) {
    update_post_meta($id, 'rank_math_title', $p['seo']['title']);
    update_post_meta($id, 'rank_math_description', $p['seo']['description']);
    if ($p['seo']['keyword'] !== '') update_post_meta($id, 'rank_math_focus_keyword', $p['seo']['keyword']);
    update_post_meta($id, 'rank_math_facebook_image', home_url('/assets/og-image.jpg'));
    update_post_meta($id, 'rank_math_twitter_use_facebook', 'on');
}
function mc_install_pages() {
    if (!mc_el_ok() || !mc_data('pages') || get_transient('mc_install_lock')) return;
    set_transient('mc_install_lock', 1, 300);
    @set_time_limit(300);
    $ids = mc_ids();
    $old_ver = (string) get_option('mc_pages_ver', '');
    // Nouvelle version du site : nos pages et modèles existants sont remplacés (jamais les anciennes pages du client)
    $upgrade = $old_ver !== '' && $old_ver !== MC_PAGES_VER;
    foreach (mc_data('templates') as $k => $t) {
        $id = isset($ids['t:' . $k]) ? (int) $ids['t:' . $k] : 0;
        $t['settings']['mc_code'] = mc_widget_html($t['widget'], $t['settings']);
        if ($id && get_post($id) && get_post_status($id) !== 'trash') {
            if ($upgrade && get_post_type($id) === 'elementor_library' && get_post_meta($id, '_mc_tpl', true) === $k) {
                mc_keep_revision($id, $old_ver);
                mc_set_el_data($id, [mc_el_section($t['widget'], $t['settings'])], 'section');
                delete_post_meta($id, '_elementor_css');
            }
            continue;
        }
        $id = wp_insert_post(['post_type' => 'elementor_library', 'post_status' => 'publish', 'post_title' => $t['title']], true);
        if (is_wp_error($id) || !$id) continue;
        wp_set_object_terms($id, 'section', 'elementor_library_type');
        update_post_meta($id, '_mc_tpl', $k);
        mc_set_el_data($id, [mc_el_section($t['widget'], $t['settings'])], 'section');
        $ids['t:' . $k] = $id; update_option('mc_pages', $ids, false);
    }
    $order = 0;
    foreach (mc_data('pages') as $key => $info) {
        $order++;
        $id = isset($ids[$key]) ? (int) $ids[$key] : 0;
        $p = mc_page_data($key);
        if (!$p) continue;
        if ($id && get_post($id) && get_post_status($id) !== 'trash') {
            if ($upgrade && get_post_type($id) === 'page' && get_post_meta($id, '_mc_key', true) === $key) {
                mc_keep_revision($id, $old_ver);
                mc_set_el_data($id, mc_page_secs($p), 'wp-page');
                delete_post_meta($id, '_elementor_css');
                mc_page_seo($id, $p);
                wp_update_post(['ID' => $id, 'post_content' => mc_plain_content($p)]);
            }
            continue;
        }
        $id = wp_insert_post(['post_type' => 'page', 'post_status' => 'publish', 'post_title' => $info['title'], 'post_name' => 'mc-' . sanitize_title(str_replace('/', '-', $key)),
            'post_content' => mc_plain_content($p), 'comment_status' => 'closed', 'ping_status' => 'closed', 'menu_order' => $order], true);
        if (is_wp_error($id) || !$id) continue;
        update_post_meta($id, '_mc_key', $key);
        mc_set_el_data($id, mc_page_secs($p), 'wp-page');
        mc_page_seo($id, $p);
        $ids[$key] = $id; update_option('mc_pages', $ids, false);
    }
    update_option('mc_pages', $ids, false);
    update_option('mc_pages_ver', MC_PAGES_VER, false);
    if (function_exists('mc_seed_videos')) mc_seed_videos();
    delete_transient('mc_install_lock');
}
add_action('after_switch_theme', 'mc_install_pages', 20);
// Thème mis à jour (« Remplacer l'actuel ») ou Elementor activé plus tard : pages créées au premier passage dans l'administration
add_action('admin_init', function () {
    if (mc_el_ok() && current_user_can('edit_pages') && (get_option('mc_pages_ver') !== MC_PAGES_VER || empty(mc_ids()['accueil']) || get_post_status(mc_ids()['accueil']) !== 'publish')) mc_install_pages();
});
add_action('admin_notices', function () {
    if (!current_user_can('activate_plugins') || mc_el_ok()) return;
    echo '<div class="notice notice-warning"><p><b>Moto\'s Cool :</b> activez l\'extension <b>Elementor</b> pour pouvoir modifier les pages du site. Sans elle, le site s\'affiche normalement mais ne se modifie pas.</p></div>';
});
// Repère dans la liste des pages
add_filter('display_post_states', function ($states, $post) {
    if ($post->post_type === 'page' && mc_key_of($post->ID) !== '') $states['mc'] = $post->post_title === "Moto's Cool – Accueil" ? "Page d'accueil du site" : "Site Moto's Cool";
    return $states;
}, 10, 2);
