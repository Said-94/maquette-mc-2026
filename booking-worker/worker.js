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
 *   SIGN_KEY         (secret, conseillé) clé de signature des liens « Valider » : un lien fabriqué ou modifié
 *                    est refusé par la future route G8. Générer une longue chaîne aléatoire (32 caractères ou plus).
 *   TURNSTILE_SECRET (secret, facultatif) clé Cloudflare Turnstile : si elle est renseignée, la demande doit
 *                    contenir un jeton Turnstile valide (champ « turnstile »). NE PAS la renseigner tant que le widget
 *                    Turnstile n'est pas ajouté au formulaire (et autorisé dans sa CSP) : sinon toutes les demandes sont refusées.
 *
 * Protections : origine vérifiée (CORS), méthode POST seule, JSON seul, taille limitée avant lecture,
 * limite par adresse IP et plafond global, champ piège et durée de saisie, nettoyage de chaque champ,
 * HTML échappé dans l'email, réponses sans cache et sans détail d'erreur.
 * La vraie barrière contre les attaques massives (DDoS) est en amont : règles Cloudflare (guide-cloudflare.md).
 */
const MAX_BYTES = 12000;
const IP_LIMIT = 5, IP_WINDOW = 600000;        // 5 demandes / 10 min par adresse IP (par instance)
const GLOBAL_LIMIT = 60, GLOBAL_WINDOW = 3600000; // plafond : 60 emails / heure par instance (protège le quota Brevo)
const hits = new Map();
let globalHits = [];
const LINK_TTL_DAYS = 60; // durée de validité conseillée d'un lien « Valider » (vérifiée par la future route G8)

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const dateFr = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : ''; };
const hourFr = h => (/^\d{2}:\d{2}$/.test(h || '') ? `${+h.slice(0, 2)}:${h.slice(3)}` : '');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Texte sur une ligne : caractères de contrôle et retours à la ligne retirés (pas d'injection d'en-têtes ou de lignes)
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max) : '');
// Message libre : retours à la ligne permis, autres caractères de contrôle retirés
const txt = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const int = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : null);
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);

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
const b64url = bytes => { let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64urlText = s => b64url(new TextEncoder().encode(s));

// Signature HMAC-SHA256 du contenu du lien « Valider » (vérifiée par la future route G8 avec la même clé)
// Le message signé est « d.t » (fiche + date d'émission en secondes) : la route G8 refusera un lien modifié ou trop ancien
// (plus de LINK_TTL_DAYS jours) et ignorera un même lien envoyé deux fois.
let keyCache = null;
async function sign(data, key) {
  if (!keyCache || keyCache.raw !== key) keyCache = { raw: key, k: crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) };
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await keyCache.k, new TextEncoder().encode(data))));
}

// Vérifie et nettoie la demande ; renvoie null si elle est invalide.
// Seuls les champs connus sont recopiés : rien d'autre (ex : « __proto__ ») ne passe.
function clean(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const v = b.vehicule, r = b.rdv, c = b.contact;
  if (!v || !r || !c || typeof v !== 'object' || typeof r !== 'object' || typeof c !== 'object') return null;
  const pos = r.position && typeof r.position === 'object' ? r.position : null;
  const lat = pos && num(pos.lat, 41, 52), lng = pos && num(pos.lng, -6, 10);
  const p = {
    vehicule: {
      type: str(v.type, 20), immatriculation: str(v.immatriculation, 12).toUpperCase(), marque: str(v.marque, 40), modele: str(v.modele, 60),
      cylindree: int(v.cylindree, 49, 3000), annee: int(v.annee, 1950, 2100), kilometrage: int(v.kilometrage, 0, 999999),
      intervention: str(v.intervention, 40), interventionLabel: str(v.interventionLabel, 60)
    },
    rdv: {
      lieu: r.lieu === 'Dépannage à domicile' ? 'Dépannage à domicile' : "A l'atelier",
      adresse: str(r.adresse, 200), date: str(r.date, 10), heure: str(r.heure, 5),
      position: lat != null && lng != null ? { lat: +lat.toFixed(6), lng: +lng.toFixed(6), accuracy: Math.min(100000, Math.max(0, Math.round(+pos.accuracy || 0))) } : null
    },
    contact: { nom: str(c.nom, 80), telephone: str(c.telephone, 30), email: str(c.email, 120) },
    message: txt(b.message, 1000)
  };
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.rdv.date), h = /^(\d{2}):(\d{2})$/.exec(p.rdv.heure);
  const day = d && new Date(Date.UTC(+d[1], +d[2] - 1, +d[3]));
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const dateOk = d && day.getUTCFullYear() === +d[1] && day.getUTCMonth() === +d[2] - 1 && day.getUTCDate() === +d[3]
    && day.getTime() >= today - 86400000 && day.getTime() <= today + 366 * 86400000;
  const hourOk = h && +h[1] <= 23 && +h[2] <= 59;
  const ok = p.vehicule.immatriculation && p.vehicule.marque && p.vehicule.modele && p.vehicule.intervention
    && dateOk && hourOk
    && p.contact.nom && /^(\+33|0)\s?[1-9]([\s.-]?\d{2}){4}$/.test(p.contact.telephone)
    && /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[a-z]{2,}$/i.test(p.contact.email)
    && (p.rdv.lieu === "A l'atelier" || p.rdv.adresse);
  return ok ? p : null;
}

// Limite par adresse IP : renvoie true si l'adresse a dépassé son quota
function ipLimited(ip, now) {
  if (hits.size > 5000) { // mémoire bornée : on retire les entrées expirées, puis les plus anciennes si besoin
    for (const [k, l] of hits) if (now - l[l.length - 1] >= IP_WINDOW) hits.delete(k);
    for (const [k, l] of hits) { if (hits.size <= 4000) break; if (l.length < IP_LIMIT) hits.delete(k); } // les adresses bloquées sont gardées
    for (const k of hits.keys()) { if (hits.size <= 4000) break; hits.delete(k); }
  }
  const list = (hits.get(ip) || []).filter(t => now - t < IP_WINDOW);
  hits.delete(ip); // réinsérée en dernier : les adresses actives restent en fin de liste
  if (list.length >= IP_LIMIT) { hits.set(ip, list); return true; }
  list.push(now); hits.set(ip, list);
  return false;
}
// Plafond global d'emails (protège le quota Brevo) : seules les demandes valides, prêtes à partir, sont comptées
function globalFull(now) {
  globalHits = globalHits.filter(t => now - t < GLOBAL_WINDOW);
  if (globalHits.length >= GLOBAL_LIMIT) return true;
  globalHits.push(now);
  return false;
}
// Lecture du corps avec arrêt dès que la limite est dépassée (même sans Content-Length, ex : envoi « chunked »)
async function readCapped(req, max) {
  if (!req.body) return '';
  const reader = req.body.getReader(), parts = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { try { await reader.cancel(); } catch (e) {} return null; }
    parts.push(value);
  }
  const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return new TextDecoder().decode(all);
}

async function turnstileOk(token, ip, secret) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  const form = new FormData(); form.append('secret', secret); form.append('response', token); form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    return !!(await r.json()).success;
  } catch (e) { return false; }
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = { 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
    const sec = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' };
    const reply = (status, body, extra) => new Response(JSON.stringify(body), { status, headers: { ...cors, ...sec, 'Content-Type': 'application/json', ...extra } });
    if (req.method === 'OPTIONS') return new Response(null, { status: allowed.includes(origin) ? 204 : 403, headers: { ...cors, ...sec } });
    if (req.method !== 'POST') return reply(405, { ok: false }, { Allow: 'POST, OPTIONS' });
    if (!allowed.includes(origin)) return reply(403, { ok: false });
    if (!/^application\/json\b/i.test(req.headers.get('Content-Type') || '')) return reply(415, { ok: false });
    // Taille vérifiée avant de lire le corps (annoncée), puis après lecture (réelle)
    const len = +(req.headers.get('Content-Length') || 0);
    if (len > MAX_BYTES) return reply(413, { ok: false });

    const ip = req.headers.get('CF-Connecting-IP') || '?';
    if (ipLimited(ip, Date.now())) return reply(429, { ok: false }, { 'Retry-After': String(IP_WINDOW / 1000) });

    let raw;
    try { raw = await readCapped(req, MAX_BYTES); } catch (e) { return reply(400, { ok: false }); }
    if (raw === null) return reply(413, { ok: false });
    let body; try { body = JSON.parse(raw); } catch (e) { return reply(400, { ok: false }); }
    if (!body || typeof body !== 'object') return reply(400, { ok: false });
    // Robot (champ piège rempli ou formulaire rempli trop vite) : réponse normale, rien n'est envoyé
    if (str(body.site_web, 200) !== '' || !(typeof body.duree === 'number' && body.duree >= 4)) return reply(200, { ok: true });
    if (env.TURNSTILE_SECRET && !(await turnstileOk(body.turnstile, ip, env.TURNSTILE_SECRET))) return reply(403, { ok: false });
    const p = clean(body);
    if (!p) return reply(422, { ok: false });
    if (globalFull(Date.now())) return reply(429, { ok: false }, { 'Retry-After': String(GLOBAL_WINDOW / 1000) });

    const text = mailText(p);
    const data = b64urlText(JSON.stringify(p));
    const t = Math.floor(Date.now() / 1000);
    const sig = env.SIGN_KEY ? `&t=${t}&s=${await sign(data + '.' + t, env.SIGN_KEY)}` : '';
    const link = `${env.SITE_URL}valider.html#d=${data}${sig}`;
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#1d1d1f">${esc(text).replace(/\n/g, '<br>')}
<p style="margin-top:22px"><a href="${esc(link)}" style="display:inline-block;background:#d42a21;color:#fff;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:999px">✅ Valider ce rendez-vous</a></p>
<p style="color:#777;font-size:12px">Le bouton ouvre la fiche de validation : envoi dans G8 et confirmation au client.</p></div>`;
    let res;
    try {
      res = await fetch('https://api.brevo.com/v3/smtp/email', {
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
    } catch (e) { return reply(502, { ok: false }); }
    return res.ok ? reply(200, { ok: true }) : reply(502, { ok: false });
  }
};

// Exposé pour les tests locaux (security-tests) ; sans effet sur Cloudflare
export const _test = { clean, mailText, esc, sign, reset: () => { hits.clear(); globalHits = []; }, size: () => hits.size, LINK_TTL_DAYS };
