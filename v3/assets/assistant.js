/*
 * Assistant Moto's Cool — chargé seulement au premier clic sur « Une question ? ».
 *
 * Deux modes :
 *  1. Assistant intégré (par défaut) : répond à partir des informations du site, sans IA
 *     et sans rien envoyer à un serveur. Il n'invente ni prix, ni délai, ni promotion.
 *  2. Mode IA : si SITE.aiEndpoint est renseigné (voir ai-proxy/README.md), les messages
 *     sont envoyés au proxy. En cas d'erreur, l'assistant intégré prend le relais.
 *
 * Objectif : amener le client à l'atelier (appel, rendez-vous, passage), pas l'aider à
 * réparer lui-même. Chaque réponse se termine par des actions concrètes.
 */
(function () {
  'use strict';
  if (window.MCAssistant) return;
  const MC = window.MC || {};
  const SITE = MC.SITE || { phone: '01 43 76 26 38', tel: '+33143762638', aiEndpoint: '' };
  const ZONE = MC.ZONE || {};
  const HOURS = MC.HOURS || [];
  const BRANDS = MC.BRANDS || [];
  const PHONE = SITE.phone, TEL = SITE.tel;
  const ADDRESS = '15 ter avenue du Président Salvador Allende, 94400 Vitry-sur-Seine';
  const MAPS = 'https://www.google.com/maps/dir/?api=1&destination=15+ter+avenue+du+Pr%C3%A9sident+Salvador+Allende+94400+Vitry-sur-Seine';
  const AI = /^https:\/\//.test(SITE.aiEndpoint || '');

  // ---------- Styles (injectés ici pour ne rien charger avant l'ouverture) ----------
  const css = `
  .mc-chat { position: fixed; right: 18px; bottom: 18px; z-index: 80; width: min(390px, calc(100vw - 36px)); height: min(600px, calc(100vh - 110px));
    display: flex; flex-direction: column; background: #121215; border: 1px solid #2c2c33; border-radius: 20px; box-shadow: 0 24px 70px -20px rgba(0,0,0,.9);
    overflow: hidden; font-family: 'Nunito', system-ui, sans-serif; color: #f2f2f2; }
  .mc-chat[hidden] { display: none; }
  .mc-head { display: flex; align-items: center; gap: 12px; padding: 14px 14px 12px 18px; border-bottom: 1px solid #2c2c33; background: #16161a; }
  .mc-head h2 { font-size: 1rem; line-height: 1.2; font-weight: 800; }
  .mc-head h2 b { font-family: 'Orbitron', sans-serif; color: #ef4136; font-weight: 900; }
  .mc-head p { font-size: .76rem; color: #a3a3ad; margin-top: 2px; }
  .mc-head > div { flex: 1; min-width: 0; }
  .mc-x { width: 38px; height: 38px; border-radius: 50%; border: 1px solid #2c2c33; background: transparent; color: #f2f2f2; font-size: 1.3rem; line-height: 1; cursor: pointer; flex-shrink: 0; }
  .mc-x:hover { border-color: #e63027; }
  .mc-log { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; overscroll-behavior: contain; }
  .mc-msg { max-width: 88%; padding: 11px 14px; border-radius: 16px; font-size: .94rem; line-height: 1.5; white-space: pre-line; overflow-wrap: anywhere; }
  .mc-bot { align-self: flex-start; background: #1f1f24; border-bottom-left-radius: 6px; }
  .mc-user { align-self: flex-end; background: #d42a21; color: #fff; border-bottom-right-radius: 6px; }
  .mc-acts { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .mc-act { display: inline-flex; align-items: center; padding: 7px 13px; border-radius: 999px; font: inherit; font-size: .84rem; font-weight: 800; cursor: pointer;
    border: 1px solid #3a3a42; background: transparent; color: #f2f2f2; text-decoration: none; }
  .mc-act:hover { border-color: #e63027; }
  .mc-act.primary { background: #d42a21; border-color: #d42a21; color: #fff; }
  .mc-act.primary:hover { background: #b8231c; }
  .mc-chips { display: flex; gap: 8px; padding: 0 16px 10px; overflow-x: auto; scrollbar-width: none; }
  .mc-chips button { flex-shrink: 0; padding: 7px 12px; border-radius: 999px; border: 1px solid #2c2c33; background: #16161a; color: #d6d6dc; font: inherit; font-size: .82rem; font-weight: 700; cursor: pointer; }
  .mc-chips button:hover { border-color: #e63027; color: #fff; }
  .mc-form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #2c2c33; background: #16161a; }
  .mc-form input { flex: 1; min-width: 0; font: inherit; color: #f2f2f2; background: #0e0e10; border: 1px solid #2c2c33; border-radius: 999px; padding: 11px 16px; }
  .mc-form input:focus { outline: none; border-color: #e63027; }
  .mc-form button { border: 0; border-radius: 999px; background: #d42a21; color: #fff; font: inherit; font-weight: 800; padding: 0 18px; cursor: pointer; }
  .mc-form button:disabled { opacity: .6; cursor: wait; }
  .mc-note { font-size: .72rem; color: #8d8d97; padding: 0 16px 10px; }
  .mc-typing { align-self: flex-start; color: #a3a3ad; font-size: .85rem; padding: 4px 6px; }
  .mc-chat :focus-visible { outline: 2px solid #20e3ff; outline-offset: 2px; }
  @media (max-width: 768px) {
    .mc-chat { left: 8px; right: 8px; width: auto; bottom: calc(80px + env(safe-area-inset-bottom)); height: min(560px, calc(100vh - 100px - env(safe-area-inset-bottom))); border-radius: 18px; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .mc-chat { animation: mc-in .22s ease-out; }
    @keyframes mc-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  }`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);

  // ---------- Interface ----------
  const box = document.createElement('div');
  box.className = 'mc-chat';
  box.id = 'mc-chat';
  box.hidden = true;
  box.setAttribute('role', 'dialog');
  box.setAttribute('data-lenis-prevent', ''); // le défilement doux (Lenis) laisse la molette au panneau
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'mc-title');
  box.setAttribute('aria-describedby', 'mc-sub');
  box.innerHTML = `
    <div class="mc-head">
      <div>
        <h2 id="mc-title"><b>MOTO'S</b> COOL · Assistant</h2>
        <p id="mc-sub">Assistant automatique · ${AI ? "messages traités par un fournisseur d'IA" : 'réponses tirées des informations du site'}</p>
      </div>
      <button type="button" class="mc-x" aria-label="Fermer l'assistant">×</button>
    </div>
    <div class="mc-log" data-lenis-prevent role="log" aria-live="polite" aria-relevant="additions"></div>
    <div class="mc-chips" role="group" aria-label="Questions fréquentes"></div>
    <p class="mc-note">${AI
      ? "Vos messages sont transmis à un fournisseur d'IA pour générer la réponse. N'y indiquez aucune donnée sensible. <a href=\"confidentialite.html#assistant\" style=\"color:inherit\">En savoir plus</a>"
      : "Pour un diagnostic fiable, rien ne remplace l'avis d'un technicien."}</p>
    <form class="mc-form" autocomplete="off">
      <label for="mc-in" class="sr-only">Votre question</label>
      <input id="mc-in" maxlength="500" placeholder="Posez votre question…" enterkeyhint="send">
      <button type="submit">Envoyer</button>
    </form>`;
  document.body.append(box);
  const log = box.querySelector('.mc-log'), chips = box.querySelector('.mc-chips');
  const formEl = box.querySelector('.mc-form'), input = box.querySelector('#mc-in'), sendBtn = formEl.querySelector('button');
  const opener = document.getElementById('chat-btn');

  // ---------- Normalisation et correspondance approximative ----------
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, ' ').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const lev = (a, b) => {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  };
  // Un mot-clé correspond s'il est contenu dans le texte (expressions) ou proche d'un mot (fautes de frappe)
  const has = (text, words, kw) => {
    if (kw.includes(' ')) return (' ' + text + ' ').includes(' ' + kw + ' ');
    return words.some(w => w === kw || w === kw + 's' || w === kw + 'x' ||
      (kw.length >= 6 && w[0] === kw[0] && ((w.startsWith(kw) && w.length - kw.length <= 2) || lev(w, kw) <= 1)));
  };

  // ---------- Faits du site ----------
  const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  function openNow() {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
      const get = t => parts.find(p => p.type === t).value;
      const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
      const mins = (+get('hour') % 24) * 60 + +get('minute');
      const h = HOURS[day] || [];
      return { open: h.some(([o, c]) => mins >= o && mins < c), day };
    } catch (e) { return null; }
  }
  const REASONS = "Chez Moto's Cool, nous nous occupons de toutes les marques. Le prix est fixé après un diagnostic à l'atelier, avec un devis que vous validez, et nos interventions sont garanties.";
  const HOURS_TXT = 'du lundi au vendredi de 9h30 à 13h00 et de 14h00 à 18h30, et le samedi de 10h00 à 13h00 et de 14h00 à 18h30';
  const ZONE_TXT = MC.ZONE_TXT || "toute l'Île-de-France";
  // Symptômes critiques pour la sécurité : ne pas rouler, appeler le dépannage
  const SAFETY = /\bfrein(e|ent) (mal|plus|pas|moins)\b|\bne frein(e|ent)\b|\bplus de frein|\bfrein\w* (lache|mou|molle|spongieux|bloque|ne marche|ne repond)|\blevier (mou|qui s enfonce)|\bdirection (dure|bloquee|bloque|qui tire|qui tremble|floue)\b|\bguidon (dur|bloque|qui tremble|qui vibre)\b|\btire (a gauche|a droite)\b|\bodeur d essence\b|\bodeur de carburant\b|\bfuite d essence\b|\bessence qui coule\b|\bfumee\b|\b(ca|qui|moto|moteur|scooter|elle|il) fume\b|\bflammes?\b|\bsent le brule\b|\baccident\b|\bchute\b|\b(suis|est) tombee?\b/;

  // Actions proposées sous les réponses
  const A = {
    call: (label) => ({ type: 'link', label: label || `Appeler le ${PHONE}`, href: `tel:${TEL}`, primary: true }),
    book: (message, intervention) => ({ type: 'book', label: 'Prendre rendez-vous', message, intervention }),
    visit: () => ({ type: 'link', label: 'Itinéraire vers l\'atelier', href: MAPS, external: true }),
    wa: () => (MC.waLink ? { type: 'link', label: 'WhatsApp', href: MC.waLink, external: true } : null),
    zone: () => ({ type: 'anchor', label: 'Vérifier ma commune', href: '#depannage' })
  };

  // ---------- Base de connaissances ----------
  // Chaque entrée : mots-clés (pondérés par leur nombre), réponse (texte + actions).
  const SYMPTOMS = [
    { kw: ['frein', 'freine', 'freinent', 'freinage', 'plaquette', 'disque', 'levier mou', 'freine mal', 'ne freine'], causes: 'plaquettes usées, liquide de frein à remplacer, disque ou étrier à contrôler', inter: 'Freinage' },
    { kw: ['direction dure', 'direction bloquee', 'direction qui tire', 'direction floue', 'tire a gauche', 'tire a droite', 'guidon dur', 'guidon tremble', 'guidon qui tremble', 'guidon vibre', 'guidon qui vibre', 'shimmy', 'louvoie'], causes: 'pneus, pression, roulements de direction ou suspension', inter: 'Diagnostic' },
    { kw: ['odeur d essence', 'odeur de carburant', 'fuite d essence', 'essence qui coule', 'sent l essence'], causes: 'fuite sur le circuit d\'alimentation (durite, raccord, réservoir)', inter: 'Diagnostic' },
    { kw: ['fumee', 'ca fume', 'qui fume', 'moteur fume', 'moto fume', 'sent le brule', 'surchauffe', 'chauffe trop', 'chauffe beaucoup'], causes: 'fuite d\'huile ou de liquide de refroidissement, surchauffe moteur', inter: 'Diagnostic' },
    { kw: ['demarre pas', 'demarre plus', 'demarrer', 'demarrage', 'batterie', 'cale', 'starter', 'tousse'], causes: 'batterie, démarreur, alimentation, allumage ou un simple faux contact', inter: 'Diagnostic' },
    { kw: ['bruit', 'claque', 'cliquetis', 'grince', 'siffle', 'cogne', 'vibre', 'vibration'], causes: 'transmission, freins, moteur ou une pièce desserrée', inter: 'Diagnostic' },
    { kw: ['fuite', 'huile', 'goutte', 'flaque'], causes: 'joint, durite ou bouchon de vidange', inter: 'Diagnostic' },
    { kw: ['voyant', 'temoin', 'allume', 'tableau de bord', 'code erreur'], causes: 'un capteur, l\'injection, la charge de la batterie ou un entretien à faire', inter: 'Diagnostic' },
    { kw: ['embrayage', 'patine', 'broute', 'vitesse', 'boite', 'passe mal', 'point mort'], causes: 'embrayage, câble ou commande, ou boîte de vitesses', inter: 'Réparation' },
    { kw: ['chaine', 'kit chaine', 'couronne', 'pignon', 'saute'], causes: 'chaîne détendue ou usée, pignon ou couronne', inter: 'Entretien' },
    { kw: ['pneu', 'crevaison', 'creve', 'creve', 'degonfle', 'a plat', 'roue'], causes: 'crevaison, valve, pneu usé ou abîmé', inter: 'Pneus' },
    { kw: ['puissance', 'accelere mal', 'trou a l acceleration', 'n avance', 'perd de la', 'courroie', 'variateur'], causes: 'alimentation, filtre à air, bougies ou, sur un scooter, la transmission (courroie, variateur)', inter: 'Diagnostic' },
    { kw: ['electrique', 'phare', 'feu', 'clignotant', 'klaxon', 'ampoule', 'fusible'], causes: 'ampoule, fusible, faisceau ou régulateur', inter: 'Réparation' }
  ];

  const INTENTS = [
    { id: 'diy', kw: ['tuto', 'tutoriel', 'moi meme', 'soi meme', 'tout seul', 'toute seule', 'couple de serrage', 'reference', 'ref piece', 'comment reparer', 'comment changer', 'comment remplacer', 'comment demonter', 'comment regler', 'comment purger', 'comment faire pour reparer', 'je peux reparer', 'etapes'] },
    { id: 'panne', kw: ['panne', 'en panne', 'depanner', 'depannage', 'remorquer', 'remorquage', 'bloque', 'immobilise', 'accident', 'chute', 'tombe', 'tombee', 'au bord de la route', 'urgence', 'urgent'] },
    { id: 'zone', kw: ['zone', 'departement', 'secteur', 'intervenez', 'vous venez', 'jusqu a', 'paris', 'essonne', 'seine et marne', 'val de marne', 'hauts de seine', 'seine saint denis', 'yvelines', 'val d oise'] },
    { id: 'prix', kw: ['prix', 'tarif', 'cout', 'coute', 'combien', 'cher', 'devis', 'estimation', 'promo', 'promotion', 'reduction', 'remise'] },
    { id: 'paiement', kw: ['paiement', 'payer', 'carte', 'cb', 'especes', 'liquide', 'cheque', 'paypal', 'plusieurs fois', 'revolut', 'virement', 'sans contact', 'credit'] },
    { id: 'garantie', kw: ['garantie', 'garanti', 'garanties', 'sav'] },
    { id: 'horaires', kw: ['horaire', 'horaires', 'heure', 'ouvert', 'ouverture', 'ferme', 'fermeture', 'dimanche', 'samedi', 'aujourd hui', 'demain', 'quand'] },
    { id: 'adresse', kw: ['adresse', 'ou etes', 'ou se trouve', 'situe', 'itineraire', 'venir', 'acces', 'metro', 'rer', 'bus', 'garer', 'plan', 'vitry'] },
    { id: 'sansrdv', kw: ['sans rendez', 'sans rdv', 'passer directement', 'venir directement', 'directement', 'improviste'] },
    { id: 'rdv', kw: ['rendez vous', 'rdv', 'reserver', 'reservation', 'prendre un creneau', 'creneau', 'disponibilite', 'dispo'] },
    { id: 'marques', kw: ['marque', 'marques', 'toutes marques', 'yamaha', 'honda', 'suzuki', 'kawasaki', 'piaggio', 'vespa', 'ducati', 'guzzi', 'triumph', 'bmw', 'ktm', 'harley', 'kymco', 'sym', 'peugeot', 'aprilia', 'royal enfield', 'husqvarna', 'mv agusta', 'benelli', 'cfmoto'] },
    { id: 'entretien', kw: ['entretien', 'revision', 'vidange', 'filtre', 'bougie', 'carnet', 'controle', 'kilometres'] },
    { id: 'scooter', kw: ['scooter', 'scoot', '50cc', '125', 'maxi scooter', 'tmax'] },
    { id: 'quad', kw: ['quad'] },
    { id: 'vente', kw: ['vendre', 'vente', 'occasion', 'acheter', 'achat', 'equipement', 'casque', 'blouson', 'pieces detachees'] },
    { id: 'contact', kw: ['telephone', 'numero', 'appeler', 'joindre', 'contacter', 'whatsapp', 'email', 'mail', 'courriel'] },
    { id: 'merci', kw: ['merci', 'super', 'parfait', 'top', 'genial', 'au revoir', 'bonne journee', 'a bientot'] },
    { id: 'bonjour', kw: ['bonjour', 'salut', 'hello', 'bonsoir', 'coucou', 'hey'] }
  ];

  function answer(raw) {
    const text = norm(raw);
    const words = text.split(' ');
    // Code postal : 5 chiffres plausibles (01 à 95, 97, 98) et pas un kilométrage (« 12000 km »)
    const cpm = text.match(/\b(\d{5})\b(?!\s*(km|kilometre))/);
    const cp = cpm && /^(0[1-9]|[1-8]\d|9[0-5]|97|98)/.test(cpm[1]) ? cpm[1] : null;
    const score = {};
    INTENTS.forEach(it => { score[it.id] = it.kw.filter(k => has(text, words, k)).length; });
    const sym = SYMPTOMS.filter(s => s.kw.some(k => has(text, words, k)));
    const prefill = `Message envoyé depuis l'assistant : ${raw.trim()}`;
    const ctas = (inter, extra) => [A.call(), A.book(prefill, inter), ...(extra || []), A.wa()].filter(Boolean);

    // 1. Demande de réparation « à faire soi-même » : réorientation polie
    if (score.diy) {
      return { text: `Je comprends l'envie de vous en occuper vous-même, mais je ne donne pas de procédure de réparation, de références de pièces ni de couples de serrage : une erreur sur une moto peut coûter cher, ou être dangereuse.\n\n${REASONS} Le plus simple est de nous la confier : nous vous dirons précisément ce qu'il faut faire, et combien cela coûte, avant toute intervention.`, actions: ctas(sym[0] && sym[0].inter) };
    }
    // 2. Code postal : vérification de la zone de dépannage
    if (cp) {
      const code = cp.slice(0, 2);
      if ((MC.ZONE_FULL || []).includes(code)) return { text: `Oui, ${cp} est dans notre zone de dépannage. Intervention express pendant nos horaires d'ouverture : nous venons chercher la moto et nous l'amenons à l'atelier. Le tarif dépend de la distance et de la situation.`, actions: [A.call('Appeler le dépannage'), A.book(prefill, 'Dépannage'), A.wa()].filter(Boolean) };
      return { text: `${cp} n'est pas dans notre zone de dépannage, qui couvre ${ZONE_TXT}. Appelez-nous quand même : nous vous orienterons. Pour un entretien ou une réparation, l'atelier de Vitry-sur-Seine accueille tout le monde, sur rendez-vous.`, actions: [A.call(), A.visit()] };
    }
    // 3. Symptôme décrit : écoute, causes générales, sécurité, puis atelier
    const safety = SAFETY.test(text);
    if (sym.length && !(score.prix && !safety) && !(score.panne && !safety)) {
      const s = sym[0];
      const intro = safety
        ? `Merci de nous avoir décrit le problème. Par sécurité, ne roulez pas avec la moto dans cet état : mettez-vous à l'abri de la circulation et appelez-nous, nous organisons le dépannage (${ZONE_TXT}).`
        : `Merci de nous avoir décrit le problème, c'est bien de ne pas le laisser traîner.`;
      return { text: `${intro}\n\nEn général, ce type de symptôme peut venir de plusieurs choses : ${s.causes}. Mais seul un contrôle par un technicien permet de poser un diagnostic fiable.\n\n${REASONS}`, actions: safety ? [A.call('Appeler pour un dépannage'), A.book(prefill, 'Dépannage'), A.wa()].filter(Boolean) : ctas(s.inter, [A.visit()]) };
    }
    const best = Object.entries(score).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])[0];
    const id = best ? best[0] : null;
    const o = openNow();
    switch (id) {
      case 'panne':
        return { text: `Vous êtes en panne ? Mettez-vous d'abord en sécurité, à l'écart de la circulation. Appelez-nous au ${PHONE} pendant nos horaires d'ouverture : nous évaluons la situation au téléphone, puis notre dépanneur vient chercher la moto et l'amène à l'atelier, où elle est diagnostiquée.\n\nZone de dépannage : ${ZONE_TXT}. Donnez-moi votre code postal si vous voulez vérifier.`, actions: [A.call('Appeler le dépannage'), A.zone(), A.wa()].filter(Boolean) };
      case 'zone':
        return { text: `Nous dépannons dans ${ZONE_TXT}. Indiquez-moi votre code postal ou vérifiez votre commune sur la carte.\n\nPour l'entretien et les réparations, l'atelier de Vitry-sur-Seine accueille tout le monde, sur rendez-vous.`, actions: [A.call(), A.zone()] };
      case 'prix':
        // Règle : aucun prix, fourchette, estimation ou « à partir de », pour quoi que ce soit.
        return { text: `Pour le prix, on voit ça ensemble : chaque moto est différente, donc nous ne donnons aucun tarif à l'avance, même approximatif. Le prix est fixé après un diagnostic à l'atelier, sur un devis que vous validez. Aucun travail n'est engagé sans votre accord.\n\nPour un dépannage, le tarif dépend de la distance et de la situation : appelez-nous pour en parler.\n\nLe plus simple : appelez-nous ou prenez rendez-vous.`, actions: ctas() };
      case 'paiement':
        return { text: `Moyens de paiement acceptés : carte bancaire (avec ou sans contact), espèces et virement bancaire.`, actions: [A.book(prefill), A.call()] };
      case 'garantie':
        return { text: `Oui, nos interventions sont garanties : en cas de souci lié à notre travail, revenez nous voir, nous le reprenons. Les conditions sont précisées sur votre facture. Pour une intervention déjà réalisée, appelez l'atelier : nous retrouverons votre dossier.`, actions: [A.call(), A.book(prefill)] };
      case 'horaires':
        return { text: `L'atelier est ouvert ${HOURS_TXT}. Il est fermé le dimanche. Le dépannage fonctionne aux mêmes horaires.${o ? (o.open ? `\n\nNous sommes ouverts en ce moment : vous pouvez appeler.` : `\n\nNous sommes fermés en ce moment : vous pouvez réserver un créneau en ligne, nous vous rappelons pour le confirmer.`) : ''}`, actions: [A.call(), A.book(prefill), A.visit()] };
      case 'adresse':
        return { text: `L'atelier se trouve au ${ADDRESS}. Il est ouvert ${HOURS_TXT}. Réparations et entretien sur rendez-vous ; sans rendez-vous, nous faisons uniquement les contrôles et diagnostics.`, actions: [A.visit(), A.call(), A.book(prefill)] };
      case 'sansrdv':
        return { text: `Sans rendez-vous, nous faisons uniquement les contrôles et diagnostics : passez à l'atelier, ${ADDRESS}, pendant nos horaires d'ouverture. Pour une réparation ou un entretien, il faut prendre rendez-vous.`, actions: [A.book(prefill), A.visit(), A.call()] };
      case 'rdv':
        return { text: `Vous pouvez réserver en ligne en 2 minutes, tout en haut de la page : véhicule, jour et heure, à l'atelier ou en dépannage à domicile. L'accueil vous rappelle pour confirmer. Si c'est urgent, appelez-nous directement.`, actions: [A.book(prefill), A.call()] };
      case 'marques': {
        const named = BRANDS.find(b => text.includes(norm(b)));
        return { text: `${named ? `Oui, nous intervenons sur les ${named}. ` : ''}Nous entretenons et réparons les motos et scooters ${BRANDS.join(', ')} et bien d'autres marques. Pour un modèle particulier, appelez-nous.\n\n${REASONS}`, actions: ctas() };
      }
      case 'entretien':
        return { text: `Nous faisons l'entretien et la révision selon les préconisations du constructeur : vidange, filtres, kit chaîne, liquides et contrôle de sécurité complet, sur rendez-vous. Le prix est fixé après contrôle, sur devis que vous validez.\n\n${REASONS}`, actions: [A.book(prefill, 'Entretien'), A.call(), A.visit()] };
      case 'scooter':
        return { text: `Oui, nous entretenons et réparons les scooters de toutes cylindrées, du 50 cm³ au maxi-scooter, avec le même soin que les motos.\n\n${REASONS}`, actions: [A.book(prefill, 'Entretien'), A.call()] };
      case 'quad':
        return { text: `Pour un quad, le plus simple est de nous appeler : nous vous dirons si nous pouvons le prendre en charge. Vous pouvez aussi indiquer « Quad » dans le formulaire de rendez-vous.`, actions: [A.call(), A.book(prefill)] };
      case 'vente':
        return { text: `Le site présente nos services d'entretien, de réparation et de dépannage. Pour toute question sur une pièce ou une vente, appelez directement l'atelier.`, actions: [A.call(), A.visit()] };
      case 'contact':
        return { text: `Vous pouvez nous appeler au ${PHONE}, du lundi au samedi pendant les horaires d'ouverture, ou venir à l'atelier : ${ADDRESS}.${MC.waLink ? ' Vous pouvez aussi nous écrire sur WhatsApp.' : ''}`, actions: [A.call(), A.wa(), A.visit()].filter(Boolean) };
      case 'merci':
        return { text: `Avec plaisir ! À bientôt chez Moto's Cool. Si vous avez besoin de nous, nous sommes joignables au ${PHONE}.`, actions: [A.call(), A.book(prefill)] };
      case 'bonjour':
        return { text: `Bonjour ! Dites-moi ce qui arrive à votre moto, ou posez-moi une question : horaires, zone de dépannage, paiement, rendez-vous…`, actions: [A.call(), A.book(prefill)] };
      default:
        return { text: `Je ne suis pas sûr de bien comprendre, et je préfère ne pas vous répondre au hasard. Le plus sûr est d'appeler l'atelier au ${PHONE} : nous vous répondrons directement. Vous pouvez aussi décrire votre besoin dans le formulaire de rendez-vous.`, actions: ctas() };
    }
  }

  // ---------- Affichage ----------
  function addMsg(who, text, actions) {
    const m = document.createElement('div');
    m.className = 'mc-msg ' + (who === 'user' ? 'mc-user' : 'mc-bot');
    const t = document.createElement('div');
    t.textContent = text;
    m.append(t);
    if (actions && actions.length) {
      const wrap = document.createElement('div');
      wrap.className = 'mc-acts';
      actions.forEach(a => {
        let el;
        if (a.type === 'book') {
          el = document.createElement('button');
          el.type = 'button';
          el.addEventListener('click', () => { close(false); if (MC.book) MC.book(a.message, a.intervention); else location.hash = 'devis'; });
        } else {
          el = document.createElement('a');
          el.href = a.href;
          if (a.external) { el.target = '_blank'; el.rel = 'noopener'; }
          if (a.type === 'anchor') el.addEventListener('click', () => close(false));
        }
        el.className = 'mc-act' + (a.primary ? ' primary' : '');
        el.textContent = a.label;
        wrap.append(el);
      });
      m.append(wrap);
    }
    log.append(m);
    log.scrollTop = log.scrollHeight;
  }

  const history = []; // pour le mode IA : [{ role, content }]
  async function askAI(q) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const r = await fetch(SITE.aiEndpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ messages: history.slice(-10).concat({ role: 'user', content: q }) })
      });
      if (!r.ok) throw new Error('http ' + r.status);
      const data = await r.json();
      if (!data || typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('empty');
      return data.reply.trim();
    } finally { clearTimeout(timer); }
  }

  let busy = false;
  async function handle(q) {
    q = String(q || '').trim().slice(0, 500);
    if (!q || busy) return;
    busy = true; sendBtn.disabled = true;
    addMsg('user', q);
    const local = answer(q);
    if (AI) {
      const typing = document.createElement('div');
      typing.className = 'mc-typing'; typing.textContent = 'L\'assistant écrit…';
      log.append(typing); log.scrollTop = log.scrollHeight;
      try {
        const reply = await askAI(q);
        history.push({ role: 'user', content: q }, { role: 'assistant', content: reply });
        typing.remove();
        // Les actions (appel, rendez-vous…) restent celles du site : la réponse IA n'est que du texte
        addMsg('bot', reply, local.actions);
      } catch (e) {
        typing.remove();
        addMsg('bot', local.text, local.actions); // repli sur l'assistant intégré
      }
    } else {
      addMsg('bot', local.text, local.actions);
    }
    busy = false; sendBtn.disabled = false;
  }

  [['Je suis en panne', 'Je suis en panne, ma moto ne démarre plus'], ['Horaires', 'Quels sont vos horaires ?'], ['Zone de dépannage', 'Dans quelle zone intervenez-vous ?'],
   ['Tarifs', 'Combien coûte une réparation ?'], ['Paiement', 'Quels moyens de paiement acceptez-vous ?'], ['Sans rendez-vous ?', 'Peut-on venir sans rendez-vous ?']]
    .forEach(([label, q]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.addEventListener('click', () => handle(q));
      chips.append(b);
    });

  formEl.addEventListener('submit', e => { e.preventDefault(); const q = input.value; input.value = ''; handle(q); input.focus(); });

  // ---------- Ouverture, fermeture, piège du focus ----------
  const focusables = () => [...box.querySelectorAll('button:not([disabled]), a[href], input')].filter(el => el.offsetParent !== null);
  box.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = focusables(); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  box.querySelector('.mc-x').addEventListener('click', () => close(true));

  let greeted = false, inerted = [];
  const onDocKey = e => { if (e.key === 'Escape' && !box.hidden) { e.preventDefault(); close(true); } };
  function open() {
    box.hidden = false;
    // Fenêtre modale : le reste de la page devient inerte tant que l'assistant est ouvert
    inerted = [...document.body.children].filter(el => el !== box && !el.inert && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE');
    inerted.forEach(el => { el.inert = true; });
    document.addEventListener('keydown', onDocKey);
    if (opener) opener.setAttribute('aria-controls', 'mc-chat');
    document.documentElement.classList.add('chat-open');
    if (opener) opener.setAttribute('aria-expanded', 'true');
    if (!greeted) {
      greeted = true;
      const o = openNow();
      addMsg('bot', `Bonjour, je suis l'assistant automatique de Moto's Cool. Décrivez-moi le problème de votre moto ou posez votre question : je vous oriente vers la meilleure solution.${o ? (o.open ? `\n\nL'atelier est ouvert en ce moment.` : `\n\nL'atelier est fermé en ce moment ; pour un dépannage, appelez-nous.`) : ''}`, [A.call(), A.book('')]);
    }
    input.focus();
  }
  function close(restoreFocus) {
    box.hidden = true;
    inerted.forEach(el => { el.inert = false; });
    inerted = [];
    document.removeEventListener('keydown', onDocKey);
    document.documentElement.classList.remove('chat-open');
    if (opener) { opener.setAttribute('aria-expanded', 'false'); if (restoreFocus) opener.focus(); }
  }
  // ask : ouvre l'assistant et pose directement la question (barre de recherche de la FAQ)
  window.MCAssistant = { open, close: () => close(true), toggle: () => (box.hidden ? open() : close(true)), answer, ask: q => { open(); handle(q); } };
})();
