<?php
// Bloc Moto's Cool dans Elementor : ses champs (textes, liens, photos, listes) et son mode « Code HTML »
if (!defined('ABSPATH')) exit;

class MC_Widget extends \Elementor\Widget_Base {
    public $mc = '';
    protected function mc_def() {
        $w = mc_data('widgets');
        return isset($w[$this->mc]) ? $w[$this->mc] : ['title' => $this->mc, 'kind' => 'bloc', 'fields' => [], 'reps' => [], 'code' => ''];
    }
    public function get_name() { return $this->mc; }
    public function get_title() { return "Moto's Cool · " . $this->mc_def()['title']; }
    public function get_icon() { $k = $this->mc_def()['kind']; return $k === 'texte' ? 'eicon-text' : ($k === 'videos' ? 'eicon-youtube' : 'eicon-site-identity'); }
    public function get_categories() { return ['motoscool']; }
    public function get_keywords() { return ['moto', 'motoscool', 'mc', 'bloc']; }

    protected function mc_ctrl($f) {
        $M = '\Elementor\Controls_Manager';
        switch ($f['t']) {
            case 'media':
                return ['label' => $f['label'], 'type' => \Elementor\Controls_Manager::MEDIA, 'default' => is_array($f['d']) ? $f['d'] : ['url' => (string) $f['d'], 'id' => ''],
                    'description' => 'Cliquez sur la photo pour en choisir une autre dans la médiathèque ou l\'envoyer depuis votre ordinateur.'];
            case 'link':
                return ['label' => $f['label'], 'type' => \Elementor\Controls_Manager::TEXT, 'default' => (string) $f['d'], 'label_block' => true,
                    'description' => 'Exemples : /services/depannage.html · tel:+33143762638 · https://…'];
            case 'html':
                return ['label' => $f['label'], 'type' => \Elementor\Controls_Manager::TEXTAREA, 'default' => (string) $f['d'], 'rows' => 4,
                    'description' => 'Mise en forme possible : &lt;b&gt;gras&lt;/b&gt;, &lt;em&gt;italique&lt;/em&gt;, &lt;br&gt; pour aller à la ligne.'];
            default:
                $long = function_exists('mb_strlen') ? mb_strlen((string) $f['d']) > 60 : strlen((string) $f['d']) > 60;
                return ['label' => $f['label'], 'type' => $long ? \Elementor\Controls_Manager::TEXTAREA : \Elementor\Controls_Manager::TEXT, 'default' => (string) $f['d'], 'label_block' => true, 'rows' => 3];
        }
    }

    protected function register_controls() {
        $d = $this->mc_def();
        $this->start_controls_section('mc_contenu', ['label' => 'Contenu', 'tab' => \Elementor\Controls_Manager::TAB_CONTENT]);
        if ($d['kind'] === 'texte') {
            $this->add_control('contenu', ['label' => 'Texte', 'type' => \Elementor\Controls_Manager::WYSIWYG, 'default' => '<h2>Votre titre</h2><p>Votre texte…</p>']);
            $this->add_control('classe', ['type' => \Elementor\Controls_Manager::HIDDEN, 'default' => '']);
            $this->add_control('enveloppe', ['type' => \Elementor\Controls_Manager::HIDDEN, 'default' => '']);
        } elseif ($d['kind'] === 'videos') {
            $this->add_control('kicker', ['label' => 'Surtitre', 'type' => \Elementor\Controls_Manager::TEXT, 'default' => 'Vidéos', 'label_block' => true]);
            $this->add_control('titre', ['label' => 'Titre', 'type' => \Elementor\Controls_Manager::TEXT, 'default' => "L'atelier en vidéo.", 'label_block' => true]);
            $this->add_control('intro', ['label' => 'Introduction', 'type' => \Elementor\Controls_Manager::TEXTAREA, 'default' => "Nos interventions, l'atelier et la vie du garage en images.", 'rows' => 3]);
            $this->add_control('aide', ['type' => \Elementor\Controls_Manager::RAW_HTML, 'raw' => 'Les vidéos s\'ajoutent, se retirent et se rangent dans le menu <b>Vidéos</b> de WordPress (à gauche). Sans vidéo publiée, cette partie n\'apparaît pas sur le site.', 'content_classes' => 'elementor-panel-alert elementor-panel-alert-info']);
        } else {
            foreach ($d['fields'] as $f) $this->add_control($f['k'], $this->mc_ctrl($f));
            foreach ($d['reps'] as $r) {
                $rep = new \Elementor\Repeater();
                $tf = $r['title'];
                foreach ($r['fields'] as $f) {
                    $rep->add_control($f['k'], $this->mc_ctrl($f));
                    if ($f['k'] === $tf && $f['t'] === 'media') $tf = '';
                }
                if ($tf === '') foreach ($r['fields'] as $f) if ($f['t'] !== 'media') { $tf = $f['k']; break; }
                $title = $tf === '' ? 'Photo' : '{{{ ' . $tf . ' }}}';
                $this->add_control($r['k'], ['label' => $r['label'], 'type' => \Elementor\Controls_Manager::REPEATER, 'fields' => $rep->get_controls(),
                    'default' => $r['def'], 'title_field' => $title, 'prevent_empty' => false]);
            }
        }
        $this->end_controls_section();
        if ($d['kind'] === 'bloc') {
            $this->start_controls_section('mc_code_s', ['label' => 'Code HTML (avancé)', 'tab' => \Elementor\Controls_Manager::TAB_CONTENT]);
            $this->add_control('mc_code_on', ['label' => 'Modifier le code de ce bloc', 'type' => \Elementor\Controls_Manager::SWITCHER, 'label_on' => 'Oui', 'label_off' => 'Non', 'return_value' => 'yes', 'default' => '',
                'description' => 'Activé : le code ci-dessous remplace tout le bloc, et les champs « Contenu » ne sont plus utilisés. Désactivé : le bloc reprend ses champs.']);
            $this->add_control('mc_code', ['label' => 'Code HTML', 'type' => \Elementor\Controls_Manager::CODE, 'language' => 'html', 'rows' => 24, 'default' => (string) $d['code'], 'condition' => ['mc_code_on' => 'yes']]);
            $this->end_controls_section();
        }
    }

    protected function render() {
        echo mc_fix_html(mc_widget_html($this->mc, $this->get_settings_for_display()));
    }
}
