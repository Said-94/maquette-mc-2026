/**
 * CONFIGURATION DE LA MOTO 3D — partagée par index.html (objet SITE) et mentions-legales.html (crédits).
 *   bikeModel          : modèle .glb (meshopt accepté) : { desktop, mobile } ou une seule URL.
 *                        La version « mobile » (textures 1K, maillage allégé) sert aussi en mode économie de données.
 *                        Vide = moto procédurale, aucune requête. Échec du chargement = moto procédurale.
 *   bikeRotationY      : réglage fin de l'orientation du modèle, en radians (ex : Math.PI pour le retourner).
 *   bikePaintMaterials : morceaux de noms des matériaux teintés par le sélecteur « Ta moto » (teinte multipliée,
 *                        couleur d'origine pour « Noir carbone »). La carrosserie du modèle actuel
 *                        (mat_livery_0_160_001) est en plus recolorée par un shader dédié dans assets/bike3d.js.
 *   bikeCredit         : crédit de la licence CC BY du modèle { text, url } ; affiché dans les mentions légales
 *                        (section « Crédits »), jamais sur la page d'accueil. Vide = section masquée.
 */
window.SITE_BIKE = {
  bikeModel: { desktop: '../assets/moto.glb', mobile: '../assets/moto-mobile.glb' },
  bikeRotationY: 0,
  bikePaintMaterials: ['paint'],
  bikeCredit: {
    text: 'Modèle 3D : « 2021 Ducati Panigale V4 SP » par Gratisphile (https://sketchfab.com/brainlesszombie5), licence CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), modifié (logos retirés, compression).',
    url: 'https://sketchfab.com/3d-models/2021-ducati-panigale-v4-sp-8c0632e4c54249758114490390f0b73f'
  }
};
