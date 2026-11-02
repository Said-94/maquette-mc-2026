/**
 * Mise en forme d'une demande de rendez-vous, partagée par :
 *  - index.html : aperçu de l'email en mode démo ;
 *  - valider.html : page de validation de l'accueil ;
 *  - booking-worker/worker.js (copie du même texte) : email réellement envoyé à l'accueil.
 * Le texte reprend exactement le format attendu par le garage.
 */
(function () {
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const dateFr = iso => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  };
  const dayFr = iso => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? DAYS[new Date(+m[1], +m[2] - 1, +m[3]).getDay()] : '';
  };
  // « 09:00 » → « 9:00 »
  const hourFr = h => (/^\d{2}:\d{2}$/.test(h || '') ? `${+h.slice(0, 2)}:${h.slice(3)}` : '');
  const v = x => (x == null ? '' : String(x));

  function text(p) {
    const ve = p.vehicule || {}, r = p.rdv || {}, c = p.contact || {};
    return [
      "🏍️ NOUVELLE DEMANDE DE RDV — Moto's Cool",
      '',
      '— VÉHICULE —',
      `Type : ${v(ve.type)}`,
      `Immatriculation : ${v(ve.immatriculation)}`,
      `Marque / Modèle : ${[ve.marque, ve.modele].filter(Boolean).join(' ')}`,
      `Cylindrée : ${ve.cylindree ? ve.cylindree + 'cc' : ''}`,
      `Année : ${v(ve.annee)}`,
      `Kilométrage : ${ve.kilometrage != null && ve.kilometrage !== '' ? ve.kilometrage + ' km' : ''}`,
      `Intervention : ${v(ve.interventionLabel || ve.intervention)}`,
      '',
      '— RENDEZ-VOUS —',
      `Lieu : ${v(r.lieu)}`,
      `Adresse : ${v(r.adresse)}`,
      `Date : ${dateFr(r.date)}`,
      `Heure : ${hourFr(r.heure)}`,
      '',
      '— CONTACT —',
      `Nom : ${v(c.nom)}`,
      `Téléphone : ${v(c.telephone)}`,
      `Email : ${v(c.email)}`,
      '',
      'Message :',
      v(p.message)
    ].join('\n');
  }

  // Demande encodée dans le fragment (#…) de l'adresse : il n'est jamais envoyé à un serveur
  const encode = p => btoa(unescape(encodeURIComponent(JSON.stringify(p)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decode = s => JSON.parse(decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/')))));
  const validateLink = (p, base) => `${base}valider.html#d=${encode(p)}`;

  window.MCMail = { text, encode, decode, validateLink, dateFr, dayFr, hourFr };
})();
