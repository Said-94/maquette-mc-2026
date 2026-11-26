<?php
/**
 * Vidéos du site : menu « Vidéos » dans WordPress.
 * Fichier vidéo envoyé en petits morceaux (sous la limite d'envoi de l'hébergement : aucune taille bloquée),
 * ou lien YouTube / TikTok. Affichées dans la partie « Vidéos » de l'accueil.
 */
if (!defined('ABSPATH')) exit;

define('MC_VIDEO_MAX', 4 * 1024 * 1024 * 1024); // 4 Go par vidéo
define('MC_VIDEO_EXT', 'mp4,m4v,mov,webm');

add_action('init', function () {
    register_post_type('mc_video', [
        'labels' => ['name' => 'Vidéos', 'singular_name' => 'Vidéo', 'menu_name' => 'Vidéos', 'add_new' => 'Ajouter une vidéo', 'add_new_item' => 'Ajouter une vidéo',
            'edit_item' => 'Modifier la vidéo', 'new_item' => 'Nouvelle vidéo', 'view_item' => 'Voir la vidéo', 'search_items' => 'Chercher une vidéo',
            'not_found' => 'Aucune vidéo pour le moment', 'not_found_in_trash' => 'Aucune vidéo dans la corbeille', 'all_items' => 'Toutes les vidéos', 'featured_image' => 'Image d\'aperçu (facultatif)',
            'set_featured_image' => 'Choisir l\'image d\'aperçu', 'remove_featured_image' => 'Retirer l\'image d\'aperçu', 'use_featured_image' => 'Utiliser comme image d\'aperçu'],
        'public' => false, 'show_ui' => true, 'show_in_menu' => true, 'show_in_rest' => false, 'menu_position' => 21, 'menu_icon' => 'dashicons-video-alt3',
        'supports' => ['title', 'thumbnail', 'page-attributes'], 'capability_type' => 'post', 'map_meta_cap' => true,
    ]);
});

/* ---------- Liste des vidéos (ordre d'affichage) ---------- */
function mc_videos_list() {
    return get_posts(['post_type' => 'mc_video', 'post_status' => 'publish', 'numberposts' => 30, 'orderby' => ['menu_order' => 'ASC', 'date' => 'DESC'], 'suppress_filters' => false]);
}
function mc_video_source($id) {
    $att = (int) get_post_meta($id, '_mc_video_fichier', true);
    if ($att && ($u = wp_get_attachment_url($att))) return ['type' => 'file', 'url' => $u];
    $l = trim((string) get_post_meta($id, '_mc_video_lien', true));
    if ($l === '') return null;
    if (preg_match('~(?:youtube\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/)|youtu\.be/)([\w-]{11})~', $l, $m)) return ['type' => 'youtube', 'id' => $m[1], 'url' => $l];
    if (preg_match('~tiktok\.com/(?:@[\w.-]+/video|embed(?:/v2)?|v)/(\d{8,25})~', $l, $m)) return ['type' => 'tiktok', 'id' => $m[1], 'url' => $l];
    if (preg_match('~^https?://[^?#\s]+\.(?:mp4|webm|m4v|mov)(?:[?#].*)?$~i', $l)) return ['type' => 'file', 'url' => $l]; // lien direct vers un fichier vidéo : lu sur la page
    if (preg_match('~^https?://~i', $l)) return ['type' => 'link', 'url' => $l];
    return null;
}

function mc_videos_count() {
    static $n = null;
    if ($n === null) { $n = 0; foreach (mc_videos_list() as $p) if (mc_video_source($p->ID)) $n++; }
    return $n;
}
// Première installation : les films 3D de l'atelier déjà présents sur le site sont ajoutés au menu « Vidéos »
// (la partie Vidéos est ainsi visible tout de suite ; le garage peut les retirer ou en ajouter d'autres)
function mc_seed_videos() {
    if (get_option('mc_videos_seed') === '1') return;
    if (function_exists('mc_ready') && !mc_ready()) return; // fichiers du site pas encore tous téléchargés : plus tard
    if (get_posts(['post_type' => 'mc_video', 'post_status' => 'any', 'numberposts' => 1, 'fields' => 'ids'])) { update_option('mc_videos_seed', '1', false); return; }
    $list = [['atelier-visite', "Film 3D : l'atelier Moto's Cool à Vitry-sur-Seine"], ['atelier-reparation', 'Film 3D : une moto sur le pont élévateur'],
        ['atelier-pneu', 'Film 3D : la machine de montage des pneus'], ['atelier-demontage', "Film 3D : une moto démontée pour réparation"]];
    $o = 0;
    foreach ($list as $it) {
        if (!is_file(MC_DIR . '/assets/video/' . $it[0] . '.mp4')) continue;
        $id = wp_insert_post(['post_type' => 'mc_video', 'post_status' => 'publish', 'post_title' => $it[1], 'menu_order' => ++$o], true);
        if (is_wp_error($id) || !$id) continue;
        update_post_meta($id, '_mc_video_lien', home_url('/assets/video/' . $it[0] . '.mp4'));
        update_post_meta($id, '_mc_video_image', home_url('/assets/video/' . $it[0] . '.webp'));
    }
    update_option('mc_videos_seed', '1', false);
}

add_action('admin_init', function () { if (get_option('mc_videos_seed') !== '1' && current_user_can('edit_posts') && !wp_doing_ajax()) mc_seed_videos(); }, 60);

/* ---------- Partie « Vidéos » sur le site ---------- */
// Style de la partie Vidéos : dans l'en-tête de la page (HTML valide), seulement sur l'accueil
add_action('wp_head', function () {
    if (!function_exists('mc_mode') || !mc_mode() || !is_page() || mc_key_of(get_queried_object_id()) !== 'accueil') return;
    echo '<style id="mc-videos-css">' . "
" . '      .mc-videos .vgrid{list-style:none;margin:30px 0 0;padding:0;display:grid;gap:18px;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
      .mc-videos .vcard{margin:0;background:var(--bg-2,#3a3a42);border:1px solid var(--line,rgba(255,255,255,.1));border-radius:18px;overflow:hidden}
      .mc-videos .vcard video,.mc-videos .vcard iframe,.mc-videos .vplay{display:block;width:100%;aspect-ratio:16/9;border:0;background:#1d1d22}
      .mc-videos .vplay.vtall,.mc-videos iframe.vtall{aspect-ratio:9/16;max-height:640px}
      .mc-videos .vplay{position:relative;cursor:pointer;padding:0;color:#fff;font:inherit;text-decoration:none}
      .mc-videos .vplay img{width:100%;height:100%;object-fit:cover;display:block}
      .mc-videos .vplay::after{content:"";position:absolute;left:50%;top:50%;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:rgba(217,43,34,.92) url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 24 24%27%3E%3Cpath fill=%27%23fff%27 d=%27M8 5v14l11-7z%27/%3E%3C/svg%3E") center/30px no-repeat;box-shadow:0 0 24px rgba(217,43,34,.6)}
      .mc-videos .vbadge{position:absolute;left:12px;top:12px;background:rgba(0,0,0,.6);border-radius:999px;padding:4px 10px;font-size:.8rem;font-weight:700}
      .mc-videos .vlogo{display:grid;place-items:center;height:100%;font-weight:800;font-size:1.4rem;opacity:.7}
      .mc-videos figcaption{padding:12px 16px;font-weight:700;color:var(--text,#fff)}' . "
" . '</style>' . "
";
});
function mc_videos_html($s) {
    $items = [];
    foreach (mc_videos_list() as $v) {
        $src = mc_video_source($v->ID);
        if (!$src) continue;
        $t = get_the_title($v);
        $thumb = get_the_post_thumbnail_url($v, 'large') ?: (string) get_post_meta($v->ID, '_mc_video_image', true);
        $cap = '<figcaption>' . esc_html($t) . '</figcaption>';
        if ($src['type'] === 'file') $media = '<video controls playsinline preload="' . ($thumb ? 'none' : 'metadata') . '" src="' . esc_url($src['url']) . '"' . ($thumb ? ' poster="' . esc_url($thumb) . '"' : '') . ' aria-label="' . esc_attr($t) . '"></video>';
        elseif ($src['type'] === 'youtube') $media = '<button type="button" class="vplay" data-embed="' . esc_attr('https://www.youtube-nocookie.com/embed/' . $src['id'] . '?autoplay=1&rel=0') . '" aria-label="' . esc_attr('Lire la vidéo : ' . $t) . '"><img src="' . esc_url($thumb ?: 'https://i.ytimg.com/vi/' . $src['id'] . '/hqdefault.jpg') . '" alt="" loading="lazy" decoding="async"><span class="vbadge">YouTube</span></button>';
        elseif ($src['type'] === 'tiktok') $media = '<button type="button" class="vplay vtall" data-embed="' . esc_attr('https://www.tiktok.com/embed/v2/' . $src['id']) . '" aria-label="' . esc_attr('Lire la vidéo : ' . $t) . '">' . ($thumb ? '<img src="' . esc_url($thumb) . '" alt="" loading="lazy" decoding="async">' : '<span class="vlogo">TikTok</span>') . '<span class="vbadge">TikTok</span></button>';
        else $media = '<a class="vplay" href="' . esc_url($src['url']) . '" target="_blank" rel="noopener">' . ($thumb ? '<img src="' . esc_url($thumb) . '" alt="" loading="lazy">' : '<span class="vlogo">Vidéo</span>') . '<span class="vbadge">Voir</span></a>';
        $items[] = '<li><figure class="vcard">' . $media . $cap . '</figure></li>';
    }
    $s = is_array($s) ? $s : [];
    $g = function ($k, $d) use ($s) { return isset($s[$k]) && is_scalar($s[$k]) ? (string) $s[$k] : $d; };
    $intro = $g('intro', "Nos interventions, l'atelier et la vie du garage en images.");
    if (!$items) return mc_is_editor_preview() ? '<section class="mc-videos-vide" style="padding:40px 20px;text-align:center;color:#aaa;border:1px dashed #666;margin:20px">Partie « Vidéos » : aucune vidéo publiée pour le moment. Ajoutez-en dans le menu <b>Vidéos</b> de WordPress : elle apparaîtra ici.</section>' : '';
    return '<section class="has-fx mc-videos" id="videos" aria-labelledby="videos-title">
    <div class="wrap">
      <span class="kicker rv">' . esc_html($g('kicker', 'Vidéos')) . '</span>
      <h2 class="rv" id="videos-title">' . esc_html($g('titre', "L'atelier en vidéo.")) . '</h2>
      ' . ($intro !== '' ? '<p class="lead rv">' . esc_html($intro) . '</p>' : '') . '
      <ul class="vgrid rv">' . implode('', $items) . '</ul>
    </div>
    <script>document.querySelectorAll(".mc-videos .vplay[data-embed]").forEach(function (b) { b.addEventListener("click", function () { var f = document.createElement("iframe"); f.src = b.getAttribute("data-embed"); f.title = b.getAttribute("aria-label") || "Vidéo"; f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen"; f.allowFullscreen = true; if (b.classList.contains("vtall")) f.className = "vtall"; b.replaceWith(f); }); });</script>
  </section>';
}

/* ---------- Écran « Ajouter une vidéo » ---------- */
add_action('add_meta_boxes', function () {
    add_meta_box('mc_video_box', 'La vidéo', 'mc_video_box', 'mc_video', 'normal', 'high');
});
function mc_video_chunk_size() { return (int) max(256 * 1024, min(4 * 1024 * 1024, floor(wp_max_upload_size() * 0.7))); }
function mc_video_box($post) {
    wp_nonce_field('mc_video_save', 'mc_video_nonce');
    $att = (int) get_post_meta($post->ID, '_mc_video_fichier', true);
    $url = $att ? wp_get_attachment_url($att) : '';
    $lien = (string) get_post_meta($post->ID, '_mc_video_lien', true);
    ?>
    <p><b>1. Un fichier vidéo depuis l'ordinateur</b> (MP4 conseillé — toutes les tailles passent, l'envoi se fait en petits morceaux)</p>
    <div id="mc-v-current"><?php if ($url) echo '<video src="' . esc_url($url) . '" controls preload="metadata" style="max-width:420px;width:100%;border-radius:8px;background:#000"></video><br><code>' . esc_html(wp_basename($url)) . '</code>'; ?></div>
    <p><input type="file" id="mc-v-file" accept="video/mp4,video/quicktime,video/webm,.mp4,.m4v,.mov,.webm">
       <button type="button" class="button button-primary" id="mc-v-send">Envoyer la vidéo</button></p>
    <div id="mc-v-bar" style="display:none;max-width:420px;height:14px;background:#ddd;border-radius:7px;overflow:hidden"><div style="height:100%;width:0;background:#d92b22;transition:width .2s"></div></div>
    <p id="mc-v-msg" style="font-weight:600"></p>
    <p class="description">Sur iPhone, pour une vidéo lisible sur tous les téléphones et ordinateurs : Réglages › Appareil photo › Formats › « Le plus compatible ». Les très longues vidéos se lisent mieux sur YouTube (lien ci-dessous).</p>
    <hr>
    <p><label for="mc-v-lien"><b>2. Ou un lien YouTube / TikTok</b></label></p>
    <p><input type="url" class="large-text" name="mc_video_lien" id="mc-v-lien" value="<?php echo esc_attr($lien); ?>" placeholder="https://www.youtube.com/watch?v=…  ou  https://www.tiktok.com/@motos.cool/video/…"></p>
    <p class="description">Si un fichier est envoyé, c'est lui qui est affiché. Pour retirer le fichier : <label><input type="checkbox" name="mc_video_retirer" value="1"> retirer le fichier vidéo</label>.</p>
    <p class="description">Titre (en haut) = légende sous la vidéo. Image d'aperçu (à droite) : facultative. Ordre d'affichage : « Attributs › Ordre » (0 = en premier). Cliquez sur <b>Publier</b> pour l'afficher sur le site.</p>
    <script>
    (function () {
      var btn = document.getElementById('mc-v-send'), inp = document.getElementById('mc-v-file'), msg = document.getElementById('mc-v-msg'), bar = document.getElementById('mc-v-bar'), fill = bar.firstElementChild;
      var CH = <?php echo (int) mc_video_chunk_size(); ?>, POST = <?php echo (int) $post->ID; ?>, NONCE = <?php echo wp_json_encode(wp_create_nonce('mc_video_' . $post->ID)); ?>, AJAX = <?php echo wp_json_encode(admin_url('admin-ajax.php')); ?>;
      var EXT = <?php echo wp_json_encode(explode(',', MC_VIDEO_EXT)); ?>, MAX = <?php echo (int) MC_VIDEO_MAX; ?>;
      function say(t, ok) { msg.textContent = t; msg.style.color = ok === false ? '#b32d2e' : (ok ? '#1f7a3a' : ''); }
      function send(fd, tries) {
        return fetch(AJAX, { method: 'POST', body: fd, credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return { ok: false, msg: 'Réponse inattendue du serveur (' + r.status + ')' }; }); })
          .catch(function () { return { ok: false, retry: true, msg: 'Connexion interrompue' }; })
          .then(function (j) { if ((!j || !j.ok) && tries > 0 && (!j || j.retry !== false)) return new Promise(function (res) { setTimeout(res, 1500); }).then(function () { return send(fd, tries - 1); }); return j; });
      }
      btn.addEventListener('click', function () {
        var f = inp.files && inp.files[0];
        if (!f) return say('Choisissez d\'abord un fichier vidéo.', false);
        var ext = (f.name.split('.').pop() || '').toLowerCase();
        if (EXT.indexOf(ext) < 0) return say('Format non accepté : choisissez une vidéo MP4, MOV ou WEBM.', false);
        if (f.size > MAX) return say('Vidéo trop lourde (plus de 4 Go) : mettez-la plutôt sur YouTube et collez le lien ci-dessous.', false);
        var total = Math.max(1, Math.ceil(f.size / CH)), uid = (Date.now().toString(16) + Math.random().toString(16).slice(2)).replace(/[^0-9a-f]/g, '').slice(0, 24), i = 0;
        btn.disabled = true; inp.disabled = true; bar.style.display = 'block'; say('Envoi en cours… ne fermez pas cette page.');
        (function next() {
          var fd = new FormData();
          fd.append('action', 'mc_video_chunk'); fd.append('post_id', POST); fd.append('nonce', NONCE); fd.append('uid', uid);
          fd.append('idx', i); fd.append('total', total); fd.append('name', f.name); fd.append('size', f.size);
          fd.append('chunk', f.slice(i * CH, Math.min(f.size, (i + 1) * CH)), 'morceau');
          send(fd, 4).then(function (j) {
            if (!j || !j.ok) { btn.disabled = false; inp.disabled = false; return say('L\'envoi a échoué : ' + ((j && j.msg) || 'erreur inconnue') + '. Réessayez.', false); }
            i++; fill.style.width = Math.round(100 * i / total) + '%';
            if (i < total) { say('Envoi en cours… ' + Math.round(100 * i / total) + ' % — ne fermez pas cette page.'); return next(); }
            btn.disabled = false; inp.disabled = false; inp.value = '';
            document.getElementById('mc-v-current').innerHTML = '<video src="' + j.url + '" controls preload="metadata" style="max-width:420px;width:100%;border-radius:8px;background:#000"></video>';
            say('Vidéo envoyée. Cliquez sur « Publier » (ou « Mettre à jour ») pour l\'afficher sur le site.', true);
          });
        })();
      });
    })();
    </script>
    <?php
}
add_action('save_post_mc_video', function ($id) {
    if (!isset($_POST['mc_video_nonce']) || !wp_verify_nonce($_POST['mc_video_nonce'], 'mc_video_save') || !current_user_can('edit_post', $id) || wp_is_post_revision($id)) return;
    $l = isset($_POST['mc_video_lien']) ? esc_url_raw(trim(wp_unslash($_POST['mc_video_lien']))) : '';
    update_post_meta($id, '_mc_video_lien', $l);
    if (!empty($_POST['mc_video_retirer'])) { $att = (int) get_post_meta($id, '_mc_video_fichier', true); if ($att) wp_delete_attachment($att, true); delete_post_meta($id, '_mc_video_fichier'); }
});
add_action('before_delete_post', function ($id) {
    if (get_post_type($id) !== 'mc_video') return;
    $att = (int) get_post_meta($id, '_mc_video_fichier', true);
    if ($att) wp_delete_attachment($att, true);
});

/* ---------- Réception des morceaux ---------- */
function mc_video_dir() { $u = wp_upload_dir(); return ['dir' => $u['basedir'] . '/mc-videos', 'url' => $u['baseurl'] . '/mc-videos', 'rel' => 'mc-videos']; }
add_action('wp_ajax_mc_video_chunk', function () {
    $fail = function ($m, $retry = false) { wp_send_json(['ok' => false, 'msg' => $m, 'retry' => $retry]); };
    $post = (int) ($_POST['post_id'] ?? 0);
    if (!$post || get_post_type($post) !== 'mc_video' || !current_user_can('edit_post', $post)) $fail('accès refusé');
    if (!wp_verify_nonce((string) ($_POST['nonce'] ?? ''), 'mc_video_' . $post)) $fail('session expirée : rechargez la page');
    $uid = (string) ($_POST['uid'] ?? ''); $idx = (int) ($_POST['idx'] ?? -1); $total = (int) ($_POST['total'] ?? 0);
    $name = sanitize_file_name(wp_unslash((string) ($_POST['name'] ?? 'video.mp4'))); $size = (int) ($_POST['size'] ?? 0);
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!preg_match('/^[0-9a-f]{12,24}$/', $uid) || $idx < 0 || $total < 1 || $idx >= $total || $size < 1 || $size > MC_VIDEO_MAX || !in_array($ext, explode(',', MC_VIDEO_EXT), true)) $fail('demande invalide');
    if (empty($_FILES['chunk']) || !is_uploaded_file($_FILES['chunk']['tmp_name']) || (int) $_FILES['chunk']['error'] !== 0) $fail('morceau non reçu (' . (int) ($_FILES['chunk']['error'] ?? -1) . ')', true);
    $d = mc_video_dir();
    if (!wp_mkdir_p($d['dir'])) $fail('dossier des vidéos impossible à créer');
    if (!is_file($d['dir'] . '/index.php')) @file_put_contents($d['dir'] . '/index.php', "<?php // Silence\n");
    $part = $d['dir'] . '/.envoi-' . $uid . '.part';
    $state = get_transient('mc_v_' . $uid);
    if ($idx === 0) { @unlink($part); $state = ['next' => 0, 'post' => $post, 'size' => $size, 'name' => $name]; }
    if (!is_array($state) || (int) $state['post'] !== $post || (int) $state['size'] !== $size) $fail('envoi interrompu : recommencez', false);
    if ($idx < (int) $state['next']) wp_send_json(['ok' => true, 'dup' => true]); // morceau déjà reçu (nouvel essai après une coupure)
    if ($idx > (int) $state['next']) $fail('morceau manquant : recommencez', false);
    // verrou : un même morceau renvoyé après une coupure n'est jamais écrit deux fois
    $lockf = fopen($part . '.lock', 'c'); if (!$lockf || !flock($lockf, LOCK_EX)) $fail('fichier occupé', true);
    $state = get_transient('mc_v_' . $uid); if ($idx === 0) $state = ['next' => 0, 'post' => $post, 'size' => $size, 'name' => $name];
    if (!is_array($state) || $idx !== (int) $state['next']) { flock($lockf, LOCK_UN); fclose($lockf); if (is_array($state) && $idx < (int) $state['next']) wp_send_json(['ok' => true, 'dup' => true]); $fail('envoi interrompu : recommencez', false); }
    clearstatcache(true, $part); $have = $idx === 0 ? 0 : (is_file($part) ? filesize($part) : -1);
    if ($have < 0 || $have + (int) $_FILES['chunk']['size'] > $size) { flock($lockf, LOCK_UN); fclose($lockf); @unlink($part); $fail('taille incohérente : recommencez', false); }
    $in = fopen($_FILES['chunk']['tmp_name'], 'rb'); $out = fopen($part, $idx === 0 ? 'wb' : 'ab');
    if (!$in || !$out) { flock($lockf, LOCK_UN); fclose($lockf); $fail('écriture impossible', true); }
    stream_copy_to_stream($in, $out); fclose($in); fclose($out);
    clearstatcache(true, $part);
    $state['next'] = $idx + 1; set_transient('mc_v_' . $uid, $state, 6 * HOUR_IN_SECONDS);
    flock($lockf, LOCK_UN); fclose($lockf);
    if ($idx + 1 >= $total) @unlink($part . '.lock');
    if ($idx + 1 < $total) wp_send_json(['ok' => true]);
    // Dernier morceau : contrôle et mise en place
    delete_transient('mc_v_' . $uid);
    if (filesize($part) !== $size) { @unlink($part); $fail('fichier incomplet : recommencez', false); }
    $h = fopen($part, 'rb'); $head = fread($h, 16); fclose($h);
    $isMp4 = substr($head, 4, 4) === 'ftyp'; $isWebm = substr($head, 0, 4) === "\x1A\x45\xDF\xA3";
    if (!$isMp4 && !$isWebm) { @unlink($part); $fail('ce fichier n\'est pas une vidéo MP4, MOV ou WEBM', false); }
    $final = wp_unique_filename($d['dir'], $name);
    if (!@rename($part, $d['dir'] . '/' . $final)) { @unlink($part); $fail('enregistrement impossible', false); }
    $mime = $isWebm ? 'video/webm' : ($ext === 'mov' ? 'video/quicktime' : 'video/mp4');
    $old = (int) get_post_meta($post, '_mc_video_fichier', true);
    $att = wp_insert_attachment(['post_mime_type' => $mime, 'post_title' => preg_replace('/\.[^.]+$/', '', $final), 'post_status' => 'inherit', 'guid' => $d['url'] . '/' . $final], $d['dir'] . '/' . $final, $post);
    if (is_wp_error($att) || !$att) $fail('enregistrement impossible', false);
    update_post_meta($att, '_wp_attached_file', $d['rel'] . '/' . $final);
    update_post_meta($post, '_mc_video_fichier', $att);
    if ($old && $old !== $att) wp_delete_attachment($old, true);
    wp_send_json(['ok' => true, 'url' => wp_get_attachment_url($att)]);
});
// Envois abandonnés : morceaux de plus d'un jour supprimés
add_action('mc_video_menage', function () {
    $d = mc_video_dir();
    foreach ((array) glob($d['dir'] . '/.envoi-*.part*') as $f) if (is_file($f) && filemtime($f) < time() - DAY_IN_SECONDS) @unlink($f);
});
add_action('init', function () { if (!wp_next_scheduled('mc_video_menage')) wp_schedule_event(time() + HOUR_IN_SECONDS, 'daily', 'mc_video_menage'); });
// Liste des vidéos : colonne « Vidéo »
add_filter('manage_mc_video_posts_columns', function ($c) { $n = []; foreach ($c as $k => $v) { $n[$k] = $v; if ($k === 'title') { $n['mc_type'] = 'Vidéo'; $n['menu_order'] = 'Ordre'; } } return $n; });
add_action('manage_mc_video_posts_custom_column', function ($col, $id) {
    if ($col === 'menu_order') echo (int) get_post_field('menu_order', $id);
    if ($col !== 'mc_type') return;
    $s = mc_video_source($id);
    echo $s ? esc_html(['file' => 'Fichier vidéo', 'youtube' => 'YouTube', 'tiktok' => 'TikTok', 'link' => 'Lien'][$s['type']]) : '<span style="color:#b32d2e">Aucune vidéo : ajoutez un fichier ou un lien</span>';
}, 10, 2);
