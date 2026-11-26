// Transforme les 17 pages du site (v3/) en pages WordPress modifiables avec Elementor :
// chaque bloc devient un « bloc Moto's Cool » (widget) dont les textes, liens et photos sont des champs,
// les listes répétées (FAQ, liens, photos…) des listes où l'on peut ajouter / retirer des éléments.
// Sorties (dans le thème) : mc/widgets.json, mc/pages/*.json, mc/templates.json, mc/widgets-classes.php
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse, parseFragment } from 'parse5';
import * as acorn from 'acorn';

// ---------- Scripts des pages : chaque partie démarre seule (un bloc retiré dans Elementor n'arrête pas les autres),
// et dans l'aperçu de l'éditeur, le script attend que les blocs soient affichés ----------
const PRELUDE = `<script>/* Moto's Cool : démarrage des scripts, partie par partie */
window.mcWarn = function (e) { try { console.warn("Moto's Cool : une partie de la page n'a pas démarré (bloc retiré ou modifié dans Elementor).", e); } catch (x) {} };
window.mcOnReady = function (f) {
  var done = false, run = function () { if (done) return; done = true; try { var p = f(); if (p && p.catch) p.catch(mcWarn); } catch (e) { mcWarn(e); } };
  if (!window.MC_PREVIEW) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run(); return; }
  var last = -1, still = 0, t = setInterval(function () { var n = document.querySelectorAll('.elementor-widget[data-widget_type^="mc_"]').length; if (n > 0 && n === last) { if (++still >= 2) { clearInterval(t); run(); } } else still = 0; last = n; }, 250);
};
// Vitesse (téléphones) : le démarrage est découpé en petites tranches ; entre deux tranches, le navigateur affiche la page
// et répond au doigt (pas de longue tâche bloquante). Le résultat est identique, seulement étalé.
window.mcT = 0;
window.mcLate = function () { var n = performance.now(); if (!window.mcT) { window.mcT = n; return false; } return n - window.mcT > 40; };
window.mcYield = function () { return new Promise(function (r) { var go = function () { window.mcT = performance.now(); r(); }; setTimeout(go, 0); /* le navigateur peut afficher la page entre deux tranches */ }); };
window.mcOnLoad = function (f) { if (document.readyState === 'complete') setTimeout(f, 0); else addEventListener('load', f); };
</script>`;
const YIELD = 'if (mcLate()) await mcYield(); ';
function wrapScripts(html) {
  let used = false;
  const out = html.replace(/<script(?![^>]*\bsrc=)(?![^>]*type="(?:application\/ld\+json|importmap|module)")([^>]*)>([\s\S]*?)<\/script>/g, (m, attrs, js) => {
    if (!js.includes("addEventListener('DOMContentLoaded'")) return m;
    const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'script' });
    const edits = [];
    for (const st of ast.body) {
      const c = st.type === 'ExpressionStatement' && st.expression.type === 'CallExpression' ? st.expression : null;
      if (!c || c.callee.type !== 'MemberExpression' || c.callee.property.name !== 'addEventListener' || !c.arguments[0] || c.arguments[0].value !== 'DOMContentLoaded') continue;
      const fn = c.arguments[1];
      if (!fn || !/FunctionExpression$/.test(fn.type) || fn.body.type !== 'BlockStatement') throw new Error('gestionnaire DOMContentLoaded inattendu');
      const names = p => !p ? [] : p.type === 'Identifier' ? [p.name] : p.type === 'ObjectPattern' ? p.properties.flatMap(x => names(x.type === 'RestElement' ? x.argument : x.value))
        : p.type === 'ArrayPattern' ? p.elements.flatMap(names) : p.type === 'AssignmentPattern' ? names(p.left) : p.type === 'RestElement' ? names(p.argument) : [];
      for (const s of fn.body.body) {
        if (s.type === 'VariableDeclaration' && s.declarations.some(d => d.init)) {
          // « const a = … » : la variable existe toujours, sa valeur est calculée à part (une erreur n'arrête pas la suite)
          const all = s.declarations.flatMap(d => names(d.id));
          const sets = s.declarations.filter(d => d.init).map(d => (d.id.type === 'ObjectPattern' ? '(' : '') + js.slice(d.id.start, d.id.end) + ' = ' + js.slice(d.init.start, d.init.end) + (d.id.type === 'ObjectPattern' ? ')' : '') + ';').join(' ');
          edits.push({ s: s.start, e: s.end, a: `${YIELD}${s.kind === 'var' ? 'var' : 'let'} ${all.join(', ')}; try { ${sets} } catch (e) { mcWarn(e); }`, b: '', replace: true });
        } else if (!/Declaration$/.test(s.type)) edits.push({ s: s.start, e: s.end, a: YIELD + 'try { ', b: ' } catch (e) { mcWarn(e); }' });
      }
      edits.push({ s: c.start, e: c.arguments[1].start, a: 'mcOnReady(' + (fn.async ? '' : 'async '), b: '', replace: true });
      edits.push({ s: fn.end, e: c.end, a: ')', b: '', replace: true });
    }
    if (!edits.length) return m;
    used = true;
    let j = js;
    for (const x of edits.sort((p, q) => q.s - p.s)) j = x.replace ? j.slice(0, x.s) + x.a + j.slice(x.e) : j.slice(0, x.s) + x.a + j.slice(x.s, x.e) + x.b + j.slice(x.e);
    // « au chargement complet de la page » : exécuté tout de suite s'il a déjà eu lieu pendant le démarrage découpé
    j = j.replace(/(^|[^.\w$])addEventListener\('load', /g, '$1mcOnLoad(');
    acorn.parse(j, { ecmaVersion: 'latest', sourceType: 'script' }); // contrôle : le script transformé reste valide
    return `<script${attrs}>${j}</script>`;
  });
  return used ? PRELUDE + '\n' + out : out;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V3 = path.join(HERE, '../../v3');
const OUT = path.join(HERE, '../motoscool/mc');

const P = (key, file, url, title, kw, kind) => ({ key, file, url, title, kw, kind });
const PAGES = [
  P('accueil', 'index.html', '/', "Moto's Cool – Accueil", 'garage moto Vitry-sur-Seine', 'accueil'),
  P('services/entretien', 'services/entretien.html', '/services/entretien.html', "Moto's Cool – Entretien & révision", 'entretien moto Vitry-sur-Seine', 'pages'),
  P('services/reparation', 'services/reparation.html', '/services/reparation.html', "Moto's Cool – Réparation mécanique", 'réparation moto Vitry-sur-Seine', 'pages'),
  P('services/depannage', 'services/depannage.html', '/services/depannage.html', "Moto's Cool – Dépannage moto", 'dépannage moto Île-de-France', 'pages'),
  P('services/freinage-pneus', 'services/freinage-pneus.html', '/services/freinage-pneus.html', "Moto's Cool – Freinage & pneus", 'freinage pneus moto', 'pages'),
  P('services/scooters', 'services/scooters.html', '/services/scooters.html', "Moto's Cool – Scooters", 'entretien scooter Vitry-sur-Seine', 'pages'),
  ...[['vitry-sur-seine', 'Vitry-sur-Seine'], ['ivry-sur-seine', 'Ivry-sur-Seine'], ['villejuif', 'Villejuif'], ['creteil', 'Créteil'], ['choisy-le-roi', 'Choisy-le-Roi'], ['maisons-alfort', 'Maisons-Alfort'], ['alfortville', 'Alfortville'], ['paris', 'Paris'], ['massy', 'Massy']]
    .map(([s, n]) => P('zones/' + s, `zones/${s}.html`, `/zones/${s}.html`, `Moto's Cool – Zone ${n}`, `garage moto ${n}`, 'pages')),
  P('mentions-legales', 'mentions-legales.html', '/mentions-legales.html', "Moto's Cool – Mentions légales", '', 'legal'),
  P('confidentialite', 'confidentialite.html', '/confidentialite.html', "Moto's Cool – Confidentialité", '', 'legal'),
];

// Noms et titres des blocs de l'accueil (identifiant de la section → nom lisible dans Elementor)
const HOME_NAMES = {
  accueil: ['mc_accueil_haut', 'Accueil : haut de page et rendez-vous'], 'ta-moto': ['mc_accueil_moteur3d', 'Accueil : moteur 3D (invisible)'],
  manifeste: ['mc_accueil_engagement', 'Accueil : notre engagement'], services: ['mc_accueil_services', 'Accueil : nos services (visite 3D)'],
  bigm: ['mc_accueil_texte_geant', 'Accueil : texte géant défilant'], 'en-panne': ['mc_accueil_en_panne', 'Accueil : en panne ? (4 étapes)'],
  depannage: ['mc_accueil_depannage', 'Accueil : dépannage (carte et zone)'], chiffres: ['mc_accueil_chiffres', 'Accueil : chiffres'],
  avis: ['mc_accueil_avis', 'Accueil : avis et paiement'], faq: ['mc_accueil_faq', 'Accueil : questions fréquentes'],
  photos: ['mc_accueil_photos', "Accueil : photos de l'atelier"], contact: ['mc_accueil_contact', 'Accueil : contact, horaires et plan'],
};

// ---------- Adresses : toutes ramenées à la racine du site (/assets/…, /services/…), valables sur chaque page ----------
function normUrl(v, pageUrl) {
  if (!v || /^(#|\/|[a-z][a-z0-9+.-]*:|\{|\$)/i.test(v) || v.includes('${')) return v;
  const u = new URL(v, 'https://x.invalid' + pageUrl);
  let p = u.pathname; if (p === '/index.html') p = '/';
  return p + u.search + u.hash;
}
function normHtml(src, pageUrl) {
  // seulement hors des <script> (le JavaScript garde ses propres chemins)
  return src.split(/(<script\b[\s\S]*?<\/script>)/i).map((part, i) => i % 2 ? part
    : part.replace(/(\s(?:href|src|action|poster|data-src|data-poster)=")([^"]*)"/g, (m, a, v) => a + normUrl(v, pageUrl) + '"')).join('');
}

// ---------- Extraction des champs d'un bloc ----------
const INLINE = new Set(['b', 'strong', 'em', 'i', 'br', 'small', 'a', 'span', 'abbr', 'sup', 'sub', 'code', 'mark', 'time', 'u', 's', 'q', 'cite', 'kbd', 'wbr', 'bdi']);
const SKIP = new Set(['script', 'style', 'svg', 'template', 'select', 'textarea', 'noscript', 'canvas', 'video', 'audio', 'iframe', 'object', 'picture', 'input', 'dialog']);
const isEl = n => !!n.tagName;
const textOf = n => n.nodeName === '#text' ? n.value : (n.childNodes || []).map(textOf).join('');
const attr = (n, a) => { const x = (n.attrs || []).find(z => z.name === a); return x ? x.value : null; };
const editAttr = (tag, a) => (tag === 'img' && (a === 'src' || a === 'alt')) || (tag === 'a' && a === 'href') || a === 'data-text';
function inlineOnly(n) { return (n.childNodes || []).every(c => c.nodeName === '#text' || c.nodeName === '#comment' || (isEl(c) && INLINE.has(c.tagName) && inlineOnly(c))); }
const isUnit = n => isEl(n) && !SKIP.has(n.tagName) && n.sourceCodeLocation && n.sourceCodeLocation.startTag && inlineOnly(n) && textOf(n).trim() !== '';
function sig(n) {
  if (n.nodeName === '#text') return n.value.trim() ? 'T' : '';
  if (!isEl(n)) return '';
  const at = (n.attrs || []).filter(a => !editAttr(n.tagName, a.name)).map(a => a.name + '=' + a.value).sort().join('&');
  if (SKIP.has(n.tagName)) return n.tagName + '[' + at + ']{' + crypto.createHash('md5').update(JSON.stringify(n.childNodes.map(c => c.nodeName + (c.value || '')))).digest('hex').slice(0, 6) + '}';
  if (isUnit(n)) return n.tagName + '[' + at + '](U)';
  return n.tagName + '[' + at + '](' + (n.childNodes || []).map(sig).filter(Boolean).join(',') + ')';
}
const LBL = { h1: 'Grand titre', h2: 'Titre', h3: 'Sous-titre', h4: 'Sous-titre', p: 'Texte', li: 'Ligne', a: 'Texte du lien', summary: 'Question', button: 'Texte du bouton', figcaption: 'Légende', label: 'Libellé', td: 'Case', th: 'En-tête de colonne', dt: 'Intitulé', dd: 'Valeur', b: 'Texte en gras', strong: 'Texte en gras', small: 'Petit texte', address: 'Adresse', legend: 'Légende', span: 'Texte', div: 'Texte', blockquote: 'Citation', caption: 'Titre du tableau', h5: 'Petit titre', h6: 'Petit titre', em: 'Texte' };
const snip = t => { t = t.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); return t.length > 42 ? t.slice(0, 40) + '…' : t; };
const labelFor = (n, kind, txt) => {
  const cls = attr(n, 'class') || '';
  let base = kind === 'link' ? 'Lien (adresse)' : kind === 'media' ? 'Photo' : kind === 'alt' ? 'Description de la photo' : kind === 'datatext' ? 'Texte décoratif'
    : /\bkicker\b/.test(cls) ? 'Surtitre' : /\bbtn\b/.test(cls) ? 'Texte du bouton' : /\blead\b/.test(cls) ? 'Introduction' : (LBL[n.tagName] || 'Texte');
  return txt ? base + ' : ' + snip(txt) : base;
};

function extract(src, { allowRep = true } = {}) {
  const frag = parseFragment(src, { sourceCodeLocationInfo: true });
  const fields = [], reps = [], edits = [];
  let fn = 0, rn = 0;
  const addField = (list, counter, s, e, t, def, label) => { const k = 'f' + (++counter.n); list.push({ k, t, d: def, label }); edits.push({ s, e, tok: k }); return k; };

  function walkInto(node, list, counter, edits, repOk) {
    for (const c of node.childNodes || []) walk(c, list, counter, edits, repOk);
  }
  function walk(n, list, counter, ed, repOk) {
    if (n.nodeName === '#text') {
      const raw = n.value; if (!raw.trim() || !n.sourceCodeLocation) return;
      const L = n.sourceCodeLocation, rs = src.slice(L.startOffset, L.endOffset);
      const lead = rs.length - rs.trimStart().length, trail = rs.length - rs.trimEnd().length;
      const parentLike = n.parentNode && isEl(n.parentNode) ? n.parentNode : { tagName: 'span' };
      list.push({ k: 'f' + (++counter.n), t: 'text', d: raw.trim(), label: labelFor(parentLike, 'text', raw) });
      ed.push({ s: L.startOffset + lead, e: L.endOffset - trail, tok: 'f' + counter.n });
      return;
    }
    if (!isEl(n) || !n.sourceCodeLocation) return;
    const tag = n.tagName;
    if (SKIP.has(tag) && tag !== 'input') return;
    const L = n.sourceCodeLocation;
    // attributs modifiables
    const attrField = (name, t, label) => {
      const al = L.attrs && L.attrs[name]; if (!al) return;
      const rawA = src.slice(al.startOffset, al.endOffset), m = rawA.match(/^[^=]+=(["']?)([\s\S]*?)\1$/); if (!m) return;
      const vs = al.startOffset + rawA.indexOf(m[2], rawA.indexOf('=')), ve = vs + m[2].length;
      const val = attr(n, name);
      list.push({ k: 'f' + (++counter.n), t, d: t === 'media' ? { url: val, id: '' } : val, label });
      ed.push({ s: vs, e: ve, tok: 'f' + counter.n });
    };
    if (tag === 'img') { attrField('src', 'media', labelFor(n, 'media', attr(n, 'alt') || '')); if (attr(n, 'alt')) attrField('alt', 'attr', 'Description de la photo'); return; }
    if (tag === 'input') return;
    if (attr(n, 'data-text') !== null) attrField('data-text', 'attr', labelFor(n, 'datatext', attr(n, 'data-text')));
    const linkOf = a => { const h = attr(a, 'href'); return h !== null && !/^javascript:/i.test(h); };
    if (isUnit(n)) {
      const kids = (n.childNodes || []).filter(c => isEl(c) || (c.nodeName === '#text' && c.value.trim()));
      const one = tag !== 'a' && kids.length === 1 && kids[0].tagName === 'a' && (kids[0].childNodes || []).every(c => c.nodeName === '#text') ? kids[0] : null;
      const target = tag === 'a' ? n : one;
      if (target && linkOf(target)) {
        const keep = { L: target.sourceCodeLocation, n: target };
        // lien : adresse + texte
        const al = keep.L.attrs.href, rawA = src.slice(al.startOffset, al.endOffset), m = rawA.match(/^[^=]+=(["']?)([\s\S]*?)\1$/);
        const vs = al.startOffset + rawA.indexOf(m[2], rawA.indexOf('=')), ve = vs + m[2].length;
        list.push({ k: 'f' + (++counter.n), t: 'link', d: attr(target, 'href'), label: 'Lien (adresse) : ' + snip(textOf(target)) }); ed.push({ s: vs, e: ve, tok: 'f' + counter.n });
        n = target;
      }
      const T = n.sourceCodeLocation, is = T.startTag.endOffset, ie = T.endTag ? T.endTag.startOffset : T.endOffset;
      const inner = src.slice(is, ie), hasTags = (n.childNodes || []).some(isEl);
      const lead = inner.length - inner.trimStart().length, trail = inner.length - inner.trimEnd().length;
      if (hasTags) list.push({ k: 'f' + (++counter.n), t: 'html', d: inner.trim(), label: labelFor(n.tagName === 'a' && !target ? n : (target ? n : n), 'text', textOf(n)) });
      else list.push({ k: 'f' + (++counter.n), t: 'text', d: textOf(n).trim(), label: labelFor(n, 'text', textOf(n)) });
      ed.push({ s: is + lead, e: ie - trail, tok: 'f' + counter.n });
      return;
    }
    if (tag === 'a' && linkOf(n)) attrField('href', 'link', 'Lien (adresse) : ' + snip(textOf(n)));
    // liste répétée → liste modifiable
    const kids = (n.childNodes || []).filter(isEl);
    const looseText = (n.childNodes || []).some(c => c.nodeName === '#text' && c.value.trim());
    if (repOk && kids.length >= 2 && !looseText && new Set(kids.map(sig)).size === 1 && kids.every(k => k.sourceCodeLocation)) {
      const items = kids.map(k => { const lst = [], ctr = { n: 0 }, ed2 = []; walk(k, lst, ctr, ed2, false); return { k, lst, ed2 }; });
      const shape = it => it.lst.map(f => f.t === 'html' ? 'text' : f.t).join(',');
      if (items[0].lst.length && items.every(it => shape(it) === shape(items[0]))) {
        // un même champ est « texte avec mise en forme » dans tous les éléments dès qu'un seul en a besoin
        items[0].lst.forEach((f, i) => { if (items.some(it => it.lst[i].t === 'html')) items.forEach(it => { const g = it.lst[i]; if (g.t === 'text') { g.t = 'html'; g.d = g.d.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } }); });
        const first = items[0], fs0 = first.k.sourceCodeLocation.startOffset, fe0 = first.k.sourceCodeLocation.endOffset;
        let tpl = src.slice(fs0, fe0);
        [...first.ed2].sort((a, b) => b.s - a.s).forEach(x => { tpl = tpl.slice(0, x.s - fs0) + '{{mci:' + x.tok + '}}' + tpl.slice(x.e - fs0); });
        // séparateur entre éléments : l'espacement le plus fréquent (sans les commentaires HTML)
        const gaps = items.slice(1).map((it, i) => src.slice(items[i].k.sourceCodeLocation.endOffset, it.k.sourceCodeLocation.startOffset).replace(/<!--[\s\S]*?-->/g, '').replace(/\n[ \t]*(?=\n)/g, ''));
        const sep = gaps.sort((a, b) => gaps.filter(x => x === b).length - gaps.filter(x => x === a).length)[0];
        const rk = 'r' + (++rn);
        const titleField = first.lst.find(f => f.t === 'text' || f.t === 'html');
        reps.push({
          k: rk, label: 'Liste : ' + snip(first.lst.filter(f => f.t === 'text' || f.t === 'html').map(f => f.d).join(' · ') || 'éléments'),
          tpl, sep, title: titleField ? titleField.k : first.lst[0].k,
          fields: first.lst.map(f => ({ ...f, label: f.label.replace(/ : .*$/, '') })),
          def: items.map(it => Object.fromEntries(it.lst.map(f => [f.k, f.d]))),
        });
        ed.push({ s: fs0, e: items[items.length - 1].k.sourceCodeLocation.endOffset, tok: rk, rep: true });
        return;
      }
    }
    walkInto(n, list, counter, ed, repOk);
  }
  const counter = { n: 0 };
  for (const c of frag.childNodes) walk(c, fields, counter, edits, allowRep);
  let template = src;
  [...edits].sort((a, b) => b.s - a.s).forEach(x => { template = template.slice(0, x.s) + (x.rep ? '{{mcr:' + x.tok + '}}' : '{{mc:' + x.tok + '}}') + template.slice(x.e); });
  return { template, fields, reps };
}

// ---------- Contrôle : le bloc rempli avec ses valeurs d'origine redonne exactement le HTML d'origine ----------
const decodeSafe = s => s;
function fill(tpl, fields, vals, p) {
  let out = tpl;
  for (const f of fields) {
    let v = vals[f.k]; if (v === undefined) v = f.d;
    if (f.t === 'media') v = v && v.url !== undefined ? v.url : v;
    v = String(v); if (f.t === 'text' || f.t === 'attr') v = v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    out = out.split('{{' + p + ':' + f.k + '}}').join(v);
  }
  return out;
}
function render(w, s) {
  let out = w.template;
  for (const r of w.reps) out = out.split('{{mcr:' + r.k + '}}').join((s[r.k] || r.def).map(it => fill(r.tpl, r.fields, it, 'mci')).join(r.sep));
  return fill(out, w.fields, s, 'mc');
}
const textNorm = h => { const f = parseFragment(h); const t = []; (function w(n) { if (n.nodeName === '#text') t.push(n.value); (n.childNodes || []).forEach(w); if (n.content) w(n.content); })(f); return t.join('').replace(/\s+/g, ' ').trim(); };
const attrsNorm = h => { const f = parseFragment(h); const t = []; (function w(n) { if (n.attrs) t.push(n.tagName + ':' + n.attrs.map(a => a.name + '=' + a.value).join('|')); (n.childNodes || []).forEach(w); if (n.content) w(n.content); })(f); return t.join('\n'); };

// ---------- Blocs « texte simple » : éditeur de texte d'Elementor ----------
const SIMPLE = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', ...INLINE]);
const simpleTree = n => (n.childNodes || []).every(c => c.nodeName === '#text' || c.nodeName === '#comment' || (isEl(c) && SIMPLE.has(c.tagName) && simpleTree(c)));

// ---------- Lecture des pages ----------
const widgets = {}, templates = {}, pagesOut = {}, seen = {};
const idGen = () => crypto.randomBytes(4).toString('hex').slice(0, 7);
let checks = 0, problems = [];

function registerWidget(name, title, w, origHtml) {
  const key = JSON.stringify([w.template, w.fields.map(f => f.t), w.reps.map(r => [r.tpl, r.sep, r.fields.map(f => f.t)])]);
  if (seen[key]) return seen[key];
  let nm = name, i = 2; while (widgets[nm]) nm = name + '_' + i++;
  widgets[nm] = { title, kind: 'bloc', template: w.template, fields: w.fields, reps: w.reps.map(r => ({ k: r.k, label: r.label, tpl: r.tpl, sep: r.sep, title: r.title, fields: r.fields, def: r.def.map(x => ({ _id: idGen(), ...x })) })), code: origHtml };
  seen[key] = nm; return nm;
}
function settingsOf(w) {
  const s = {};
  for (const f of w.fields) s[f.k] = f.d;
  for (const r of w.reps) s[r.k] = r.def.map(x => ({ _id: idGen(), ...x }));
  return s;
}
function block(name, title, html) {
  const w = extract(html);
  // contrôle d'exactitude
  const back = render(w, {});
  checks++;
  const nc = x => x.replace(/<!--[\s\S]*?-->/g, '');
  if (textNorm(nc(back)) !== textNorm(nc(html)) || attrsNorm(nc(back)) !== attrsNorm(nc(html))) { let i = 0; while (back[i] === html[i]) i++; const q = x => x.slice(Math.max(0, i - 50), i + 50).replace(/\n/g, '⏎'); problems.push(`${name} : diffère à « ${q(html)} »  ≠  « ${q(back)} »`); }
  const nm = registerWidget(name, title, w, html);
  return { w: nm, s: settingsOf(w) };
}
function texte(html, classe, enveloppe) { checks++; return { w: 'mc_texte', s: { contenu: html.trim(), classe: classe || '', enveloppe: enveloppe ? 'wrap' : '' } }; }

for (const pg of PAGES) {
  const raw = fs.readFileSync(path.join(V3, pg.file), 'utf8').replace(/\r\n?/g, '\n');
  const doc = parse(raw, { sourceCodeLocationInfo: true });
  const html = doc.childNodes.find(n => n.tagName === 'html');
  const head = html.childNodes.find(n => n.tagName === 'head'), body = html.childNodes.find(n => n.tagName === 'body');
  const slice = n => raw.slice(n.sourceCodeLocation.startOffset, n.sourceCodeLocation.endOffset);
  const inner = n => raw.slice(n.sourceCodeLocation.startTag.endOffset, n.sourceCodeLocation.endTag.startOffset);
  // <head> : sécurité de la démo retirée (Elementor et Rank Math ajoutent leurs scripts), balises SEO à part (Rank Math)
  let h = inner(head);
  h = h.replace(/[ \t]*<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, '')
    .replace(/[ \t]*<script>\/\* Anti-clickjacking[\s\S]*?<\/script>\n?/, '')
    .replace(/[ \t]*<!-- Démo : empêche Google[^\n]*\n/, '').replace(/[ \t]*<!-- Sécurité : seules les sources[^\n]*\n/, '')
    .replace(/[ \t]*<meta name="robots"[^>]*>\n?/, '');
  const seoRe = /[ \t]*(<title>[\s\S]*?<\/title>|<meta name="description"[^>]*>|<link rel="canonical"[^>]*>|<meta property="og:[^>]*>|<meta name="twitter:[^>]*>)\n?/g;
  const seoTags = (h.match(seoRe) || []).join('');
  h = h.replace(seoRe, '');
  const first = h.match(/[ \t]*<meta charset="[^"]*">\n?[ \t]*<meta name="viewport"[^>]*>\n?/) || h.match(/[ \t]*<meta charset="[^"]*">\n?/);
  const headFirst = first ? first[0] : ''; if (first) h = h.replace(first[0], '');
  // ordre : <meta charset> & viewport d'abord, puis wp_head(), puis le reste
  const title = (seoTags.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
  const desc = (seoTags.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  const dec = s => s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  const bsrc = normHtml(raw.slice(body.sourceCodeLocation.startTag.endOffset, body.sourceCodeLocation.endTag ? body.sourceCodeLocation.endTag.startOffset : body.sourceCodeLocation.endOffset), pg.url);
  const bdoc = parseFragment(bsrc, { sourceCodeLocationInfo: true });
  const S = n => bsrc.slice(n.sourceCodeLocation.startOffset, n.sourceCodeLocation.endOffset);
  const els = bdoc.childNodes.filter(isEl);
  const headerEl = els.find(n => n.tagName === 'header'), mainEl = els.find(n => n.tagName === 'main'), footerEl = els.find(n => n.tagName === 'footer');
  const pos = n => n.sourceCodeLocation;
  const pre = bsrc.slice(0, pos(headerEl).startOffset);
  const mid = bsrc.slice(pos(headerEl).endOffset, pos(mainEl).startOffset);
  const mainOpen = bsrc.slice(pos(mainEl).startOffset, pos(mainEl).startTag.endOffset);
  const afterMain = bsrc.slice(pos(mainEl).endOffset, pos(footerEl).startOffset);
  const post = bsrc.slice(pos(footerEl).endOffset);

  // En-tête et pied de page partagés (Modèles) ; « page en cours » retirée, remise à l'affichage
  const strip = x => x.replace(/ aria-current="page"/g, '');
  let foot = strip(S(footerEl)), credit = '';
  if (pg.key === 'mentions-legales') { const m = foot.match(/\n[ \t]*<p class="credit">[^<]*<\/p>/); if (m) { credit = m[0].trim(); foot = foot.replace(m[0], ''); } }
  if (pg.key === 'confidentialite') foot = foot.replace('href="#cookies"', 'href="/confidentialite.html#cookies"');
  const kindName = { accueil: 'accueil', pages: 'pages', legal: 'pages_legales' }[pg.kind];
  const kindTitle = { accueil: "page d'accueil", pages: 'pages services et zones', legal: 'pages légales' }[pg.kind];
  // Accueil : lien « Vidéos » dans le menu (masqué sur le site tant qu'aucune vidéo n'est publiée)
  let hdr = strip(S(headerEl));
  if (pg.kind === 'accueil') { const li = '<li><a href="#photos">Photos</a></li>'; if (!hdr.includes(li)) problems.push('menu : lien Photos introuvable'); hdr = hdr.replace(li, li + '\n        <li><a href="#videos">Vidéos</a></li>'); }
  for (const [part, src, lab] of [['entete', hdr, 'En-tête'], ['pied', foot, 'Pied de page']]) {
    const tk = part + '_' + kindName;
    const b = block('mc_' + tk, `${lab} (${kindTitle})`, src);
    if (!templates[tk]) templates[tk] = { title: `Moto's Cool – ${lab} (${kindTitle})`, widget: b.w, settings: b.s, kind: pg.kind, page: pg.key };
    else if (noId(templates[tk].settings) !== noId(b.s) && pg.kind !== 'legal') problems.push(`${pg.key} : ${lab} différent des autres pages`);
  }

  // Blocs du contenu
  const blocks = [];
  const kids = (mainEl.childNodes || []).filter(isEl);
  if (pg.kind === 'accueil') {
    // les photos de l'atelier deviennent des images de la page (modifiables dans WordPress)
    const galSrc = (raw.match(/gallery: \[([\s\S]*?)\n\s*\]/) || ['', ''])[1];
    const gal = [...galSrc.matchAll(/\{ src: '([^']+)', alt: "([^"]*)" \}/g)].map(m => ({ src: normUrl(m[1], pg.url), alt: m[2] }));
    for (const k of kids) {
      let src = S(k); const id = attr(k, 'id') || (attr(k, 'class') || '').split(' ')[0];
      if (id === 'photos') src = src.replace('<ul class="gallery rv" id="gallery" aria-label="Photos de l\'atelier"></ul>', '<ul class="gallery rv" id="gallery" aria-label="Photos de l\'atelier">' + gal.map(g => `\n        <li><img src="${g.src}" alt="${g.alt.replace(/"/g, '&quot;')}" loading="lazy" decoding="async"></li>`).join('') + '\n      </ul>');
      const [nm, tt] = HOME_NAMES[id] || ['mc_accueil_' + id.replace(/\W+/g, '_'), 'Accueil : ' + id];
      blocks.push(block(nm, tt, src));
      if (id === 'photos') blocks.push({ w: 'mc_videos', s: { kicker: 'Vidéos', titre: "L'atelier en vidéo.", intro: "Nos interventions, l'atelier et la vie du garage en images." } });
    }
  } else if (pg.kind === 'pages') {
    for (const k of kids) {
      if ((attr(k, 'class') || '') === 'wrap') {
        for (const c of k.childNodes.filter(isEl)) {
          if (c.tagName === 'section' && simpleTree(c) && !attr(c, 'id')) blocks.push(texte(inner2(bsrc, c), attr(c, 'class'), true));
          else blocks.push(block('mc_' + (attr(c, 'class') || c.tagName).split(' ')[0].replace(/\W+/g, '_'), (attr(c, 'class') || '').includes('callout') ? 'Encadré « Une question, une panne ? »' : 'Bloc', '<div class="wrap">\n      ' + S(c) + '\n    </div>'));
        }
      } else blocks.push(block('mc_' + (attr(k, 'class') || k.tagName).split(' ')[0].replace(/\W+/g, '_'), (attr(k, 'class') || '') === 'intro' ? 'Haut de page (titre, boutons, points clés)' : 'Bloc', S(k)));
    }
  } else {
    // pages légales : texte découpé à chaque titre ; tableaux et encadrés en blocs à part
    let chunk = [];
    const flush = () => { if (chunk.length) { blocks.push(texte(chunk.map(S).join('\n    '), '', false)); chunk = []; } };
    for (const k of kids) {
      if (simpleTree(k) && SIMPLE.has(k.tagName) && (!attr(k, 'id') || /^h[1-4]$/.test(k.tagName)) && !attr(k, 'style') && !(attr(k, 'class') || '').includes('box')) { if (k.tagName === 'h2') flush(); chunk.push(k); }
      else { flush(); blocks.push(block('mc_legal_' + (attr(k, 'class') || attr(k, 'id') || k.tagName).split(' ')[0].replace(/\W+/g, '_'), 'Bloc de texte', S(k))); }
    }
    flush();
    // ligne « Conception du site » : remise tout en bas du pied de page, sur cette page seulement (mc-page.php)
  }
  pagesOut[pg.key] = {
    key: pg.key, url: pg.url, title: pg.title, kind: pg.kind,
    htmlAttrs: raw.match(/<html([^>]*)>/)[1].trim(), headFirst, head: normHtml(h, pg.url),
    seo: { tags: normHtml(seoTags, pg.url), title: dec(title), description: dec(desc), keyword: pg.kw },
    bodyAttrs: (raw.match(/<body([^>]*)>/) || [])[1].trim(), pre, mid, mainOpen, afterMain, post: wrapScripts(post),
    header: 'entete_' + kindName, footer: 'pied_' + kindName, footerCredit: credit, blocks,
  };
}
function noId(o) { return JSON.stringify(o, (k, v) => k === '_id' ? undefined : v); }
function inner2(src, n) { const L = n.sourceCodeLocation; return src.slice(L.startTag.endOffset, L.endTag.startOffset); }

// Bloc partagé « Texte » et bloc « Vidéos »
widgets.mc_texte = { title: 'Texte (titres, paragraphes, listes)', kind: 'texte', template: '', fields: [], reps: [], code: '' };
widgets.mc_videos = { title: 'Vidéos (gérées dans le menu « Vidéos »)', kind: 'videos', template: '', fields: [], reps: [], code: '' };

// ---------- Écriture ----------
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, 'pages'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'widgets.json'), JSON.stringify(widgets));
fs.writeFileSync(path.join(OUT, 'templates.json'), JSON.stringify(templates));
const index = {};
for (const [k, p] of Object.entries(pagesOut)) { const f = k.replace(/\//g, '--') + '.json'; fs.writeFileSync(path.join(OUT, 'pages', f), JSON.stringify(p)); index[k] = { file: f, url: p.url, title: p.title, kind: p.kind }; }
fs.writeFileSync(path.join(OUT, 'pages.json'), JSON.stringify(index));
fs.writeFileSync(path.join(OUT, 'widgets-classes.php'), "<?php\n// Fichier généré par wordpress/tools/build-elementor.mjs : une classe par bloc Moto's Cool\nif (!defined('ABSPATH')) exit;\n" +
  Object.keys(widgets).map(n => `class MC_W_${n} extends MC_Widget { public $mc = '${n}'; }`).join('\n') + '\n');
const nf = Object.values(widgets).reduce((a, w) => a + w.fields.length + w.reps.reduce((b, r) => b + r.fields.length, 0), 0);
console.log(`${Object.keys(pagesOut).length} pages, ${Object.keys(widgets).length} types de blocs, ${Object.keys(templates).length} modèles, ${nf} champs modifiables`);
for (const [k, p] of Object.entries(pagesOut)) console.log(' ', k.padEnd(26), p.blocks.length, 'blocs', p.blocks.map(b => b.w.replace(/^mc_/, '')).join(' '));
console.log(`contrôles d'exactitude : ${checks}, problèmes : ${problems.length ? '\n  ' + problems.join('\n  ') : 'aucun'}`);
if (problems.length) process.exitCode = 1;
