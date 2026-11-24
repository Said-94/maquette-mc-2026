// Rend le script de la page d'accueil tolérant aux blocs supprimés dans Elementor (une seule fois, sur v3/index.html)
// 1. $('#x') renvoie un élément « fantôme » (du bon type, hors de la page) si le bloc a été retiré : plus d'erreur bloquante
// 2. Effet d'arrivée des parties : ne dépend plus de main > section (Elementor ajoute des enveloppes)
// 3. Photos : les photos présentes dans la page (choisies dans WordPress) passent avant la liste SITE.gallery
// 4. SMS du dépanneur : 06 33 66 04 10
const fs = require('fs');
const { parse } = require('parse5');
const F = __dirname + '/../../v3/index.html';
let s = fs.readFileSync(F, 'utf8');
const rep = (a, b) => { const n = s.split(a).length - 1; if (n !== 1) throw new Error(n + ' occurrence(s) : ' + a.slice(0, 80)); s = s.replace(a, b); };

// Types des éléments cherchés par identifiant (pour fabriquer un remplaçant du même type)
const tags = {};
(function walk(n) { if (n.attrs) { const id = n.attrs.find(a => a.name === 'id'); if (id && n.tagName && !['div', 'span', 'section'].includes(n.tagName)) tags[id.value] = n.tagName; } (n.childNodes || []).forEach(walk); if (n.content) walk(n.content); })(parse(s));
const used = new Set([...s.matchAll(/\$\('#([\w-]+)'\)/g)].map(m => m[1]));
const map = Object.fromEntries([...used].filter(id => tags[id]).sort().map(id => [id, tags[id]]));

rep(`    const $ = s => document.querySelector(s);`,
`    // Bloc retiré de la page (Elementor) : élément remplaçant hors de la page, pour que le reste du site continue de fonctionner
    const MC_TAG = ${JSON.stringify(map)}, mcStubs = {};
    const $ = s => document.querySelector(s) || mcStubs[s] || (mcStubs[s] = document.createElement(MC_TAG[s.replace(/^#/, '')] || 'div'));`);
rep(`const secs = [...document.querySelectorAll('main > section:not(.hero), main > div.bigm')];`,
    `const secs = [...document.querySelectorAll('main section:not(.hero), main div.bigm')].filter(x => !x.parentElement.closest('section'));`);
rep(`const list = $('#gallery'), photos = (SITE.gallery || []).filter(p => p && p.src);`,
`const list = $('#gallery'), inPage = [...list.querySelectorAll('img')].map(im => ({ src: im.getAttribute('src'), alt: im.getAttribute('alt') || '' })).filter(p => p.src);
      const photos = inPage.length ? inPage : (SITE.gallery || []).filter(p => p && p.src);
      list.replaceChildren();`);
rep(`    sms: '0633660470',`, `    sms: '0633660410',`);
fs.writeFileSync(F, s);
console.log('script de l\'accueil corrigé ; types connus :', Object.keys(map).length);
