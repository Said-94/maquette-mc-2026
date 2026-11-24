<?php
/**
 * Modèle Moto's Cool (en-tête ou pied de page) ouvert dans Elementor : affiché avec les styles du site,
 * pour le modifier tel qu'il apparaît sur les pages.
 */
if (!defined('ABSPATH')) exit;
$mc_tk = (string) get_post_meta(get_queried_object_id(), '_mc_tpl', true);
$mc_t = mc_data('templates');
$mc = isset($mc_t[$mc_tk]) ? mc_page_data($mc_t[$mc_tk]['page']) : null;
if (!$mc) $mc = mc_page_data('accueil');
?><!DOCTYPE html>
<html <?php echo $mc['htmlAttrs']; ?>>
<head>
<?php echo $mc['headFirst']; ?>
<?php wp_head(); ?>
<?php echo mc_fix_html($mc['head']); ?>
<meta name="robots" content="noindex">
<style>.mc-s .elementor-widget:not(:last-child){margin-bottom:0}.mc-s>.elementor-container>.elementor-column>.elementor-widget-wrap{padding:0}
body{min-height:100vh}</style>
</head>
<body <?php body_class(); ?>>
<?php if (function_exists('wp_body_open')) wp_body_open(); ?>
<?php echo mc_fix_html($mc['pre']); ?>
<?php while (have_posts()) { the_post(); the_content(); } ?>
<?php wp_footer(); ?>
</body>
</html>
