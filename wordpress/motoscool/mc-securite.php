<?php
/**
 * Moto's Cool : sécurité du site.
 *  - connexion protégée : essais limités, message d'erreur neutre, code de sécurité sur le téléphone (facultatif) ;
 *  - administration verrouillée : pas de modification du code depuis WordPress, pas d'inscription, pas de commentaires ;
 *  - dossier des images : aucun programme ne peut y être lancé (règle du serveur testée puis gardée seulement si le site marche) ;
 *  - contrôle quotidien des fichiers (comme un antivirus) avec alerte par email ;
 *  - page « Réglages → Moto's Cool Sécurité » qui résume tout en clair.
 * Compatible PHP 7.0 / WordPress 5.8+.
 */
if (!defined('ABSPATH')) exit;

/* ================= 1. Administration verrouillée ================= */
// Personne (même un pirate qui aurait un mot de passe) ne peut modifier le code des thèmes et extensions depuis WordPress
if (!defined('DISALLOW_FILE_EDIT')) define('DISALLOW_FILE_EDIT', true);
// « Mots de passe d'application » (accès à distance sans écran de connexion) : coupés
add_filter('wp_is_application_passwords_available', '__return_false');
// Inscriptions fermées : personne ne peut se créer un compte (les failles des anciennes extensions demandent un compte)
add_filter('pre_option_users_can_register', function () { return '0'; });
add_filter('pre_option_default_role', function () { return 'subscriber'; });
// Commentaires et rétroliens fermés (le site n'en a pas : ce serait seulement une porte pour le spam)
add_filter('comments_open', '__return_false', 99);
add_filter('pings_open', '__return_false', 99);
add_filter('pre_option_default_comment_status', function () { return 'closed'; });
add_filter('pre_option_default_ping_status', function () { return 'closed'; });

/* ================= 2. Connexion protégée ================= */
function mc_sec_ip() { return preg_replace('/[^0-9a-f:.]/i', '', (string) (isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : '')); }
function mc_lock_left($ip) { $u = (int) get_transient('mc_lock_' . md5($ip)); return $u > time() ? $u - time() : 0; }
// Journal (30 jours, 100 lignes max) : blocages, connexions avec code de secours, alertes
function mc_sec_log($type, $detail) {
    $j = get_option('mc_sec_journal', []);
    if (!is_array($j)) $j = [];
    $j = array_values(array_filter($j, function ($l) { return is_array($l) && time() - (int) $l[0] < 30 * DAY_IN_SECONDS; }));
    array_unshift($j, [time(), (string) $type, (string) $detail]);
    update_option('mc_sec_journal', array_slice($j, 0, 100), false);
}
// 5 essais ratés en 15 min → connexion bloquée 20 min pour cette adresse ; 3 blocages en 24 h → 24 h
add_action('wp_login_failed', function ($username) {
    $ip = mc_sec_ip();
    if ($ip === '' || mc_lock_left($ip)) return;
    $k = 'mc_lf_' . md5($ip);
    $list = array_filter((array) get_transient($k), function ($t) { return time() - (int) $t < 900; });
    $list[] = time();
    if (count($list) < 5) { set_transient($k, array_values($list), 900); return; }
    delete_transient($k);
    $n = 'mc_ln_' . md5($ip);
    $strikes = (int) get_transient($n) + 1;
    set_transient($n, $strikes, DAY_IN_SECONDS);
    $dur = $strikes >= 3 ? DAY_IN_SECONDS : 20 * MINUTE_IN_SECONDS;
    set_transient('mc_lock_' . md5($ip), time() + $dur, $dur);
    mc_sec_log('blocage', 'Adresse ' . $ip . ' bloquée ' . ($dur >= DAY_IN_SECONDS ? '24 h' : '20 min') . ' après 5 essais ratés (identifiant tapé : « ' . mb_substr(sanitize_user((string) $username), 0, 40) . ' »)');
});
// Après la vérification du mot de passe (priorité 99) : blocage, code de sécurité, message d'erreur neutre
add_filter('authenticate', function ($user, $username, $password) {
    if ($username === '' && $password === '' && !($user instanceof WP_User)) return $user; // simple affichage de la page
    $left = mc_lock_left(mc_sec_ip());
    if ($left) return new WP_Error('mc_bloque', "<strong>Trop d'essais.</strong> Par sécurité, la connexion est bloquée pendant encore " . (int) ceil($left / 60) . " minute(s).");
    if ($user instanceof WP_User) return mc_2fa_gate($user);
    if (is_wp_error($user) && array_intersect($user->get_error_codes(), ['invalid_username', 'invalid_email', 'incorrect_password'])) {
        // Ne jamais dire si l'identifiant existe : un robot ne doit pas pouvoir trouver les noms des comptes
        return new WP_Error('incorrect_password', '<strong>Erreur :</strong> identifiant, adresse email ou mot de passe incorrect. <a href="' . esc_url(wp_lostpassword_url()) . '">Mot de passe oublié ?</a>');
    }
    return $user;
}, 99, 3);
// « Mot de passe oublié » : 5 demandes par heure et par adresse, et jamais « ce compte n'existe pas »
add_action('lostpassword_post', function ($errors) {
    if (function_exists('mc_limited') && is_wp_error($errors) && mc_limited('lp|' . mc_sec_ip(), 5, HOUR_IN_SECONDS)) $errors->add('mc_trop', "Trop de demandes : réessayez dans une heure.");
});
add_filter('lostpassword_errors', function ($errors, $user_data = null) {
    // Compte inexistant : même réponse que pour un vrai compte (« Vérifiez vos emails »)
    if (is_wp_error($errors) && !$errors->has_errors() && !$user_data && !empty($_POST['user_login'])) {
        wp_safe_redirect(add_query_arg('checkemail', 'confirm', wp_login_url())); exit;
    }
    return $errors;
}, 10, 2);

/* ================= 3. Code de sécurité sur le téléphone (double vérification, facultative) ================= */
// Application gratuite : Google Authenticator, Microsoft Authenticator… Un code à 6 chiffres qui change toutes les 30 s.
// Secours : 8 codes à usage unique donnés à l'activation. Dépannage par SYZ : define('MC_2FA_OFF', true); dans wp-config.php.
function mc_b32_encode($bin) {
    $a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $bits = ''; $out = '';
    for ($i = 0; $i < strlen($bin); $i++) $bits .= str_pad(decbin(ord($bin[$i])), 8, '0', STR_PAD_LEFT);
    for ($i = 0; $i < strlen($bits); $i += 5) $out .= $a[bindec(str_pad(substr($bits, $i, 5), 5, '0'))];
    return $out;
}
function mc_b32_decode($s) {
    $a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $s = strtoupper(preg_replace('/[^A-Za-z2-7]/', '', (string) $s)); $bits = ''; $out = '';
    for ($i = 0; $i < strlen($s); $i++) $bits .= str_pad(decbin(strpos($a, $s[$i])), 5, '0', STR_PAD_LEFT);
    for ($i = 0; $i + 8 <= strlen($bits); $i += 8) $out .= chr(bindec(substr($bits, $i, 8)));
    return $out;
}
function mc_totp($secret, $step) {
    $h = hash_hmac('sha1', pack('N', 0) . pack('N', $step), mc_b32_decode($secret), true);
    $o = ord($h[19]) & 0xf;
    $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
    return str_pad((string) ($n % 1000000), 6, '0', STR_PAD_LEFT);
}
// Code valable pendant ±30 s (horloge du téléphone un peu décalée), et jamais deux fois le même
function mc_totp_check($uid, $secret, $code, $remember = true) {
    $code = preg_replace('/\D/', '', (string) $code);
    if (strlen($code) !== 6 || $secret === '') return false;
    $t = (int) floor(time() / 30); $last = (int) get_user_meta($uid, 'mc_2fa_last', true);
    for ($i = -1; $i <= 1; $i++) {
        $s = $t + $i;
        if ($s <= $last) continue;
        if (hash_equals(mc_totp($secret, $s), $code)) { if ($remember) update_user_meta($uid, 'mc_2fa_last', $s); return true; }
    }
    return false;
}
function mc_2fa_on($uid) { return !(defined('MC_2FA_OFF') && MC_2FA_OFF) && get_user_meta($uid, 'mc_2fa_on', true) === '1' && get_user_meta($uid, 'mc_2fa_secret', true) !== ''; }
function mc_2fa_new_codes($uid) {
    $codes = []; $hashes = [];
    for ($i = 0; $i < 8; $i++) {
        $c = strtolower(wp_generate_password(5, false, false) . '-' . wp_generate_password(5, false, false));
        $codes[] = $c; $hashes[] = wp_hash_password($c);
    }
    update_user_meta($uid, 'mc_2fa_codes', $hashes);
    return $codes;
}
function mc_2fa_use_code($uid, $code) {
    $code = strtolower(trim((string) $code));
    if (!preg_match('/^[a-z0-9]{5}-[a-z0-9]{5}$/', $code)) return false;
    $list = (array) get_user_meta($uid, 'mc_2fa_codes', true);
    foreach ($list as $i => $h) {
        if (is_string($h) && wp_check_password($code, $h)) { unset($list[$i]); update_user_meta($uid, 'mc_2fa_codes', array_values($list)); return true; }
    }
    return false;
}
function mc_2fa_gate($user) {
    if (!mc_2fa_on($user->ID)) return $user;
    $code = isset($_POST['mc_2fa']) ? (string) wp_unslash($_POST['mc_2fa']) : '';
    if (mc_totp_check($user->ID, (string) get_user_meta($user->ID, 'mc_2fa_secret', true), $code)) return $user;
    if (mc_2fa_use_code($user->ID, $code)) {
        mc_sec_log('secours', 'Connexion de « ' . $user->user_login . ' » avec un code de secours (il en reste ' . count((array) get_user_meta($user->ID, 'mc_2fa_codes', true)) . ')');
        return $user;
    }
    return new WP_Error('mc_2fa', '<strong>Code de sécurité manquant ou incorrect.</strong> Tapez le code à 6 chiffres affiché dans l\'application du téléphone (ou un code de secours).');
}
add_action('login_form', function () {
    // Champ affiché seulement si au moins un compte a activé la double vérification (sinon l'écran reste comme avant)
    if (defined('MC_2FA_OFF') && MC_2FA_OFF) return;
    if (!get_users(['meta_key' => 'mc_2fa_on', 'meta_value' => '1', 'number' => 1, 'fields' => 'ID'])) return;
    echo '<p><label for="mc_2fa">Code de sécurité <span style="font-weight:400;color:#646970">(seulement si la double vérification est activée)</span></label>'
        . '<input type="text" name="mc_2fa" id="mc_2fa" class="input" inputmode="numeric" autocomplete="one-time-code" maxlength="11" size="20"></p>';
});

/* ================= 4. Dossier des images : aucun programme ne peut y être lancé ================= */
// Les pirates déposent souvent un programme (fichier .php) avec les images : le serveur refuse alors de l'exécuter.
// Vérifié en vrai : un petit fichier témoin est créé, appelé, puis supprimé.
function mc_ht_deny_lines($files_regex) {
    return ['<FilesMatch "' . $files_regex . '">', '<IfModule mod_authz_core.c>', 'Require all denied', '</IfModule>',
        '<IfModule !mod_authz_core.c>', 'Order allow,deny', 'Deny from all', '</IfModule>', '</FilesMatch>'];
}
function mc_http_get($url) {
    $r = wp_remote_get($url, ['timeout' => 15, 'sslverify' => false, 'redirection' => 0, 'headers' => ['Cache-Control' => 'no-cache']]);
    return is_wp_error($r) ? [0, ''] : [(int) wp_remote_retrieve_response_code($r), (string) wp_remote_retrieve_body($r)];
}
function mc_uploads_protect() {
    $up = wp_upload_dir(null, false);
    if (!empty($up['error']) || empty($up['basedir'])) return 'non-modifiable';
    $dir = trailingslashit($up['basedir']); $url = trailingslashit($up['baseurl']);
    $f = $dir . '.htaccess';
    if (!is_dir($dir) || !wp_is_writable($dir) || (is_file($f) && !is_writable($f))) return 'non-modifiable';
    list($c0) = mc_http_get(home_url('/'));
    if (!$c0 || $c0 >= 500) return 'test-impossible'; // le site ne peut pas se tester lui-même maintenant : rien n'est modifié
    $id = 'mc-test-' . strtolower(wp_generate_password(12, false, false));
    $php = $dir . $id . '.php'; $txt = $dir . $id . '.txt';
    if (!@file_put_contents($php, "<?php echo 'mc-php-' . 'actif';") || !@file_put_contents($txt, 'mc-ok')) { @unlink($php); @unlink($txt); return 'non-modifiable'; }
    $etat = 'ok';
    $lines = array_merge(['# Aucun programme ne peut être lancé depuis le dossier des images'], mc_ht_deny_lines('\.(?i:php[0-9]?|phtml|phar|pht|phps|cgi|pl|py|sh|shtml)$'));
    if (!insert_with_markers($f, "Moto's Cool securite", $lines)) $etat = 'non-ecrit';
    else {
        list($ct, $bt) = mc_http_get($url . $id . '.txt');
        list($cp, $bp) = mc_http_get($url . $id . '.php');
        list($ch) = mc_http_get(home_url('/'));
        if ($ct >= 500 || $ch >= 500 || !$ch) { insert_with_markers($f, "Moto's Cool securite", []); $etat = 'retire'; }
        elseif (strpos($bp, 'mc-php-actif') !== false) $etat = 'sans-effet'; // le serveur ignore la règle : rien de cassé, mais pas de protection
    }
    @unlink($php); @unlink($txt);
    return $etat;
}

/* ================= 5. Contrôle des fichiers (comme un antivirus), chaque jour ================= */
// Compare chaque fichier de WordPress et des extensions à l'original publié par WordPress.org (empreintes officielles),
// ceux du thème à la liste du thème, cherche les programmes cachés dans le dossier des images et les signatures
// des virus PHP connus, et repère un nouveau compte administrateur. Alerte par email si quelque chose change.
function mc_scan_json($url) {
    $k = 'mc_sum_' . md5($url);
    $c = get_transient($k);
    if (is_array($c)) return $c;
    $r = wp_remote_get($url, ['timeout' => 30]);
    if (is_wp_error($r)) return null;
    $code = (int) wp_remote_retrieve_response_code($r);
    if ($code === 404) { set_transient($k, ['__absent' => 1], 7 * DAY_IN_SECONDS); return ['__absent' => 1]; }
    $j = json_decode((string) wp_remote_retrieve_body($r), true);
    if ($code !== 200 || !is_array($j)) return null;
    set_transient($k, $j, 30 * DAY_IN_SECONDS);
    return $j;
}
function mc_scan_files($dir, $only_php = false) {
    $out = [];
    if (!is_dir($dir)) return $out;
    try {
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if (!$f->isFile()) continue;
            if ($only_php && !preg_match('/\.(php[0-9]?|phtml|phar|pht|inc)$/i', $f->getFilename())) continue;
            $out[] = wp_normalize_path($f->getPathname());
        }
    } catch (Exception $e) {}
    return $out;
}
function mc_scan_silence($file) { // fichier « index.php » vide mis par WordPress dans les dossiers : normal
    if (filesize($file) > 300) return false;
    $c = (string) @file_get_contents($file);
    $c = preg_replace(['~/\*.*?\*/~s', '~//[^\n]*~', '~#[^\n]*~', '~<\?php|\?>~'], '', $c);
    return trim($c) === '';
}
function mc_scan_patterns() {
    return [
        '~\beval\s*\(\s*(?:base64_decode|gzinflate|gzuncompress|gzdecode|str_rot13|strrev|rawurldecode)\s*\(~i' => 'code caché exécuté (eval + décodage)',
        '~\b(?:eval|assert)\s*\(\s*(?:stripslashes\s*\(\s*)?\$_(?:POST|GET|REQUEST|COOKIE|SERVER)~i' => 'exécute ce qu\'envoie un visiteur',
        '~\b(?:system|shell_exec|passthru|exec|popen|proc_open)\s*\(\s*(?:base64_decode\s*\(\s*)?\$_(?:POST|GET|REQUEST|COOKIE)~i' => 'commande du serveur lancée par un visiteur',
        '~\$_(?:POST|GET|REQUEST|COOKIE)\s*\[[^\]]{1,40}\]\s*\(~' => 'fonction choisie par un visiteur',
        '~preg_replace\s*\(\s*([\'"])([^a-z0-9\s\'"])[^\'"\n]*\2[a-z]*e[a-z]*\1\s*,~i' => 'preg_replace /e (ancienne porte dérobée)',
        '~\b(?:FilesMan|WSOsetcookie|c99shell|r57shell|b374k|IndoXploit|AnonymousFox)\b~' => 'nom d\'un outil de piratage connu',
        '~(?:\\\\x[0-9a-f]{2}){120,}~i' => 'long code illisible (caractères codés)',
    ];
}
function mc_scan_suspect($file) {
    if (!is_readable($file) || filesize($file) > 3 * 1048576) return '';
    $c = (string) @file_get_contents($file);
    foreach (mc_scan_patterns() as $re => $label) if (@preg_match($re, $c)) return $label;
    return '';
}
function mc_scan_run($why = 'auto') {
    @set_time_limit(300);
    $t0 = microtime(true);
    $root = wp_normalize_path(trailingslashit(ABSPATH));
    $pb = []; $err = []; $n = 0; $ok_list = (array) get_option('mc_scan_ok', []);
    $add = function ($type, $file, $detail) use (&$pb, $root, $ok_list) {
        $rel = strpos($file, $root) === 0 ? substr($file, strlen($root)) : $file;
        $sig = is_file($file) ? md5_file($file) : 'absent';
        if (isset($ok_list[$rel]) && $ok_list[$rel] === $sig) return; // marqué « normal » par l'administrateur (tant qu'il ne change pas)
        $pb[] = ['type' => $type, 'f' => $rel, 'd' => $detail, 'sig' => $sig];
    };
    // 5a. WordPress lui-même (empreintes officielles, en français et en anglais)
    global $wp_version, $wp_local_package;
    $sums = [];
    foreach (array_unique([isset($wp_local_package) ? $wp_local_package : get_locale(), 'en_US']) as $loc) {
        $j = mc_scan_json('https://api.wordpress.org/core/checksums/1.0/?version=' . rawurlencode($wp_version) . '&locale=' . rawurlencode($loc));
        if (!is_array($j) || empty($j['checksums']) || !is_array($j['checksums'])) continue;
        $c = isset($j['checksums'][$wp_version]) ? $j['checksums'][$wp_version] : $j['checksums'];
        foreach ($c as $file => $md5) $sums[$file][] = $md5;
    }
    if (!$sums) $err[] = "Empreintes officielles de WordPress inaccessibles : WordPress lui-même n'a pas été vérifié cette fois.";
    else {
        foreach ($sums as $file => $md5s) {
            if (strpos($file, 'wp-content/') === 0 || in_array($file, ['wp-config-sample.php', 'readme.html', 'license.txt', 'licence.txt'], true)) continue;
            $p = $root . $file;
            if (!is_file($p)) continue;
            $n++;
            if (!in_array(md5_file($p), $md5s, true)) $add('modifie', $p, 'Fichier de WordPress modifié (différent de l\'original)');
        }
        foreach (array_merge(mc_scan_files($root . 'wp-admin', true), mc_scan_files($root . 'wp-includes', true), glob($root . '*.php') ?: []) as $p) {
            $p = wp_normalize_path($p); $rel = substr($p, strlen($root));
            if (isset($sums[$rel]) || $rel === 'wp-config.php') continue;
            $add('inconnu', $p, 'Programme ajouté dans les dossiers de WordPress' . (($s = mc_scan_suspect($p)) ? ' — ' . $s : ''));
        }
    }
    // 5b. Extensions : empreintes officielles si elles viennent de WordPress.org, sinon recherche de signatures de virus
    if (!function_exists('get_plugins')) require_once ABSPATH . 'wp-admin/includes/plugin.php';
    $pdir = wp_normalize_path(trailingslashit(WP_PLUGIN_DIR));
    $verified = [];
    foreach (get_plugins() as $pf => $pd) {
        $slug = dirname($pf);
        if ($slug === '.' || $slug === '' || empty($pd['Version'])) continue;
        $j = mc_scan_json('https://downloads.wordpress.org/plugin-checksums/' . rawurlencode($slug) . '/' . rawurlencode($pd['Version']) . '.json');
        if (!is_array($j) || empty($j['files']) || !is_array($j['files'])) { if ($j === null) $err[] = "Empreintes de l'extension « " . $pd['Name'] . " » inaccessibles cette fois."; continue; }
        $verified[$slug] = 1;
        foreach ($j['files'] as $file => $h) {
            $p = $pdir . $slug . '/' . $file;
            if (!is_file($p) || !isset($h['md5'])) continue;
            $n++;
            if (!in_array(md5_file($p), (array) $h['md5'], true)) $add('modifie', $p, 'Fichier de l\'extension « ' . $pd['Name'] . ' » modifié');
        }
        foreach (mc_scan_files($pdir . $slug, true) as $p) {
            if (!isset($j['files'][substr($p, strlen($pdir . $slug . '/'))])) $add('inconnu', $p, 'Programme ajouté dans l\'extension « ' . $pd['Name'] . ' »' . (($s = mc_scan_suspect($p)) ? ' — ' . $s : ''));
        }
    }
    // 5c. Thème Moto's Cool : comparé à la liste de ses fichiers
    $tdir = wp_normalize_path(trailingslashit(get_template_directory()));
    $emp = json_decode((string) @file_get_contents($tdir . 'mc-empreintes.json'), true);
    if (is_array($emp)) {
        foreach ($emp as $file => $sha) { $p = $tdir . $file; if (is_file($p)) { $n++; if (hash_file('sha256', $p) !== $sha) $add('modifie', $p, 'Fichier du thème Moto\'s Cool modifié'); } }
        foreach (mc_scan_files(rtrim($tdir, '/'), true) as $p) if (!isset($emp[substr($p, strlen($tdir))])) $add('inconnu', $p, 'Programme ajouté dans le thème Moto\'s Cool' . (($s = mc_scan_suspect($p)) ? ' — ' . $s : ''));
    }
    // 5d. Tout le reste (ancien thème, extensions hors WordPress.org, dossier wp-content) : signatures de virus connus
    $content = wp_normalize_path(trailingslashit(WP_CONTENT_DIR));
    $up = wp_upload_dir(null, false); $updir = wp_normalize_path(trailingslashit($up['basedir']));
    foreach (mc_scan_files(rtrim($content, '/'), true) as $p) {
        if (strpos($p, $tdir) === 0 || strpos($p, $updir) === 0) continue;
        if (strpos($p, $pdir) === 0) { $rest = substr($p, strlen($pdir)); $sl = strpos($rest, '/') !== false ? substr($rest, 0, strpos($rest, '/')) : ''; if ($sl !== '' && isset($verified[$sl])) continue; }
        $n++;
        if ($s = mc_scan_suspect($p)) $add('virus', $p, 'Signature de virus : ' . $s);
    }
    // 5e. Dossier des images : aucun programme ne doit s'y trouver
    foreach (mc_scan_files(rtrim($updir, '/'), true) as $p) {
        $n++;
        if (basename($p) === 'index.php' && mc_scan_silence($p)) continue;
        $add('virus', $p, 'Programme caché dans le dossier des images' . (($s = mc_scan_suspect($p)) ? ' — ' . $s : ''));
    }
    // 5f. Comptes administrateurs : un nouveau compte inconnu est un signe classique de piratage
    $admins = get_users(['role' => 'administrator', 'fields' => ['ID', 'user_login', 'user_registered']]);
    $known = get_option('mc_scan_admins');
    if (!is_array($known)) { // premier contrôle : les administrateurs actuels sont ceux du garage
        $known = array_map(function ($a) { return (int) $a->ID; }, $admins);
        update_option('mc_scan_admins', $known, false);
    }
    foreach ($admins as $a) {
        $key = 'Compte « ' . $a->user_login . ' »';
        if (in_array((int) $a->ID, $known, true) || (isset($ok_list[$key]) && $ok_list[$key] === 'admin' . $a->ID)) continue;
        // signalé à chaque contrôle tant que personne n'a cliqué « C'est normal »
        $pb[] = ['type' => 'admin', 'f' => $key, 'd' => 'Nouvel administrateur (créé le ' . mysql2date('d/m/Y H:i', $a->user_registered) . ') : vérifiez que c\'est bien vous qui l\'avez créé', 'sig' => 'admin' . $a->ID];
    }
    $res = ['t' => time(), 'why' => $why, 'n' => $n, 'duree' => round(microtime(true) - $t0, 1), 'pb' => $pb, 'err' => $err];
    update_option('mc_scan', $res, false);
    // Alerte par email (une seule fois pour une même liste de problèmes)
    $sig = md5(wp_json_encode(array_map(function ($x) { return $x['f'] . $x['sig']; }, $pb)));
    if ($pb && get_option('mc_scan_alerte') !== $sig) {
        update_option('mc_scan_alerte', $sig, false);
        mc_sec_log('alerte', count($pb) . ' problème(s) trouvé(s) par le contrôle des fichiers');
        $lines = '';
        foreach (array_slice($pb, 0, 40) as $x) $lines .= '<li><b>' . esc_html($x['f']) . '</b> : ' . esc_html($x['d']) . '</li>';
        $body = '<p>Bonjour,</p><p>Le contrôle de sécurité du site <b>' . esc_html(home_url('/')) . '</b> a trouvé <b>' . count($pb) . ' élément(s) à vérifier</b> :</p><ul>' . $lines . '</ul>'
            . '<p>Ne supprimez rien vous-même : appelez SYZ. Détails : WordPress → Réglages → Moto\'s Cool Sécurité.</p>';
        $to = array_unique(array_filter([get_option('admin_email'), function_exists('mc_to') ? mc_to() : '']));
        $h = function_exists('mc_headers') ? mc_headers(null) : ['Content-Type: text/html; charset=UTF-8'];
        foreach ($to as $t) if (is_email($t)) wp_mail($t, "Moto's Cool : alerte sécurité du site", $body, $h);
    } elseif (!$pb) delete_option('mc_scan_alerte');
    return $res;
}
add_action('mc_scan', function () { mc_scan_run('auto'); });
add_action('init', function () {
    if (!wp_next_scheduled('mc_scan') && (!function_exists('mc_ready') || mc_ready())) wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', 'mc_scan');
});
add_action('switch_theme', function () { wp_clear_scheduled_hook('mc_scan'); });
// Alerte visible en haut de l'administration tant qu'un problème n'est pas traité
add_action('admin_notices', function () {
    if (!current_user_can('manage_options')) return;
    $s = get_option('mc_scan');
    if (!is_array($s) || empty($s['pb']) || (isset($_GET['page']) && $_GET['page'] === 'mc-securite')) return;
    echo '<div class="notice notice-error"><p style="font-size:15px"><b>Moto\'s Cool : alerte sécurité.</b> Le contrôle des fichiers a trouvé ' . count($s['pb']) . ' élément(s) à vérifier. '
        . '<a class="button button-primary" href="' . esc_url(admin_url('options-general.php?page=mc-securite')) . '">Voir le détail</a> Ne supprimez rien vous-même : appelez SYZ.</p></div>';
});

/* ================= 6. Page « Réglages → Moto's Cool Sécurité » ================= */
add_action('admin_menu', function () {
    add_options_page("Moto's Cool Sécurité", "Moto's Cool Sécurité", 'manage_options', 'mc-securite', 'mc_sec_page');
});
add_action('admin_enqueue_scripts', function ($hook) {
    if ($hook === 'settings_page_mc-securite') wp_enqueue_script('mc-qrcode', get_template_directory_uri() . '/admin/qrcode.js', [], '1.4.4', true);
});
// Actions de la page (toujours : administrateur + jeton de sécurité du formulaire)
function mc_sec_actions() {
    if (empty($_POST['mc_sec']) || !current_user_can('manage_options')) return null;
    check_admin_referer('mc_sec');
    $u = wp_get_current_user(); $a = sanitize_key(wp_unslash($_POST['mc_sec']));
    $code = isset($_POST['code']) ? (string) wp_unslash($_POST['code']) : '';
    if ($a === 'scan') { mc_scan_run('manuel'); return ['success', 'Contrôle des fichiers terminé.']; }
    if ($a === 'normal' && isset($_POST['f'])) {
        $s = get_option('mc_scan'); $f = (string) wp_unslash($_POST['f']);
        if (is_array($s)) foreach ($s['pb'] as $i => $x) if ($x['f'] === $f) {
            $ok = (array) get_option('mc_scan_ok', []); $ok[$f] = $x['sig']; update_option('mc_scan_ok', $ok, false);
            unset($s['pb'][$i]); $s['pb'] = array_values($s['pb']); update_option('mc_scan', $s, false);
            mc_sec_log('normal', '« ' . $f . ' » marqué normal par ' . $u->user_login);
            return ['success', 'Élément marqué comme normal (il sera de nouveau signalé s\'il change).'];
        }
        return null;
    }
    if ($a === '2fa_on') {
        $sec = (string) get_user_meta($u->ID, 'mc_2fa_pending', true);
        if ($sec === '' || !mc_totp_check($u->ID, $sec, $code)) return ['error', 'Code incorrect : vérifiez l\'heure du téléphone et tapez le code affiché à l\'instant.'];
        update_user_meta($u->ID, 'mc_2fa_secret', $sec); update_user_meta($u->ID, 'mc_2fa_on', '1'); delete_user_meta($u->ID, 'mc_2fa_pending');
        $GLOBALS['mc_new_codes'] = mc_2fa_new_codes($u->ID);
        mc_sec_log('2fa', 'Double vérification activée pour « ' . $u->user_login . ' »');
        return ['success', 'Double vérification activée.'];
    }
    if ($a === '2fa_off' || $a === '2fa_codes') {
        $sec = (string) get_user_meta($u->ID, 'mc_2fa_secret', true);
        if (!mc_totp_check($u->ID, $sec, $code) && !mc_2fa_use_code($u->ID, $code)) return ['error', 'Code incorrect.'];
        if ($a === '2fa_codes') { $GLOBALS['mc_new_codes'] = mc_2fa_new_codes($u->ID); return ['success', 'Nouveaux codes de secours créés (les anciens ne marchent plus).']; }
        foreach (['mc_2fa_on', 'mc_2fa_secret', 'mc_2fa_codes', 'mc_2fa_last'] as $k) delete_user_meta($u->ID, $k);
        mc_sec_log('2fa', 'Double vérification désactivée pour « ' . $u->user_login . ' »');
        return ['success', 'Double vérification désactivée.'];
    }
    if ($a === '2fa_reset' && isset($_POST['uid'])) { // téléphone perdu d'un autre administrateur
        $o = get_userdata((int) $_POST['uid']);
        if (!$o || (int) $o->ID === (int) $u->ID) return null;
        foreach (['mc_2fa_on', 'mc_2fa_secret', 'mc_2fa_codes', 'mc_2fa_last'] as $k) delete_user_meta($o->ID, $k);
        mc_sec_log('2fa', 'Double vérification retirée du compte « ' . $o->user_login . ' » par ' . $u->user_login);
        return ['success', 'Double vérification retirée du compte « ' . $o->user_login . ' ».'];
    }
    return null;
}
function mc_sec_row($state, $title, $text) {
    $ic = ['ok' => ['yes-alt', '#1f8a4c'], 'warn' => ['warning', '#c77700'], 'bad' => ['dismiss', '#d63638'], 'info' => ['info', '#2271b1']][$state];
    echo '<tr><td style="width:28px;vertical-align:top"><span class="dashicons dashicons-' . $ic[0] . '" style="color:' . $ic[1] . ';font-size:22px;width:22px;height:22px"></span></td><td style="vertical-align:top;width:250px"><b>' . esc_html($title) . '</b></td><td>' . $text . '</td></tr>';
}
function mc_sec_page() {
    if (!current_user_can('manage_options')) return;
    $msg = mc_sec_actions();
    $u = wp_get_current_user();
    $nonce = wp_nonce_field('mc_sec', '_wpnonce', true, false);
    $btn = function ($action, $label, $extra = '', $class = 'button') use ($nonce) {
        return '<form method="post" style="display:inline-block;margin:2px 6px 2px 0">' . $nonce . '<input type="hidden" name="mc_sec" value="' . esc_attr($action) . '">' . $extra . '<button class="' . esc_attr($class) . '">' . esc_html($label) . '</button></form>';
    };
    echo '<div class="wrap"><h1>Moto\'s Cool : sécurité du site</h1>';
    if ($msg) echo '<div class="notice notice-' . esc_attr($msg[0]) . '"><p><b>' . esc_html($msg[1]) . '</b></p></div>';
    if (!empty($GLOBALS['mc_new_codes'])) {
        echo '<div class="notice notice-warning" style="padding:12px 16px"><p style="font-size:15px"><b>Codes de secours (à noter ou imprimer maintenant : ils ne seront plus affichés).</b><br>Chaque code sert une seule fois, si le téléphone est perdu ou en panne. À taper dans « Code de sécurité ».</p><p style="font:18px/1.8 monospace">'
            . implode('<br>', array_map('esc_html', $GLOBALS['mc_new_codes'])) . '</p></div>';
    }
    echo '<p style="font-size:14px;max-width:900px">Tout ce qui protège le site, en un coup d\'œil. <span style="color:#1f8a4c">Vert</span> : en place. <span style="color:#c77700">Orange</span> : à prévoir. <span style="color:#d63638">Rouge</span> : à traiter.</p>';

    // --- Contrôle des fichiers
    $s = get_option('mc_scan');
    echo '<h2>Contrôle des fichiers (antivirus)</h2><table class="widefat striped" style="max-width:1100px"><tbody>';
    if (!is_array($s)) mc_sec_row('warn', 'Pas encore fait', 'Le premier contrôle se fait tout seul dans l\'heure. ' . $btn('scan', 'Lancer le contrôle maintenant', '', 'button button-primary'));
    else {
        $when = wp_date('d/m/Y à H:i', (int) $s['t']);
        if (empty($s['pb'])) mc_sec_row('ok', 'Aucun problème', 'Dernier contrôle le ' . esc_html($when) . ' : ' . (int) $s['n'] . ' fichiers vérifiés en ' . esc_html($s['duree']) . ' s. Contrôle automatique chaque jour, alerte par email en cas de problème. ' . $btn('scan', 'Relancer maintenant'));
        else {
            mc_sec_row('bad', count($s['pb']) . ' élément(s) à vérifier', 'Contrôle du ' . esc_html($when) . '. <b>Ne supprimez rien vous-même : appelez SYZ.</b> Un élément marqué « normal » ne sera plus signalé tant qu\'il ne change pas. ' . $btn('scan', 'Relancer maintenant'));
            foreach ($s['pb'] as $x) mc_sec_row('bad', $x['f'], esc_html($x['d']) . ' ' . $btn('normal', 'C\'est normal', '<input type="hidden" name="f" value="' . esc_attr($x['f']) . '">', 'button button-small'));
        }
        foreach ((array) $s['err'] as $e) mc_sec_row('warn', 'Contrôle incomplet', esc_html($e) . ' Nouvel essai demain.');
    }
    echo '</tbody></table>';

    // --- Connexion
    $j = (array) get_option('mc_sec_journal', []);
    $blk = count(array_filter($j, function ($l) { return is_array($l) && $l[1] === 'blocage'; }));
    echo '<h2>Connexion à l\'administration</h2><table class="widefat striped" style="max-width:1100px"><tbody>';
    mc_sec_row('ok', 'Essais limités', '5 mots de passe ratés en 15 min : la connexion est bloquée 20 min pour cet appareil (24 h en cas de récidive). ' . ($blk ? '<b>' . $blk . ' blocage(s)</b> de robots ces 30 derniers jours.' : 'Aucun blocage ces 30 derniers jours.'));
    mc_sec_row('ok', 'Message d\'erreur neutre', 'Le site ne dit jamais si un identifiant existe ; « mot de passe oublié » limité à 5 demandes par heure.');
    $names = get_users(['fields' => ['ID', 'user_login', 'display_name'], 'role__in' => ['administrator', 'editor', 'author', 'contributor', 'shop_manager']]);
    foreach ($names as $o) {
        $on = mc_2fa_on($o->ID);
        $txt = $on ? 'Double vérification activée (code du téléphone demandé à chaque connexion).' : 'Double vérification <b>non activée</b>.';
        if (strtolower($o->user_login) === 'admin') $txt .= ' L\'identifiant « admin » est le premier essayé par les robots : mot de passe long et unique obligatoire (et double vérification conseillée).';
        if ((int) $o->ID !== (int) $u->ID && $on) $txt .= ' ' . $btn('2fa_reset', 'Retirer (téléphone perdu)', '<input type="hidden" name="uid" value="' . (int) $o->ID . '">', 'button button-small');
        mc_sec_row($on ? 'ok' : 'info', 'Compte « ' . $o->user_login . ' »' . ((int) $o->ID === (int) $u->ID ? ' (vous)' : ''), $txt);
    }
    echo '</tbody></table>';
    // Double vérification du compte connecté
    echo '<div style="max-width:1100px;background:#fff;border:1px solid #c3c4c7;padding:4px 18px 14px;margin-top:12px"><h3>Ma double vérification (compte « ' . esc_html($u->user_login) . ' »)</h3>';
    if (mc_2fa_on($u->ID)) {
        $left = count((array) get_user_meta($u->ID, 'mc_2fa_codes', true));
        echo '<p><span class="dashicons dashicons-yes-alt" style="color:#1f8a4c"></span> Activée. Codes de secours restants : <b>' . (int) $left . '</b>.</p>';
        $field = '<input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="code du téléphone" required style="width:170px;margin-right:6px">';
        echo $btn('2fa_codes', 'Créer de nouveaux codes de secours', $field) . $btn('2fa_off', 'Désactiver', $field);
    } elseif (defined('MC_2FA_OFF') && MC_2FA_OFF) {
        echo '<p>Coupée pour dépannage (MC_2FA_OFF dans wp-config.php). À retirer de wp-config.php dès que possible.</p>';
    } else {
        $sec = (string) get_user_meta($u->ID, 'mc_2fa_pending', true);
        if ($sec === '') { $sec = mc_b32_encode(random_bytes(20)); update_user_meta($u->ID, 'mc_2fa_pending', $sec); }
        $host = (string) wp_parse_url(home_url('/'), PHP_URL_HOST);
        $uri = 'otpauth://totp/' . rawurlencode("Moto's Cool:" . $u->user_login . '@' . $host) . '?secret=' . $sec . '&issuer=' . rawurlencode("Moto's Cool");
        echo '<p style="font-size:14px">Après le mot de passe, WordPress demandera aussi un code à 6 chiffres affiché par le téléphone. Même si un pirate trouve le mot de passe, il ne peut pas entrer.</p><ol style="font-size:14px">'
            . '<li>Sur le téléphone, installer l\'application gratuite <b>Google Authenticator</b> (ou Microsoft Authenticator).</li>'
            . '<li>Dans l\'application : <b>+</b> → <b>Scanner un code QR</b> → scanner ce code :<div id="mc-qr" data-uri="' . esc_attr($uri) . '" style="margin:8px 0;width:220px;height:220px;background:#fff"></div>'
            . '<span style="color:#646970">Pas d\'appareil photo ? Choisir « Saisir une clé » et taper : <code style="font-size:14px">' . esc_html(trim(chunk_split($sec, 4, ' '))) . '</code></span></li>'
            . '<li>Taper ci-dessous le code à 6 chiffres affiché par l\'application, puis <b>Activer</b>. Des codes de secours s\'afficheront : les noter.</li></ol>';
        echo $btn('2fa_on', 'Activer la double vérification', '<input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" required style="width:120px;margin-right:6px">', 'button button-primary');
        echo '<script>document.addEventListener("DOMContentLoaded",function(){var e=document.getElementById("mc-qr");if(!e||typeof qrcode!=="function")return;var q=qrcode(0,"M");q.addData(e.getAttribute("data-uri"));q.make();e.innerHTML=q.createSvgTag({cellSize:5,margin:4,scalable:true});var s=e.querySelector("svg");if(s){s.style.width="100%";s.style.height="100%";}});</script>';
    }
    echo '</div>';

    // --- Protections du site
    $ht = get_option('mc_ht_etat'); $ht = is_array($ht) ? $ht : [];
    $lbl = ['ok' => ['ok', 'En place et testée.'], 'sans-effet' => ['warn', 'Le serveur ignore cette règle (rien de cassé).'], 'retire' => ['warn', 'Retirée automatiquement : le serveur la refusait (rien de cassé).'], 'non-modifiable' => ['warn', 'Fichier du serveur non modifiable.'], 'non-ecrit' => ['warn', 'Fichier du serveur non modifiable.'], 'test-impossible' => ['warn', 'Test impossible au moment de l\'installation.']];
    $st = function ($k, $okText) use ($ht, $lbl) { $v = isset($ht[$k]) ? $ht[$k] : ''; if ($v === 'ok') return ['ok', $okText]; if (isset($lbl[$v])) return $lbl[$v]; return ['warn', 'Pas encore appliquée (se fait à la prochaine visite de l\'administration).']; };
    echo '<h2>Protections du site</h2><table class="widefat striped" style="max-width:1100px"><tbody>';
    $x = $st('images', 'Aucun programme ne peut être lancé depuis le dossier des images (vérifié avec un fichier témoin).'); mc_sec_row($x[0], 'Dossier des images', $x[1]);
    $x = $st('fichiers', 'Fichiers sensibles du serveur (configuration, sauvegardes, journaux, XML-RPC, version de WordPress) interdits au public.'); mc_sec_row($x[0], 'Fichiers sensibles', $x[1]);
    $x = $st('dossiers', 'Le contenu des dossiers du serveur ne peut pas être listé.'); mc_sec_row($x[0], 'Liste des dossiers', $x[1]);
    $https = get_option('mc_https_ok') === '1';
    mc_sec_row($https ? 'ok' : 'warn', 'Connexion chiffrée (https)', $https ? 'Toutes les visites passent en https (cadenas), le navigateur retient de toujours l\'utiliser.' : 'Vérification https pas encore faite ou pas possible (elle se refait chaque jour).');
    mc_sec_row('ok', 'Protections du navigateur', 'Le site ne peut pas être affiché dans un autre site (anti-piège au clic), fichiers non détournables, caméra/micro/paiement interdits aux pages.');
    mc_sec_row('ok', 'Discrétion', 'Version de WordPress et de PHP cachées, noms des comptes cachés (API, pages d\'auteur), XML-RPC fermé.');
    mc_sec_row('ok', 'Administration verrouillée', 'Modification du code depuis WordPress impossible, inscriptions fermées, accès à distance par « mots de passe d\'application » coupé, commentaires fermés.');
    mc_sec_row('ok', 'Formulaire de rendez-vous', 'Anti-robots (champ piège + nombre d\'envois limité), données vérifiées, lien « Libérer la place » signé.');
    echo '</tbody></table>';

    // --- Versions
    echo '<h2>Mises à jour (à faire par SYZ, après test)</h2><table class="widefat striped" style="max-width:1100px"><tbody>';
    $php = PHP_VERSION;
    if (version_compare($php, '8.1', '>=')) mc_sec_row('ok', 'PHP ' . esc_html($php), 'Version suivie.');
    else mc_sec_row(version_compare($php, '7.4', '<') ? 'bad' : 'warn', 'PHP ' . esc_html($php), 'Version qui ne reçoit plus de correctifs de sécurité. Passage à PHP 8 à faire avec SYZ, testé avant (ne pas changer seul : le site pourrait ne plus s\'afficher).');
    $core = get_site_transient('update_core');
    $wpnew = '';
    if (is_object($core) && !empty($core->updates)) foreach ($core->updates as $up) if (isset($up->response) && $up->response === 'upgrade') { $wpnew = $up->current; break; }
    global $wp_version;
    mc_sec_row($wpnew ? 'warn' : 'ok', 'WordPress ' . esc_html($wp_version), $wpnew ? 'La version ' . esc_html($wpnew) . ' existe. <b>Ne pas cliquer sur « Mettre à jour »</b> : SYZ la teste d\'abord avec le site.' : 'À jour.');
    $pu = get_site_transient('update_plugins');
    if (!function_exists('get_plugins')) require_once ABSPATH . 'wp-admin/includes/plugin.php';
    $inactive = [];
    foreach (get_plugins() as $pf => $pd) {
        $new = (is_object($pu) && isset($pu->response[$pf]->new_version)) ? $pu->response[$pf]->new_version : '';
        $active = is_plugin_active($pf);
        if (!$active) { $inactive[] = $pd['Name']; continue; }
        if (!is_object($pu) || empty($pu->last_checked)) { mc_sec_row('info', 'Extension ' . $pd['Name'] . ' ' . $pd['Version'], 'Recherche de mises à jour pas encore faite par WordPress.'); continue; }
        mc_sec_row($new ? 'warn' : 'ok', 'Extension ' . $pd['Name'] . ' ' . $pd['Version'], $new ? 'La version ' . esc_html($new) . ' existe (corrige souvent des failles). À faire par SYZ après test.' : 'À jour.');
    }
    if ($inactive) mc_sec_row('info', 'Extensions désactivées', esc_html(implode(', ', $inactive)) . ' : inutilisées, elles peuvent être supprimées (Extensions → Supprimer) pour réduire les risques.');
    $dbg = (defined('WP_DEBUG') && WP_DEBUG) && (!defined('WP_DEBUG_DISPLAY') || WP_DEBUG_DISPLAY);
    mc_sec_row($dbg ? 'bad' : 'ok', 'Mode débogage', $dbg ? 'Activé : les erreurs s\'affichent aux visiteurs. À couper dans wp-config.php (WP_DEBUG à false).' : 'Coupé (aucune erreur technique affichée aux visiteurs).');
    mc_sec_row('info', 'Sauvegardes', 'Hébergement OVH : vérifier dans l\'espace client que les sauvegardes automatiques sont actives. C\'est la vraie assurance : en cas de problème, le site est remis comme avant.');
    echo '</tbody></table>';

    // --- Journal
    echo '<h2>Journal (30 derniers jours)</h2><table class="widefat striped" style="max-width:1100px"><tbody>';
    if (!$j) echo '<tr><td>Rien à signaler.</td></tr>';
    foreach (array_slice($j, 0, 30) as $l) if (is_array($l)) echo '<tr><td style="width:150px">' . esc_html(wp_date('d/m/Y H:i', (int) $l[0])) . '</td><td>' . esc_html($l[2]) . '</td></tr>';
    echo '</tbody></table></div>';
}
// Lien depuis la page des réglages des rendez-vous et depuis le profil
add_action('show_user_profile', function ($user) {
    if (!current_user_can('manage_options')) return;
    echo '<h2>Double vérification</h2><p>' . (mc_2fa_on($user->ID) ? 'Activée.' : 'Non activée.') . ' <a href="' . esc_url(admin_url('options-general.php?page=mc-securite')) . '">Réglages → Moto\'s Cool Sécurité</a></p>';
});
