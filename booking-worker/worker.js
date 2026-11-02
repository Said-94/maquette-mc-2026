/**
 * Service d'envoi des demandes de rendez-vous de Moto's Cool (Cloudflare Worker).
 *
 * Reçoit la demande du formulaire (POST JSON), la vérifie, écarte les robots, puis envoie à l'accueil
 * un email au format attendu par le garage, avec un bouton « Valider ce rendez-vous » (page valider.html).
 * L'email part via Brevo (Sendinblue, France, serveurs dans l'UE). Rien n'est stocké ici.
 *
 * Variables (Settings › Variables du Worker) :
 *   BREVO_API_KEY    (secret) clé API Brevo
 *   TO_EMAIL         adresse de l'accueil, ex : contact@motoscool.fr
 *   FROM_EMAIL       expéditeur validé dans Brevo, ex : rdv@motoscool.fr
 *   SITE_URL         adresse du site, avec « / » final, ex : https://motoscool.fr/
 *   ALLOWED_ORIGINS  origines autorisées, séparées par des virgules, ex : https://motoscool.fr,https://said-94.github.io
 */
const MAX_BYTES = 12000;
const hits = new Map(); // limite simple par adresse IP (par instance) : 5 demandes / 10 min

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const dateFr = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const hourFr = h => (/^\d{2}:\d{2}$/.test(h || '') ? `${+h.slice(0, 2)}:${h.slice(3)}` : '');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');
const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);

// Même texte que assets/rdv-mail.js
function mailText(p) {
  const ve = p.vehicule, r = p.rdv, c = p.contact;
  return [
    "🏍️ NOUVELLE DEMANDE DE RDV — Moto's Cool", '',
    '— VÉHICULE —',
    `Type : ${ve.type}`, `Immatriculation : ${ve.immatriculation}`, `Marque / Modèle : ${[ve.marque, ve.modele].filter(Boolean).join(' ')}`,
    `Cylindrée : ${ve.cylindree ? ve.cylindree + 'cc' : ''}`, `Année : ${ve.annee ?? ''}`, `Kilométrage : ${ve.kilometrage != null ? ve.kilometrage + ' km' : ''}`,
    `Intervention : ${ve.interventionLabel || ve.intervention}`, '',
    '— RENDEZ-VOUS —',
    `Lieu : ${r.lieu}`, `Adresse : ${r.adresse}`, `Date : ${dateFr(r.date)}`, `Heure : ${hourFr(r.heure)}`, '',
    '— CONTACT —',
    `Nom : ${c.nom}`, `Téléphone : ${c.telephone}`, `Email : ${c.email}`, '',
    'Message :', p.message
  ].join('\n');
}
const b64url = s => { let bin = ''; new TextEncoder().encode(s).forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

// Vérifie et nettoie la demande ; renvoie null si elle est invalide
function clean(b) {
  if (!b || typeof b !== 'object' || !b.vehicule || !b.rdv || !b.contact) return null;
  const v = b.vehicule, r = b.rdv, c = b.contact;
  const p = {
    vehicule: {
      type: str(v.type, 20), immatriculation: str(v.immatriculation, 12).toUpperCase(), marque: str(v.marque, 40), modele: str(v.modele, 60),
      cylindree: int(v.cylindree, 49, 3000), annee: int(v.annee, 1950, 2100), kilometrage: int(v.kilometrage, 0, 999999),
      intervention: str(v.intervention, 40), interventionLabel: str(v.interventionLabel, 60)
    },
    rdv: {
      lieu: r.lieu === 'Dépannage à domicile' ? 'Dépannage à domicile' : "A l'atelier",
      adresse: str(r.adresse, 200), date: str(r.date, 10), heure: str(r.heure, 5),
      position: r.position && typeof r.position.lat === 'number' && typeof r.position.lng === 'number'
        ? { lat: +r.position.lat.toFixed(6), lng: +r.position.lng.toFixed(6), accuracy: int(Math.round(r.position.accuracy), 0, 100000) } : null
    },
    contact: { nom: str(c.nom, 80), telephone: str(c.telephone, 30), email: str(c.email, 120) },
    message: str(b.message, 1000)
  };
  const ok = p.vehicule.immatriculation && p.vehicule.marque && p.vehicule.modele && p.vehicule.intervention
    && /^\d{4}-\d{2}-\d{2}$/.test(p.rdv.date) && /^\d{2}:\d{2}$/.test(p.rdv.heure)
    && p.contact.nom && /^(\+33|0)\s?[1-9]([\s.-]?\d{2}){4}$/.test(p.contact.telephone)
    && /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(p.contact.email)
    && (p.rdv.lieu === "A l'atelier" || p.rdv.adresse);
  return ok ? p : null;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = { 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return reply(405, { ok: false });
    if (!allowed.includes(origin)) return reply(403, { ok: false });

    // Limite de débit par adresse IP
    const ip = req.headers.get('CF-Connecting-IP') || '?', now = Date.now();
    const list = (hits.get(ip) || []).filter(t => now - t < 600000);
    if (list.length >= 5) return reply(429, { ok: false });
    list.push(now); hits.set(ip, list);

    const raw = await req.text();
    if (raw.length > MAX_BYTES) return reply(413, { ok: false });
    let body; try { body = JSON.parse(raw); } catch (e) { return reply(400, { ok: false }); }
    // Robot (champ piège rempli ou formulaire rempli trop vite) : réponse normale, rien n'est envoyé
    if (str(body.site_web, 200) !== '' || !(body.duree >= 4)) return reply(200, { ok: true });
    const p = clean(body);
    if (!p) return reply(422, { ok: false });

    const text = mailText(p);
    const link = `${env.SITE_URL}valider.html#d=${b64url(JSON.stringify(p))}`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#1d1d1f">${esc(text).replace(/\n/g, '<br>')}
<p style="margin-top:22px"><a href="${esc(link)}" style="display:inline-block;background:#d42a21;color:#fff;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:999px">✅ Valider ce rendez-vous</a></p>
<p style="color:#777;font-size:12px">Le bouton ouvre la fiche de validation : envoi dans G8 et confirmation au client.</p></div>`;
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { name: "Moto's Cool", email: env.FROM_EMAIL },
        to: [{ email: env.TO_EMAIL }],
        replyTo: { email: p.contact.email, name: p.contact.nom },
        subject: "🏍️ NOUVELLE DEMANDE DE RDV — Moto's Cool",
        textContent: `${text}\n\n✅ Valider ce rendez-vous : ${link}`,
        htmlContent: html
      })
    });
    return res.ok ? reply(200, { ok: true }) : reply(502, { ok: false });
  }
};
