// Liste des fichiers du site (motoscool/site) avec taille et empreinte : le thème léger s'en sert pour télécharger
// et vérifier les fichiers manquants. Option --online : vérifie que chaque fichier est identique sur le site de démo.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), R = path.join(HERE, '../..'), SITE = path.join(HERE, '../motoscool/site');
const SRC = 'https://said-94.github.io/maquette-mc-2026/';
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const list = walk(SITE).map(f => f.replace(/\\/g, '/').slice(SITE.replace(/\\/g, '/').length + 1)).sort().map(p => {
  const u = p.startsWith('assets/') ? (fs.existsSync(path.join(R, 'v3', p)) ? 'v3/' + p : p) : (p === 'sitemap.xml' ? p : 'v3/' + p);
  const b = fs.readFileSync(path.join(SITE, p));
  return { p, u, s: b.length, h: crypto.createHash('sha256').update(b).digest('hex') };
});
fs.writeFileSync(path.join(HERE, '../motoscool/site-files.json'), JSON.stringify(list));
console.log(`site-files.json : ${list.length} fichiers, ${(list.reduce((a, f) => a + f.s, 0) / 1048576).toFixed(1)} Mo`);
if (process.argv.includes('--online')) {
  const bad = []; let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => { while (i < list.length) { const f = list[i++]; try { const r = await fetch(SRC + encodeURI(f.u), { headers: { 'Accept-Encoding': 'identity' } }); const b = Buffer.from(await r.arrayBuffer()); if (r.status !== 200 || crypto.createHash('sha256').update(b).digest('hex') !== f.h) bad.push(f.p); } catch (e) { bad.push(f.p); } } }));
  fs.writeFileSync(path.join(HERE, 'online-diff.json'), JSON.stringify(bad));
  console.log(bad.length ? `${bad.length} fichier(s) différent(s) en ligne (mis dans le zip léger)` : 'tous identiques en ligne');
}
