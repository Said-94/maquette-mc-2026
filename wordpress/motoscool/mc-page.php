<?php
/**
 * Page Moto's Cool : structure d'origine du site (en-tête, styles, scripts), contenu de la page WordPress
 * (blocs modifiables dans Elementor), en-tête et pied de page venant des Modèles Elementor.
 */
if (!defined('ABSPATH')) exit;
$mc_id = get_queried_object_id();
$mc = mc_page_data(mc_key_of($mc_id));
if (!$mc) { status_header(404); exit; }
$mc_url = mc_url_of_key($mc['key']);
$mc_edit = mc_is_editor_preview() || is_preview();
?><!DOCTYPE html>
<html <?php echo $mc['htmlAttrs']; ?>>
<head>
<?php echo $mc['headFirst']; ?>
<?php wp_head(); ?>
<?php echo mc_fix_scripts(mc_fix_html($mc_edit || !function_exists('mc_head_without_faq') ? $mc['head'] : mc_head_without_faq($mc['head']))); /* FAQ pour Google : construite plus bas, d'après la FAQ affichée */ ?>
<?php if (!did_action('rank_math/head') && !did_action('wpseo_head')) echo mc_fix_html(preg_replace('#[ \t]*<title>[\s\S]*?</title>\n?#', '', $mc['seo']['tags'])); /* description, canonique, partage : ceux du site si aucune extension SEO ne les écrit */ ?>
<?php if ($mc_edit) : ?>
<script>window.MC_PREVIEW = true; /* aperçu de l'éditeur : les scripts du site attendent l'affichage des blocs */</script>
<style>/* Éditeur Elementor : les enveloppes d'Elementor n'ajoutent aucun espace aux blocs Moto's Cool */
.mc-s .elementor-widget:not(:last-child){margin-bottom:0}.mc-s>.elementor-container>.elementor-column>.elementor-widget-wrap{padding:0}
.mc-s{width:100%}</style>
<?php endif; ?>
</head>
<body <?php body_class(); ?><?php echo $mc['bodyAttrs'] !== '' ? ' ' . preg_replace('/\bclass="[^"]*"/', '', $mc['bodyAttrs']) : ''; ?>>
<?php if (function_exists('wp_body_open')) wp_body_open(); ?>
<?php
echo mc_fix_html($mc['pre']);
echo mc_fix_html(mc_template_html($mc['header'], $mc_url));
echo mc_fix_html($mc['mid']);
echo $mc['mainOpen'];
if ($mc_edit) { while (have_posts()) { the_post(); the_content(); } }
else { $mc_main = mc_fix_html(mc_render_el_data($mc_id)); echo "\n  " . $mc_main . "\n  "; }
echo '</main>';
echo mc_fix_html($mc['afterMain']);
$mc_foot = mc_template_html($mc['footer'], $mc_url);
if (!empty($mc['footerCredit'])) { // mentions légales : ligne discrète tout en bas
    $mc_f2 = preg_replace('#(</ul>)(\s*</div>\s*</footer>)#', '$1' . "\n      " . $mc['footerCredit'] . '$2', $mc_foot, 1, $mc_n);
    $mc_foot = $mc_n ? $mc_f2 : str_replace('</footer>', $mc['footerCredit'] . '</footer>', $mc_foot);
}
echo mc_fix_html($mc_foot);
echo mc_fix_scripts(mc_fix_html($mc['post']));
if (!$mc_edit && isset($mc_main) && function_exists('mc_faq_jsonld')) echo mc_faq_jsonld($mc_main);
wp_footer();
?>
</body>
</html>
