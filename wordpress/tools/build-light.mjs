// Thème léger (pour un hébergement qui refuse le gros zip) : le code, les pages, les textes et les petites images ;
// les vidéos, la 3D et les photos sont téléchargées par le serveur après l'installation, puis vérifiées (empreinte sha256).
// Un fichier qui n'est pas identique sur le site de démonstration est mis dans le zip.
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)), T = path.join(HERE, '../motoscool'), OUT = path.join(HERE, '../light');
execFileSync(process.execPath, [path.join(HERE, 'build-manifest.mjs'), '--online'], { stdio: 'inherit' });
const diff = new Set(JSON.parse(fs.readFileSync(path.join(HERE, 'online-diff.json'), 'utf8')));
fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(path.join(OUT, 'motoscool/site'), { recursive: true });
for (const f of fs.readdirSync(T)) { if (f === 'site') continue; fs.cpSync(path.join(T, f), path.join(OUT, 'motoscool', f), { recursive: true }); }
const list = JSON.parse(fs.readFileSync(path.join(T, 'site-files.json'), 'utf8'));
const TEXT = /\.(html|js|mjs|css|json|webmanifest|svg|txt|xml)$/i;
let inc = 0, incB = 0, fetchN = 0, fetchB = 0;
for (const f of list) {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._\/-]*$/.test(f.p)) throw new Error('nom refusé : ' + f.p);
  if (TEXT.test(f.p) || f.s <= 50000 || diff.has(f.p)) { const d = path.join(OUT, 'motoscool/site', f.p); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(T, 'site', f.p), d); inc++; incB += f.s; }
  else { fetchN++; fetchB += f.s; }
}
// Empreintes des fichiers du thème (hors site/, vérifié par site-files.json) : le contrôle de sécurité quotidien
// repère ainsi un fichier du thème modifié ou un programme ajouté par un pirate
{
  const crypto = await import('node:crypto'), base = path.join(OUT, 'motoscool');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (e.name === 'site' && d === base ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
  const emp = {};
  for (const f of walk(base).sort()) { const rel = path.relative(base, f).replace(/\\/g, '/'); if (rel !== 'mc-empreintes.json') emp[rel] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); }
  fs.writeFileSync(path.join(base, 'mc-empreintes.json'), JSON.stringify(emp));
  console.log(`mc-empreintes.json : ${Object.keys(emp).length} fichiers du thème`);
}
const zip = path.join(OUT, 'motoscool-theme-leger.zip');
execFileSync('C:/Windows/System32/tar.exe', ['-a', '-cf', zip, 'motoscool'], { cwd: OUT });
const z = fs.readFileSync(zip);
if (z[0] !== 0x50 || z[1] !== 0x4b) throw new Error('archive non zip');
console.log(`dans le zip : ${inc} fichiers du site (${(incB / 1048576).toFixed(2)} Mo) + le thème ; téléchargés par le serveur : ${fetchN} fichiers (${(fetchB / 1048576).toFixed(1)} Mo)`);
console.log(`zip léger : ${zip} — ${(z.length / 1048576).toFixed(2)} Mo`);
