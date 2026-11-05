/**
 * Moto's Cool — moto sportive 3D en fond de page (three.js r160, module ES).
 * Chargé à la demande par index.html (import dynamique résolu par l'importmap) :
 *   - mobile ou économie de données : au premier geste ; ordinateur : après le chargement, au repos.
 * Rôle : décor uniquement. Le texte, les cartes et les boutons restent toujours au premier plan.
 *
 * init(options) construit la moto procédurale (ou charge SITE.bikeModel en GLB), crée le rendu de
 * l'accueil et, sur ordinateur, celui de la visite des services. Expose window.MC3D :
 *   { setPaint(nom), boost(v), speed(v), tour(progression 0..1), startTour(), paints, canTour }
 * La vue de la visite (second contexte WebGL) n'est créée que par startTour(), quand la page l'active vraiment.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Finition « cinéma » (ordinateur, niveau haut) : vignettage léger et grain de film animé
const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uGrain: { value: 0.03 }, uVig: { value: 0.3 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uGrain, uVig; varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - uVig * smoothstep(0.15, 0.75, dot(d, d) * 2.0);
      c.rgb += (h(vUv * 1024.0 + fract(uTime) * 61.0) - 0.5) * uGrain;
      gl_FragColor = c;
    }`
};

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const V3 = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const V2 = (x, y) => new THREE.Vector2(x, y);
const UP = V3(0, 1, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * t * (t * (t * 6 - 15) + 10); // smootherstep : départs et arrivées très doux

/** Teintes proposées par le sélecteur « Ta moto » */
export const PAINTS = {
  noir: { label: 'Noir carbone', color: 0x262626, metalness: 0.4, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0 },
  rouge: { label: 'Rouge', color: 0xc8161d, metalness: 0.35, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0 },
  blanc: { label: 'Blanc nacré', color: 0xefece5, metalness: 0.05, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 0.5 },
  titane: { label: 'Gris titane', color: 0x8a8d93, metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 0 },
  bleu: { label: 'Bleu nuit', color: 0x17264f, metalness: 0.5, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0 }
};

/* Arrêts de caméra de la visite, en coordonnées normalisées de la boîte englobante
   (fx : arrière 0 → avant 1, fy : sol 0 → haut 1, fz : côté gauche 0 → côté droit 1).
   az : azimut en degrés (0 = côté droit, 90 = face avant), el : élévation, d : distance (× longueur / 2,035 m). */
const STOPS = [
  { f: [0.518, 0.47, 0.50], az: 32, el: 9, d: 3.7 },     // vue d'ensemble
  { f: [0.46, 0.5, 0.55], az: 14, el: 10, d: 3.0 },      // dépannage : le moteur fume
  { f: [0.828, 0.31, 0.58], az: 38, el: 6, d: 1.6 },      // roue avant, frein
  { f: [0.528, 0.45, 0.595], az: -4, el: 8, d: 1.75 },    // moteur
  { f: [0.302, 0.33, 0.333], az: -152, el: 14, d: 1.5 }, // chaîne, transmission (côté gauche)
  { f: [0.774, 0.81, 0.50], az: -295, el: 16, d: 1.7 },  // poste de pilotage, phare
  { f: [0.474, 0.47, 0.50], az: -405, el: 12, d: 3.4 }    // arrière trois-quarts
];
const BIKE_LEN = 2.035; // longueur hors tout de la moto procédurale (m)

/* ------------------------------------------------------------------ textures procédurales */
function canvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
// Carte de hauteur (canal rouge) → carte de normales
function heightToNormal(src, strength) {
  const w = src.width, h = src.height, s = src.getContext('2d').getImageData(0, 0, w, h).data;
  return canvas(w, h, (g) => {
    const img = g.createImageData(w, h), d = img.data;
    const H = (x, y) => s[((((y + h) % h) * w) + ((x + w) % w)) * 4] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
      d[i] = (dx / l * 0.5 + 0.5) * 255; d[i + 1] = (dy / l * 0.5 + 0.5) * 255; d[i + 2] = (1 / l * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}
function tex(c, { srgb = false, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  return t;
}
function makeTextures(q) {
  const T = {};
  const big = q !== 'low';
  // Bande de roulement (sans inscription) : rainures en chevrons sur les épaules du pneu
  T.tread = tex(heightToNormal(canvas(big ? 1024 : 512, 128, (g, w, h) => {
    g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#000'; g.lineCap = 'round'; g.lineWidth = big ? 7 : 4;
    const n = 36, p = w / n;
    for (let i = 0; i < n; i++) {
      const x = i * p;
      g.beginPath(); g.moveTo(x, h * 0.28); g.quadraticCurveTo(x + p * 0.3, h * 0.4, x + p * 0.75, h * 0.46); g.stroke();
      g.beginPath(); g.moveTo(x + p / 2, h * 0.72); g.quadraticCurveTo(x + p * 0.8, h * 0.6, x + p * 1.25, h * 0.54); g.stroke();
    }
  }), 3));
  // Selle surpiquée : panneaux matelassés + coutures
  T.seat = tex(heightToNormal(canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, w, h);
    const n = 8, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const gr = g.createRadialGradient((i + 0.5) * s, (j + 0.5) * s, 2, (i + 0.5) * s, (j + 0.5) * s, s * 0.7);
      gr.addColorStop(0, '#c8c8c8'); gr.addColorStop(1, '#6a6a6a');
      g.fillStyle = gr; g.fillRect(i * s, j * s, s, s);
    }
    g.strokeStyle = '#202020'; g.lineWidth = 3;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, h); g.stroke(); g.beginPath(); g.moveTo(0, i * s); g.lineTo(w, i * s); g.stroke(); }
    g.strokeStyle = '#e8e8e8'; g.lineWidth = 2; g.setLineDash([5, 5]);
    for (let i = 0; i <= n; i++) for (const o of [-6, 6]) {
      g.beginPath(); g.moveTo(i * s + o, 0); g.lineTo(i * s + o, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * s + o); g.lineTo(w, i * s + o); g.stroke();
    }
  }), 4), { repeat: [6, 6] });
  // Fibre de carbone (sergé 2/2)
  T.carbon = tex(canvas(256, 256, (g, w) => {
    const n = 16, s = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const horiz = ((i + j) >> 1) % 2 === 0;
      const gr = horiz ? g.createLinearGradient(i * s, j * s, i * s, (j + 1) * s) : g.createLinearGradient(i * s, j * s, (i + 1) * s, j * s);
      gr.addColorStop(0, '#0c0c0e'); gr.addColorStop(0.5, horiz ? '#3a3b40' : '#26272b'); gr.addColorStop(1, '#0c0c0e');
      g.fillStyle = gr; g.fillRect(i * s, j * s, s, s);
    }
  }), { srgb: true, repeat: [10, 10] });
  // Teinte de chauffe des collecteurs : doré → violet → bleu → acier
  T.heat = tex(canvas(512, 4, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, 0);
    gr.addColorStop(0, '#e2b066'); gr.addColorStop(0.18, '#b97a3c'); gr.addColorStop(0.36, '#6c3f8f');
    gr.addColorStop(0.55, '#36549e'); gr.addColorStop(0.8, '#8a8d95'); gr.addColorStop(1, '#a7aab1');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }), { srgb: true });
  T.heat.wrapS = THREE.ClampToEdgeWrapping;
  // Métal brossé (rugosité striée dans le sens de la longueur)
  T.brushed = tex(canvas(512, 64, (g, w, h) => {
    g.fillStyle = '#5a5a5a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { const v = 70 + Math.random() * 60 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * w, 0, 1, h); }
  }));
  // Halo lumineux, ombre de contact, fondu du sol
  T.glow = tex(canvas(128, 128, (g) => {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }), { srgb: true });
  T.shadow = tex(canvas(256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,.9)'); gr.addColorStop(0.45, 'rgba(0,0,0,.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }), { srgb: true });
  T.fade = tex(canvas(256, 256, (g) => {
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, '#fff'); gr.addColorStop(0.55, '#888'); gr.addColorStop(1, '#000');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }));
  // Décor latéral du carénage
  T.decal = tex(canvas(1024, 192, (g, w, h) => {
    g.font = "900 104px Orbitron, 'Arial Black', sans-serif"; g.textBaseline = 'middle';
    const a = "MOTO'S ", b = 'COOL', wa = g.measureText(a).width, wb = g.measureText(b).width, x0 = (w - wa - wb) / 2;
    g.fillStyle = 'rgba(8,8,10,.82)';
    g.beginPath(); g.moveTo(x0 - 60, 20); g.lineTo(w - x0 + 70, 20); g.lineTo(w - x0 + 30, h - 20); g.lineTo(x0 - 100, h - 20); g.closePath(); g.fill();
    g.fillStyle = '#ffffff'; g.fillText(a, x0, h / 2 + 4);
    g.fillStyle = '#ef4136'; g.fillText(b, x0 + wa, h / 2 + 4);
  }), { srgb: true });
  T.decal.wrapS = T.decal.wrapT = THREE.ClampToEdgeWrapping;
  return T;
}
// Fond de studio (dégradé) pour les vues avec post-traitement, identique au fond CSS
function studioBackground(kind) {
  return tex(canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#303036'; g.fillRect(0, 0, w, h);
    const [cx, cy] = kind === 'hero' ? [0.72, 0.55] : [0.38, 0.55];
    const gr = g.createRadialGradient(cx * w, cy * h, 0, cx * w, cy * h, w * 0.62);
    gr.addColorStop(0, kind === 'hero' ? 'rgba(230,48,39,.22)' : 'rgba(230,48,39,.12)'); gr.addColorStop(1, 'rgba(230,48,39,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }), { srgb: true });
}

/* ------------------------------------------------------------------ matériaux */
function makeMaterials(T) {
  const P = o => new THREE.MeshPhysicalMaterial(o);
  const M = {
    paint: P({ name: 'paint', color: PAINTS.noir.color, metalness: 0.4, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03 }),
    black: P({ color: 0x0c0c0e, metalness: 0.1, roughness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    matte: P({ color: 0x141416, metalness: 0.2, roughness: 0.75 }),
    carbon: P({ map: T.carbon, color: 0xffffff, metalness: 0.3, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.05 }),
    rubber: P({ color: 0x141416, roughness: 0.86, metalness: 0, normalMap: T.tread, normalScale: V2(1.2, 1.2) }),
    rim: P({ color: 0x121215, metalness: 0.75, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.08 }),
    rimIn: P({ color: 0x121215, metalness: 0.75, roughness: 0.3, side: THREE.DoubleSide }),
    chrome: P({ color: 0xffffff, metalness: 1, roughness: 0.06 }),
    alu: P({ color: 0xbfc3cb, metalness: 1, roughness: 0.3 }),
    darkAlu: P({ color: 0x34363c, metalness: 0.9, roughness: 0.36 }),
    engine: P({ color: 0x232429, metalness: 0.85, roughness: 0.42 }),
    fins: P({ color: 0x6b6e76, metalness: 0.95, roughness: 0.32 }),
    gold: P({ color: 0xd4a245, metalness: 1, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.1 }),
    steel: P({ color: 0x9a9da5, metalness: 1, roughness: 0.2 }),
    disc: P({ color: 0xb4b8c0, metalness: 1, roughness: 0.16, side: THREE.DoubleSide }),
    header: P({ map: T.heat, color: 0xffffff, metalness: 1, roughness: 0.18, iridescence: 0.6, iridescenceIOR: 1.7, iridescenceThicknessRange: [200, 650] }),
    titanium: P({ color: 0xa3a7b0, metalness: 1, roughness: 0.3, roughnessMap: T.brushed, anisotropy: 0.7 }),
    seat: P({ color: 0x151517, roughness: 0.82, metalness: 0, normalMap: T.seat, normalScale: V2(0.9, 0.9), sheen: 0.5, sheenColor: 0x3a3a40, sheenRoughness: 0.5 }),
    spring: P({ color: 0xd42a21, metalness: 0.4, roughness: 0.3, clearcoat: 1 }),
    glass: P({ color: 0x1a222c, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.42, clearcoat: 1, depthWrite: false }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf4ff, emissiveIntensity: 4 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x2a0000, emissive: 0xff1a12, emissiveIntensity: 4 }),
    amber: new THREE.MeshStandardMaterial({ color: 0x2a1500, emissive: 0xff9f1a, emissiveIntensity: 1.4 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x05070a, emissive: 0x7fbfff, emissiveIntensity: 0.7 }),
    decal: new THREE.MeshStandardMaterial({ map: T.decal, transparent: true, roughness: 0.3, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4 })
  };
  M.carbonFlat = M.carbon.clone(); M.carbonFlat.map = T.carbon.clone(); M.carbonFlat.map.repeat.set(30, 30);
  return M;
}

/* ------------------------------------------------------------------ outils de géométrie */
function rod(a, b, r, mat, seg = 20, rTop) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop ?? r, r, d.length(), seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  return m;
}
function tube(pts, r, mat, seg = 80, radial = 16) {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, radial), mat);
}
// Profil latéral extrudé, chanfreiné, lissé ; taper(x, y) affine la largeur
function shell(shape, depth, mat, taper, bevel = 0.03, opts = {}) {
  let g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.85, bevelSegments: opts.bevelSegments || 6, curveSegments: opts.curveSegments || 36 });
  g.translate(0, 0, -depth / 2);
  if (taper) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * taper(p.getX(i), p.getY(i))); }
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  if (opts.uv) { // projection plane pour les textures (selle : vue de dessus)
    const p = g.attributes.position, uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * opts.uv; uv[i * 2 + 1] = p.getZ(i) * opts.uv; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return new THREE.Mesh(g, mat);
}
const rbox = (w, h, d, r, mat, seg = 4) => new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, r), mat);
function lathe(points, mat, seg = 96) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => V2(r, y)), seg);
  return new THREE.Mesh(g, mat);
}
// Disque percé (extrusion avec trous)
function discGeometry(rO, rI, holes, depth, curve) {
  const s = new THREE.Shape(); s.absarc(0, 0, rO, 0, TAU, false);
  const inner = new THREE.Path(); inner.absarc(0, 0, rI, 0, TAU, true); s.holes.push(inner);
  for (let i = 0; i < holes; i++) {
    const a = i / holes * TAU, r = rI + (rO - rI) * (i % 2 ? 0.36 : 0.64);
    const p = new THREE.Path(); p.absarc(Math.cos(a) * r, Math.sin(a) * r, (rO - rI) * 0.11, 0, TAU, true); s.holes.push(p);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 1, curveSegments: curve });
  g.translate(0, 0, -depth / 2);
  return g;
}
function ringGeometry(rO, rI, holes, holeR, holeAt, depth, curve) {
  const s = new THREE.Shape(); s.absarc(0, 0, rO, 0, TAU, false);
  const inner = new THREE.Path(); inner.absarc(0, 0, rI, 0, TAU, true); s.holes.push(inner);
  for (let i = 0; i < holes; i++) { const a = i / holes * TAU; const p = new THREE.Path(); p.absarc(Math.cos(a) * holeAt, Math.sin(a) * holeAt, holeR, 0, TAU, true); s.holes.push(p); }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 2, curveSegments: curve });
  g.translate(0, 0, -depth / 2);
  return g;
}
function sprocketGeometry(teeth, rRoot, rTip, depth, holes, curve) {
  const s = new THREE.Shape();
  for (let i = 0; i <= teeth * 4; i++) {
    const a = i / (teeth * 4) * TAU, k = i % 4, r = k === 1 || k === 2 ? rTip : rRoot;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const c = new THREE.Path(); c.absarc(0, 0, rRoot * 0.3, 0, TAU, true); s.holes.push(c);
  for (let i = 0; i < holes; i++) { const a = i / holes * TAU; const p = new THREE.Path(); p.absarc(Math.cos(a) * rRoot * 0.62, Math.sin(a) * rRoot * 0.62, rRoot * 0.17, 0, TAU, true); s.holes.push(p); }
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.001, bevelSize: 0.001, bevelSegments: 1, curveSegments: curve });
  g.translate(0, 0, -depth / 2);
  return g;
}

/* ------------------------------------------------------------------ chaîne */
const CHAIN = { r: V2(-0.70, 0.315), rr: 0.10, f: V2(-0.11, 0.40), rf: 0.042, z: -0.14 };
const chainPath = (() => {
  const { r, rr, f, rf } = CHAIN;
  const segs = [
    { k: 'line', a: V2(r.x, r.y + rr), b: V2(f.x, f.y + rf) },
    { k: 'arc', c: f, rad: rf, a0: Math.PI / 2, dir: -1 },
    { k: 'line', a: V2(f.x, f.y - rf), b: V2(r.x, r.y - rr) },
    { k: 'arc', c: r, rad: rr, a0: -Math.PI / 2, dir: -1 }
  ];
  segs.forEach(s => { s.len = s.k === 'line' ? s.a.distanceTo(s.b) : Math.PI * s.rad; });
  const L = segs.reduce((n, s) => n + s.len, 0);
  const at = d => {
    d = ((d % L) + L) % L;
    for (const s of segs) {
      if (d <= s.len) {
        if (s.k === 'line') { const t = d / s.len; return { x: lerp(s.a.x, s.b.x, t), y: lerp(s.a.y, s.b.y, t), ang: Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) }; }
        const ang = s.a0 + s.dir * d / s.rad;
        return { x: s.c.x + Math.cos(ang) * s.rad, y: s.c.y + Math.sin(ang) * s.rad, ang: ang - Math.PI / 2 };
      }
      d -= s.len;
    }
    return { x: 0, y: 0, ang: 0 };
  };
  return { L, at };
})();
function chainGeometry() {
  const plate = new RoundedBoxGeometry(0.0172, 0.0092, 0.0018, 2, 0.0008);
  const a = plate.clone().translate(0, 0, 0.0048), b = plate.clone().translate(0, 0, -0.0048);
  const roller = new THREE.CylinderGeometry(0.0034, 0.0034, 0.0078, 12).rotateX(Math.PI / 2);
  const pin = new THREE.CylinderGeometry(0.0016, 0.0016, 0.0125, 8).rotateX(Math.PI / 2).translate(0.0078, 0, 0);
  return mergeGeometries([a, b, roller, pin].map(g => (g.index ? g.toNonIndexed() : g)));
}
function placeChain(mesh, offset) {
  const n = mesh.count, pitch = chainPath.L / n, m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = V3(1, 1, 1), p = V3(0, 0, 0), e = new THREE.Euler();
  for (let i = 0; i < n; i++) {
    const pt = chainPath.at(i * pitch + offset);
    p.set(pt.x, pt.y, CHAIN.z); e.set(0, 0, pt.ang); q.setFromEuler(e); s.set(1, 1, i % 2 ? 0.78 : 1);
    m.compose(p, q, s); mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/* ------------------------------------------------------------------ roue */
function makeWheel(M, o, Q) {
  const { R, W, rimR } = o;
  const g = new THREE.Group();
  // Pneu : profil arrondi tourné autour de l'axe
  const sh = Math.min(W * 0.42, (R - rimR) * 0.6), prof = [[rimR - 0.004, -W * 0.36], [rimR + 0.03, -W * 0.47]];
  for (let i = 0; i <= 20; i++) { const a = -Math.PI / 2 + Math.PI * i / 20; prof.push([R - sh + sh * Math.cos(a), W / 2 * Math.sin(a)]); }
  prof.push([rimR + 0.03, W * 0.47], [rimR - 0.004, W * 0.36]);
  const tyre = lathe(prof, M.rubber, Q.lathe); tyre.geometry.rotateX(Math.PI / 2); g.add(tyre);
  // Jante : fût et rebords
  const rimP = [[rimR + 0.008, 0.43], [rimR - 0.003, 0.41], [rimR - 0.012, 0.32], [rimR - 0.015, 0], [rimR - 0.012, -0.32], [rimR - 0.003, -0.41], [rimR + 0.008, -0.43]].map(([r, z]) => [r, z * W]);
  const rim = lathe(rimP, M.rimIn, Q.lathe); rim.geometry.rotateX(Math.PI / 2); g.add(rim);
  // Liseré de peinture sur la jante (suit la teinte choisie)
  for (const z of [-1, 1]) { const t = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.006, 0.0022, 8, Q.lathe), M.paint); t.position.z = z * W * 0.415; g.add(t); }
  // Branches : 5 doubles bâtons coulés + moyeu
  const parts = [];
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * TAU + Math.PI / 2;
    for (const s of [-1, 1]) {
      const a0 = a + s * 0.07, a1 = a + s * 0.21, r0 = 0.05, r1 = rimR - 0.011, w0 = 0.011, w1 = 0.0075;
      const pt = (r, an, off) => V2(Math.cos(an) * r - Math.sin(an) * off, Math.sin(an) * r + Math.cos(an) * off);
      const shp = new THREE.Shape([pt(r0, a0, -w0), pt(r1 * 0.55, lerp(a0, a1, 0.45), -w0 * 0.85), pt(r1, a1, -w1), pt(r1, a1, w1), pt(r1 * 0.55, lerp(a0, a1, 0.45), w0 * 0.85), pt(r0, a0, w0)]);
      const eg = new THREE.ExtrudeGeometry(shp, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.003, bevelSegments: 3 });
      eg.translate(0, 0, -0.007); parts.push(eg);
    }
  }
  const hub = new THREE.CylinderGeometry(0.056, 0.056, W * 0.62, 40).rotateX(Math.PI / 2);
  parts.push(hub.toNonIndexed());
  g.add(new THREE.Mesh(mergeGeometries(parts), M.rim));
  g.add(rod(V3(0, 0, -W * 0.55), V3(0, 0, W * 0.55), 0.018, M.chrome, 20));
  // Disques percés sur flasques flottantes
  (o.discs || []).forEach(z => {
    const disc = new THREE.Mesh(discGeometry(o.discR, o.discR * 0.72, Q.holes, 0.005, Q.curve), M.disc); disc.position.z = z; g.add(disc);
    const car = new THREE.Mesh(ringGeometry(o.discR * 0.72 + 0.002, 0.048, 6, o.discR * 0.09, o.discR * 0.48, 0.006, Q.curve), M.darkAlu);
    car.position.z = z - Math.sign(z) * 0.002; g.add(car);
    const bob = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.011, 12).rotateX(Math.PI / 2), M.chrome, 10);
    const mm = new THREE.Matrix4();
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; mm.makeTranslation(Math.cos(a) * o.discR * 0.72, Math.sin(a) * o.discR * 0.72, z); bob.setMatrixAt(i, mm); }
    g.add(bob);
    g.add(rod(V3(0, 0, 0), V3(0, 0, z), 0.05, M.darkAlu, 32));
  });
  if (o.sprocket) {
    const sp = new THREE.Mesh(sprocketGeometry(42, 0.098, 0.106, 0.006, 5, Q.curve), M.alu); sp.position.z = CHAIN.z; g.add(sp);
    g.add(rod(V3(0, 0, 0), V3(0, 0, CHAIN.z), 0.052, M.darkAlu, 32));
  }
  return g;
}
// Étrier radial (or anodisé) placé à l'angle th sur le disque
function caliper(M, cx, cy, r, th, z) {
  const c = rbox(0.105, 0.046, 0.05, 0.012, M.gold, 4);
  c.position.set(cx + Math.cos(th) * r, cy + Math.sin(th) * r, z);
  c.rotation.z = th + Math.PI / 2;
  return c;
}

/* ------------------------------------------------------------------ moto procédurale complète */
function buildBike(M, T, Q) {
  const bike = new THREE.Group();
  const add = o => { bike.add(o); return o; };
  const FA = V3(0.72, 0.30), RA = V3(-0.70, 0.315);

  // Roues
  const wf = makeWheel(M, { R: 0.30, W: 0.125, rimR: 0.215, discs: [0.078, -0.078], discR: 0.16 }, Q);
  wf.name = 'wheelF'; wf.position.copy(FA); add(wf);
  const wr = makeWheel(M, { R: 0.315, W: 0.18, rimR: 0.215, discs: [0.135], discR: 0.11, sprocket: true }, Q);
  wr.name = 'wheelR'; wr.position.copy(RA); add(wr);
  for (const z of [0.078, -0.078]) add(caliper(M, FA.x, FA.y, 0.138, 150 * DEG, z));
  add(caliper(M, RA.x, RA.y, 0.092, -112 * DEG, 0.135));

  // Fourche inversée (fourreaux dorés), tés, guidons bracelets
  const rake = 24 * DEG, d = V3(-Math.sin(rake), Math.cos(rake));
  const P = k => FA.clone().addScaledVector(d, k);
  for (const z of [0.1, -0.1]) {
    const foot = rbox(0.06, 0.085, 0.044, 0.012, M.darkAlu); foot.position.copy(P(0.02)).setZ(z); foot.rotation.z = rake; add(foot);
    add(rod(P(0.04).setZ(z), P(0.40).setZ(z), 0.0215, M.gold, Q.seg));
    add(rod(P(0.33).setZ(z), P(0.71).setZ(z), 0.03, M.darkAlu, Q.seg));
    add(rod(P(0.36).setZ(z), P(0.375).setZ(z), 0.0315, M.chrome, Q.seg));
    add(rod(P(0.71).setZ(z), P(0.725).setZ(z), 0.024, M.gold, Q.seg));
    add(rod(V3(0.638, 0.36, z), P(0.13).setZ(z), 0.012, M.darkAlu)); // patte d'étrier
    // Bracelets
    const b0 = P(0.63).setZ(z), b1 = b0.clone().add(V3(-0.07, -0.025, Math.sign(z) * 0.17)), b2 = b0.clone().add(V3(-0.1, -0.035, Math.sign(z) * 0.29));
    add(rod(b0, b1, 0.011, M.darkAlu));
    add(rod(b1, b2, 0.017, M.matte, Q.seg));
    add(rod(b2, b2.clone().add(V3(-0.008, -0.003, Math.sign(z) * 0.02)), 0.019, M.chrome));
    add(rod(b1.clone().add(V3(0.02, 0.005, Math.sign(z) * 0.02)), b1.clone().add(V3(0.075, -0.012, Math.sign(z) * 0.13)), 0.0045, M.alu));
  }
  const fender = new THREE.Shape(); fender.absarc(0, 0, 0.328, 32 * DEG, 128 * DEG, false); fender.absarc(0, 0, 0.316, 128 * DEG, 32 * DEG, true);
  const fg = new THREE.ExtrudeGeometry(fender, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.004, bevelSegments: 3, curveSegments: 40 });
  fg.translate(0, 0, -0.05);
  const fm = new THREE.Mesh(fg, M.carbonFlat); fm.position.copy(FA); add(fm);
  for (const k of [0.56, 0.68]) { const c = rbox(0.085, 0.026, 0.27, 0.01, k > 0.6 ? M.alu : M.darkAlu); c.position.copy(P(k)); c.rotation.z = rake; add(c); }
  add(rod(P(0.56), P(0.68), 0.022, M.darkAlu));

  // Cadre périmétrique double poutre (aluminium)
  const spar = new THREE.Shape();
  spar.moveTo(0.47, 0.95); spar.quadraticCurveTo(0.2, 0.93, -0.06, 0.82); spar.quadraticCurveTo(-0.22, 0.75, -0.25, 0.6);
  spar.lineTo(-0.26, 0.4); spar.quadraticCurveTo(-0.22, 0.34, -0.14, 0.38); spar.lineTo(-0.13, 0.55);
  spar.quadraticCurveTo(-0.08, 0.7, 0.12, 0.76); spar.quadraticCurveTo(0.32, 0.81, 0.46, 0.84); spar.closePath();
  for (const z of [0.155, -0.155]) { const s = shell(spar, 0.02, M.alu, null, 0.009, { bevelSegments: 3, curveSegments: 24 }); s.position.z = z; add(s); }
  add(rod(V3(0.455, 0.84), V3(0.415, 0.96), 0.042, M.alu, Q.seg));
  add(rod(V3(-0.2, 0.47, -0.2), V3(-0.2, 0.47, 0.2), 0.016, M.chrome));

  // Bras oscillant
  const arm = new THREE.Shape();
  arm.moveTo(-0.16, 0.52); arm.lineTo(-0.66, 0.352); arm.quadraticCurveTo(-0.74, 0.33, -0.735, 0.305); arm.quadraticCurveTo(-0.73, 0.28, -0.69, 0.285); arm.lineTo(-0.2, 0.405); arm.quadraticCurveTo(-0.15, 0.42, -0.15, 0.47); arm.closePath();
  for (const z of [0.115, -0.115]) { const s = shell(arm, 0.016, M.alu, null, 0.007, { bevelSegments: 3, curveSegments: 16 }); s.position.z = z; add(s); }
  const brace = rbox(0.05, 0.05, 0.22, 0.01, M.alu); brace.position.set(-0.3, 0.43, 0); add(brace);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.01, 0.03), M.carbonFlat); guard.position.set(-0.42, 0.43, -0.13); guard.rotation.z = -0.32; add(guard);

  // Moteur (quatre cylindres incliné, ailettes, carters)
  const crank = rbox(0.34, 0.2, 0.26, 0.035, M.engine); crank.position.set(0.03, 0.4, 0); add(crank);
  const sump = rbox(0.24, 0.07, 0.2, 0.025, M.engine); sump.position.set(0.05, 0.285, 0); add(sump);
  const cyl = new THREE.Group(); cyl.position.set(0.08, 0.5, 0); cyl.rotation.z = -30 * DEG; add(cyl);
  const core = rbox(0.14, 0.18, 0.25, 0.02, M.engine); core.position.y = 0.09; cyl.add(core);
  for (let i = 0; i < 7; i++) { const f = rbox(0.18, 0.007, 0.27, 0.003, M.fins, 2); f.position.y = 0.025 + i * 0.019; cyl.add(f); }
  const head = rbox(0.17, 0.07, 0.26, 0.02, M.fins); head.position.y = 0.205; cyl.add(head);
  const cover = rbox(0.15, 0.045, 0.235, 0.018, M.paint); cover.position.y = 0.255; cyl.add(cover);
  for (let i = 0; i < 4; i++) { const p = rod(V3(0, 0.28, -0.09 + i * 0.06), V3(0, 0.3, -0.09 + i * 0.06), 0.009, M.black); cyl.add(p); }
  const clutch = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.088, 0.03, Q.seg * 2).rotateX(Math.PI / 2), M.alu); clutch.position.set(-0.02, 0.4, 0.145); add(clutch);
  const bolts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.005, 0.005, 0.01, 8).rotateX(Math.PI / 2), M.chrome, 10), bm = new THREE.Matrix4();
  for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; bm.makeTranslation(-0.02 + Math.cos(a) * 0.074, 0.4 + Math.sin(a) * 0.074, 0.162); bolts.setMatrixAt(i, bm); }
  add(bolts);
  const stator = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.078, 0.028, Q.seg * 2).rotateX(Math.PI / 2), M.darkAlu); stator.position.set(0.08, 0.41, -0.144); add(stator);
  const rad = rbox(0.045, 0.27, 0.32, 0.01, M.black); rad.position.set(0.38, 0.69, 0); rad.rotation.z = -0.25; add(rad);
  // Pignon de sortie de boîte
  const fs = new THREE.Mesh(sprocketGeometry(16, 0.038, 0.045, 0.006, 0, Q.curve), M.steel); fs.name = 'sprocketF'; fs.position.set(CHAIN.f.x, CHAIN.f.y, CHAIN.z); add(fs);
  // Chaîne : vrais maillons (plaques, rouleaux, axes)
  const links = Math.round(chainPath.L / 0.0155);
  const chain = new THREE.InstancedMesh(chainGeometry(), M.steel, links); chain.name = 'chain'; placeChain(chain, 0); add(chain);

  // Échappement : collecteurs à teinte de chauffe, silencieux brossé, embout carbone
  [-0.075, -0.025, 0.025, 0.075].forEach(z => add(tube([V3(0.26, 0.63, z), V3(0.33, 0.58, z * 1.05), V3(0.37, 0.45, z * 1.1), V3(0.33, 0.3, z * 0.9), V3(0.22, 0.2, z * 0.6), V3(0.06, 0.17, z * 0.3), V3(-0.08, 0.18, 0.02)], 0.0155, M.header, Q.tube, 14)));
  add(tube([V3(-0.08, 0.18, 0.02), V3(-0.2, 0.2, 0.1), V3(-0.29, 0.29, 0.18), V3(-0.33, 0.33, 0.19)], 0.03, M.titanium, 40, 20));
  const m0 = V3(-0.32, 0.325, 0.19), m1 = V3(-0.63, 0.565, 0.19), md = new THREE.Vector3().subVectors(m1, m0), ml = md.length();
  const muff = new THREE.Group(); muff.position.copy(m0); muff.quaternion.setFromUnitVectors(UP, md.clone().normalize()); add(muff);
  const body = lathe([[0.001, 0], [0.04, 0], [0.058, 0.035], [0.064, 0.08], [0.064, ml - 0.07], [0.06, ml - 0.04]], M.titanium, Q.seg * 2); muff.add(body);
  const capM = lathe([[0.06, ml - 0.045], [0.062, ml - 0.02], [0.05, ml], [0.03, ml + 0.004], [0.001, ml + 0.004]], M.carbon, Q.seg * 2); muff.add(capM);
  muff.add(rod(V3(0, ml - 0.01), V3(0, ml + 0.03), 0.026, M.chrome, Q.seg));
  muff.add(rod(V3(0, ml + 0.028), V3(0, ml + 0.031), 0.02, M.black, Q.seg));
  add(rod(V3(-0.45, 0.43, 0.19), V3(-0.4, 0.62, 0.09), 0.009, M.darkAlu));

  // Amortisseur arrière (ressort rouge)
  const s1 = V3(-0.12, 0.72), s2 = V3(-0.3, 0.42), ax = new THREE.Vector3().subVectors(s2, s1), sl = ax.length(); ax.normalize();
  add(rod(s1, s2, 0.012, M.steel));
  const n1 = V3(0, 0, 1), n2 = new THREE.Vector3().crossVectors(ax, n1).normalize(), hel = [];
  for (let i = 0; i <= 200; i++) { const t = i / 200, a = t * TAU * 8; hel.push(s1.clone().addScaledVector(ax, sl * (0.15 + t * 0.6)).addScaledVector(n1, Math.cos(a) * 0.03).addScaledVector(n2, Math.sin(a) * 0.03)); }
  add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hel), 600, 0.0055, 8), M.spring));

  // Réservoir, carénage avant, bulle, phares, rétroviseurs, tableau de bord
  const tank = new THREE.Shape();
  tank.moveTo(0.4, 0.88); tank.quadraticCurveTo(0.36, 0.98, 0.22, 1.0); tank.quadraticCurveTo(0.02, 1.02, -0.12, 0.93);
  tank.quadraticCurveTo(-0.17, 0.89, -0.16, 0.86); tank.lineTo(0.4, 0.86); tank.closePath();
  add(shell(tank, 0.26, M.paint, x => (x < 0.05 ? 1 - (0.05 - x) * 1.6 : 1), 0.045, { bevelSegments: 8 }));
  const nose = new THREE.Shape();
  nose.moveTo(0.36, 0.95); nose.lineTo(0.52, 0.99); nose.quadraticCurveTo(0.7, 0.95, 0.8, 0.84); nose.quadraticCurveTo(0.81, 0.79, 0.76, 0.76);
  nose.quadraticCurveTo(0.62, 0.7, 0.52, 0.58); nose.lineTo(0.44, 0.5); nose.quadraticCurveTo(0.34, 0.52, 0.3, 0.62); nose.quadraticCurveTo(0.32, 0.8, 0.36, 0.95);
  add(shell(nose, 0.3, M.paint, x => 1 - Math.max(0, x - 0.5) * 2, 0.035, { bevelSegments: 8 }));
  const vent = new THREE.Shape(); vent.moveTo(0.36, 0.6); vent.lineTo(0.5, 0.64); vent.lineTo(0.47, 0.67); vent.lineTo(0.35, 0.645); vent.closePath();
  for (const z of [0.186, -0.186]) {
    const v = new THREE.Mesh(new THREE.ExtrudeGeometry(vent, { depth: 0.004, bevelEnabled: false }), M.black); v.position.z = z - 0.002; add(v);
    const dc = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.032), M.decal); dc.position.set(0.415, 0.715, z + Math.sign(z) * 0.0015); dc.rotation.z = 0.12; if (z < 0) dc.rotation.y = Math.PI; add(dc);
  }
  const scr = new THREE.Shape(); scr.moveTo(0.5, 0.985); scr.quadraticCurveTo(0.53, 1.09, 0.585, 1.1); scr.quadraticCurveTo(0.67, 1.04, 0.72, 0.935); scr.lineTo(0.66, 0.955); scr.closePath();
  add(shell(scr, 0.18, M.glass, x => 1 - Math.max(0, x - 0.58) * 2.2, 0.006, { bevelSegments: 2 }));
  for (const z of [0.045, -0.045]) { const l = rbox(0.014, 0.032, 0.07, 0.006, M.lamp); l.position.set(0.786, 0.805, z); l.rotation.z = -0.45; add(l); }
  const intake = rbox(0.012, 0.045, 0.03, 0.005, M.black); intake.position.set(0.792, 0.8, 0); intake.rotation.z = -0.45; add(intake);
  for (const z of [0.17, -0.17]) {
    add(rod(V3(0.56, 0.975, z * 0.9), V3(0.58, 1.03, z * 1.5), 0.006, M.black));
    const mr = rbox(0.03, 0.048, 0.095, 0.012, M.black); mr.position.set(0.585, 1.035, z * 1.6); add(mr);
  }
  const dash = rbox(0.045, 0.075, 0.13, 0.012, M.black); dash.position.set(0.47, 1.0, 0); dash.rotation.z = 0.9; add(dash);
  const lcd = rbox(0.004, 0.058, 0.105, 0.0015, M.screen, 2); lcd.position.set(0.453, 1.012, 0); lcd.rotation.z = 0.9; add(lcd);

  // Selle surpiquée, coque arrière, feu arrière LED, support de plaque
  const seat = new THREE.Shape();
  seat.moveTo(-0.15, 0.845); seat.quadraticCurveTo(-0.17, 0.877, -0.22, 0.882); seat.lineTo(-0.48, 0.896); seat.quadraticCurveTo(-0.53, 0.9, -0.55, 0.885);
  seat.lineTo(-0.52, 0.85); seat.lineTo(-0.15, 0.82); seat.closePath();
  add(shell(seat, 0.2, M.seat, x => (x < -0.25 ? 1 - (-0.25 - x) * 0.6 : 1), 0.022, { bevelSegments: 6, uv: 9 }));
  const tail = new THREE.Shape();
  tail.moveTo(-0.14, 0.8); tail.quadraticCurveTo(-0.4, 0.84, -0.62, 0.91); tail.quadraticCurveTo(-0.8, 0.97, -0.92, 1.01); tail.lineTo(-0.93, 0.975);
  tail.quadraticCurveTo(-0.8, 0.9, -0.62, 0.79); tail.quadraticCurveTo(-0.45, 0.7, -0.2, 0.7); tail.closePath();
  add(shell(tail, 0.22, M.paint, x => (x < -0.3 ? 1 - (-0.3 - x) * 0.75 : 1), 0.03, { bevelSegments: 8 }));
  for (const z of [0.08, -0.08]) add(rod(V3(-0.2, 0.74, z), V3(-0.6, 0.84, z * 0.85), 0.012, M.darkAlu));
  const tl = rbox(0.03, 0.02, 0.13, 0.008, M.tail); tl.position.set(-0.915, 0.985, 0); tl.rotation.z = 0.35; add(tl);
  add(rod(V3(-0.8, 0.86), V3(-0.94, 0.68), 0.014, M.black));
  for (const z of [0.07, -0.07]) { const ind = rbox(0.028, 0.016, 0.022, 0.006, M.amber); ind.position.set(-0.93, 0.74, z); add(ind); }
  const hug = new THREE.Shape(); hug.absarc(0, 0, 0.345, 40 * DEG, 118 * DEG, false); hug.absarc(0, 0, 0.334, 118 * DEG, 40 * DEG, true);
  const hg = new THREE.ExtrudeGeometry(hug, { depth: 0.13, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 2, curveSegments: 32 }); hg.translate(0, 0, -0.065);
  const hm = new THREE.Mesh(hg, M.carbonFlat); hm.position.copy(RA); add(hm);

  // Repose-pieds et platines
  for (const z of [0.175, -0.175]) {
    const pl = rbox(0.11, 0.06, 0.008, 0.0035, M.alu); pl.position.set(-0.24, 0.47, z); pl.rotation.z = 0.3; add(pl);
    add(rod(V3(-0.27, 0.44, z), V3(-0.27, 0.44, z + Math.sign(z) * 0.06), 0.009, M.alu));
  }
  return bike;
}

/* ------------------------------------------------------------------ GLB (SITE.bikeModel) */
const LIVERY = 'mat_livery_0_160_001';
// Patch commun des matériaux du GLB (U : uniformes partagés) :
//  - carrosserie : le texel gris foncé (sRGB ≈ #262626, peu saturé) prend la teinte choisie en gardant
//    l'ombrage (luma / 0,149) ; bandes rouges et pièces gris clair inchangées ;
//  - apparition « scan laser » : tout ce qui est au-delà de uScanX (axe X du monde) est masqué,
//    avec un liseré lumineux sur la ligne de scan ;
//  - rayons X (carrosserie et vitrages) : coque translucide bleu-blanc à effet de Fresnel.
function patchMaterial(m, U, kind) {
  const xray = kind === 'livery' || kind === 'glass';
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, { uPaint: U.uPaint, uPaintOn: U.uPaintOn, uScanX: U.uScanX, uScanOn: U.uScanOn, uXray: U.uXray });
    sh.vertexShader = 'varying vec3 vMcPos;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vMcPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    let f = 'varying vec3 vMcPos;\nuniform vec3 uPaint;\nuniform float uPaintOn, uScanX, uScanOn, uXray;\n' + sh.fragmentShader;
    f = f.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      if (uScanOn > 0.5 && vMcPos.x > uScanX) discard;`);
    if (kind === 'livery') f = f.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 sc = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));
        float mx = max(max(sc.r, sc.g), sc.b), mn = min(min(sc.r, sc.g), sc.b);
        float sat = mx > 0.0 ? (mx - mn) / mx : 0.0;
        float luma = dot(sc, vec3(0.2126, 0.7152, 0.0722));
        float mask = (1.0 - smoothstep(0.10, 0.12, sat)) * smoothstep(0.07, 0.09, luma) * (1.0 - smoothstep(0.29, 0.31, luma));
        vec3 painted = pow(clamp(uPaint * (luma / 0.149), 0.0, 1.0), vec3(2.2));
        diffuseColor.rgb = mix(diffuseColor.rgb, painted, mask * uPaintOn);
      }`);
    f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      if (uScanOn > 0.5) totalEmissiveRadiance += vec3(1.0, 0.42, 0.32) * (1.0 - smoothstep(0.0, 0.028, uScanX - vMcPos.x)) * 7.0;`);
    if (xray) f = f.replace('#include <opaque_fragment>', `if (uXray > 0.001) {
        float fr = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.2);
        outgoingLight = mix(outgoingLight, vec3(0.55, 0.78, 1.0) * (0.12 + 1.8 * fr), uXray);
        diffuseColor.a = mix(diffuseColor.a, 0.04 + 0.75 * fr, uXray);
      }
      #include <opaque_fragment>`);
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'mc-' + kind;
  m.needsUpdate = true;
}
// Boîte englobante des maillages dont le matériau contient `name`, en coordonnées de `root`
function partBox(root, name) {
  const b = new THREE.Box3();
  root.traverse(o => { if (o.isMesh && o.material && (o.material.name || '').includes(name)) b.union(new THREE.Box3().setFromObject(o)); });
  return b.isEmpty() ? null : b;
}
// Listes de matériaux par modèle, hors userData : Object3D.clone() recopie userData en JSON (textures comprises)
const MATS = new WeakMap();
// Roues du GLB : pneus et jantes rattachés à un pivot centré sur chaque roue, pour les faire tourner.
// La jante du modèle est un seul maillage pour les deux roues : ses triangles sont répartis avant / arrière.
function wheelPivots(out) {
  out.updateMatrixWorld(true);
  const fb = partBox(out, 'fronttyre'), bb = partBox(out, 'backtyre');
  if (!fb || !bb) return;
  const cF = fb.getCenter(V3(0, 0, 0)), cR = bb.getCenter(V3(0, 0, 0)), midX = (cF.x + cR.x) / 2;
  const pF = new THREE.Group(), pR = new THREE.Group();
  pF.name = 'wheelF'; pR.name = 'wheelR'; pF.position.copy(cF); pR.position.copy(cR);
  out.add(pF, pR); out.updateMatrixWorld(true);
  const meshes = [];
  out.traverse(o => { if (o.isMesh && o.material) meshes.push(o); });
  meshes.forEach(o => {
    const n = o.material.name || '';
    if (/fronttyre/.test(n)) pF.attach(o);
    else if (/backtyre/.test(n)) pR.attach(o);
    else if (/rim160/.test(n) && o.geometry.index) {
      const g = o.geometry, idx = g.index, pos = g.attributes.position, v = V3(0, 0, 0), front = [], rear = [];
      for (let i = 0; i < idx.count; i += 3) {
        let x = 0;
        for (let k = 0; k < 3; k++) x += v.fromBufferAttribute(pos, idx.getX(i + k)).applyMatrix4(o.matrixWorld).x;
        (x / 3 > midX ? front : rear).push(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
      }
      [[front, pF], [rear, pR]].forEach(([list, piv]) => {
        if (!list.length) return;
        const sub = new THREE.BufferGeometry();
        for (const k in g.attributes) sub.setAttribute(k, g.attributes[k]);
        sub.setIndex(list);
        const m = new THREE.Mesh(sub, o.material);
        m.position.copy(o.position); m.quaternion.copy(o.quaternion); m.scale.copy(o.scale);
        o.parent.add(m); m.updateMatrixWorld(true); piv.attach(m);
      });
      o.parent.remove(o);
    }
  });
}
async function loadGLB(url, rotY, U, tintNames) {
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js')
  ]);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  const inner = gltf.scene;
  const turn = new THREE.Group(); turn.add(inner);
  const fit = new THREE.Group(); fit.add(turn);
  const out = new THREE.Group(); out.add(fit);
  const refit = () => {
    fit.scale.setScalar(1); fit.position.set(0, 0, 0); out.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(out), size = box.getSize(V3(0, 0, 0));
    fit.scale.setScalar(BIKE_LEN / Math.max(size.x, 1e-6)); out.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(out);
    const c = box.getCenter(V3(0, 0, 0));
    fit.position.set(-c.x, -box.min.y, -c.z); out.updateMatrixWorld(true);
  };
  // Vue de profil : la plus grande dimension horizontale devient l'axe X, l'avant vers +X, puis réglage fin
  out.updateMatrixWorld(true);
  const s0 = new THREE.Box3().setFromObject(out).getSize(V3(0, 0, 0));
  turn.rotation.y = (s0.z > s0.x ? Math.PI / 2 : 0);
  refit();
  const fr = partBox(out, 'fronttyre'), bk = partBox(out, 'backtyre');
  if (fr && bk && fr.getCenter(V3(0, 0, 0)).x < bk.getCenter(V3(0, 0, 0)).x) turn.rotation.y += Math.PI;
  turn.rotation.y += +rotY || 0;
  refit();
  wheelPivots(out);

  // Matériaux : feux lumineux (halo), carrosserie teintable, ombres
  const paintMats = [], xrayMats = [], tintMats = [];
  const subs = (Array.isArray(tintNames) && tintNames.length ? tintNames : ['paint']).map(t => String(t).toLowerCase());
  out.traverse(o => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(m => {
      if (!m) return;
      const n = m.name || '';
      if (n.includes('light160')) { m.emissive = new THREE.Color(0xffffff); m.emissiveMap = m.map; m.emissiveIntensity = 2.4; }
      // Carrosserie : le lettrage de marque est gravé dans les cartes de brillance et de relief -> vernis uni
      if (n === LIVERY) { m.roughnessMap = null; m.metalnessMap = null; m.normalMap = null; m.clearcoatNormalMap = null; m.clearcoatRoughnessMap = null; m.roughness = 0.34; m.metalness = 0.35; m.needsUpdate = true; }
      if (n.includes('gauge160')) m.emissiveIntensity = Math.max(m.emissiveIntensity || 1, 1.2);
      // Bulle : verre fumé translucide (le modèle la livre en alpha « MASK », donc opaque et blanche)
      if (n.includes('glass160')) { m.alphaTest = 0; m.transparent = true; m.opacity = 0.32; m.color.set(0x1c232c); m.roughness = 0.04; m.metalness = 0; m.depthWrite = false; }
      if (m.userData.mcPatched) return;
      m.userData.mcPatched = true;
      // Règle générale : tout matériau dont le nom contient « paint » (ou SITE.bikePaintMaterials) est teinté par multiplication
      if (n !== LIVERY && m.color && subs.some(t => n.toLowerCase().includes(t))) { m.userData.tintBase = m.color.getHex(); tintMats.push(m); }
      const kind = n === LIVERY ? 'livery' : /glass/.test(n) ? 'glass' : 'std';
      patchMaterial(m, U, kind);
      if (kind === 'livery') paintMats.push(m);
      if (kind !== 'std') xrayMats.push(m);
    });
  });
  // Arrêts de la visite d'après les pièces (roue avant, chaîne, poste de pilotage)
  const c = b => b && b.getCenter(V3(0, 0, 0)).toArray();
  out.userData.parts = { front: c(partBox(out, 'fronttyre')), chain: c(partBox(out, 'chain')), cockpit: c(partBox(out, 'cockpit')) };
  out.userData.box = new THREE.Box3().setFromObject(out);
  out.userData.glb = true;
  MATS.set(out, { paint: paintMats, xray: xrayMats, tint: tintMats });
  return out;
}
// Arrêts absolus : boîte normalisée par défaut, pièces du modèle quand elles sont trouvées
function makeStops(obj) {
  const box = obj.userData.box, size = box.getSize(V3(0, 0, 0)), k = size.x / BIKE_LEN, P = obj.userData.parts || {};
  const S = STOPS.map(st => ({ t: [box.min.x + st.f[0] * size.x, box.min.y + st.f[1] * size.y, box.min.z + st.f[2] * size.z], az: st.az, el: st.el, d: st.d * k }));
  if (P.front) S[1].t = P.front;
  if (P.cockpit) S[4].t = P.cockpit;
  if (P.chain) {
    S[3].t = P.chain;
    // Chaîne du côté droit (+Z) : la caméra reste de ce côté, trajet sans traverser la moto
    if (P.chain[2] > (box.min.z + box.max.z) / 2) { S[3].az = -28; S[4].az = 65; S[5].az = -45; }
  }
  return S;
}
function webglAvailable() {
  try {
    const c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl');
    if (!g) return false;
    const x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext();
    return true;
  } catch (e) { return false; }
}

/* ------------------------------------------------------------------ révélation « particules + scan » */
// Points échantillonnés sur la surface du modèle (MeshSurfaceSampler), qui convergent en tourbillonnant
const PointsShader = {
  vertexShader: `uniform float uT, uFade, uSize, uScanX, uTime;
    attribute vec3 aStart; attribute float aSeed;
    varying float vA; varying float vRed;
    void main() {
      float e = clamp(uT * 1.35 - aSeed * 0.35, 0.0, 1.0);
      e = 1.0 - pow(1.0 - e, 3.0);
      vec3 p = mix(aStart, position, e);
      float ang = (1.0 - e) * (2.2 + aSeed * 2.4), c = cos(ang), s = sin(ang);
      p.xz = mat2(c, -s, s, c) * p.xz;
      p += (1.0 - e) * 0.03 * vec3(sin(uTime * 2.0 + aSeed * 40.0), cos(uTime * 1.7 + aSeed * 30.0), sin(uTime * 1.3 + aSeed * 20.0));
      vec4 wp = modelMatrix * vec4(p, 1.0);
      float done = smoothstep(0.0, 0.05, uScanX - wp.x);
      vA = uFade * (1.0 - done) * (0.3 + 0.7 * e);
      vRed = step(0.62, aSeed);
      vec4 mv = viewMatrix * wp;
      gl_PointSize = uSize * (0.55 + aSeed * 0.9) / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `varying float vA; varying float vRed;
    void main() {
      vec2 d = gl_PointCoord - 0.5; float r = dot(d, d);
      if (r > 0.25) discard;
      float a = exp(-r * 16.0) * vA;
      vec3 col = mix(vec3(1.0, 0.93, 0.9), vec3(1.0, 0.2, 0.13), vRed);
      gl_FragColor = vec4(col * a, a);
    }`
};
async function buildReveal(view, model, count, U) {
  const { MeshSurfaceSampler } = await import('three/addons/math/MeshSurfaceSampler.js');
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert(), sc = V3(0, 0, 0);
  const list = [];
  model.traverse(o => {
    if (!o.isMesh || !o.geometry.attributes.position) return;
    const mat = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const smp = new MeshSurfaceSampler(o).build();
    sc.setFromMatrixScale(mat);
    const area = (smp.distribution ? smp.distribution[smp.distribution.length - 1] : 1) * sc.x * sc.y;
    list.push({ smp, mat, area });
  });
  const total = list.reduce((a, b) => a + b.area, 0) || 1;
  const pos = new Float32Array(count * 3), start = new Float32Array(count * 3), seed = new Float32Array(count);
  const pt = V3(0, 0, 0), box = model.userData.box, cy = (box.min.y + box.max.y) / 2;
  let i = 0;
  list.forEach((it, k) => {
    const n = k === list.length - 1 ? count - i : Math.round(count * it.area / total);
    for (let j = 0; j < n && i < count; j++, i++) {
      it.smp.sample(pt); pt.applyMatrix4(it.mat); pt.toArray(pos, i * 3);
      const th = Math.random() * TAU, ph = Math.acos(2 * Math.random() - 1), r = 1.1 + Math.random() * 1.6;
      start[i * 3] = Math.sin(ph) * Math.cos(th) * r * 1.3; start[i * 3 + 1] = cy + Math.cos(ph) * r * 0.6; start[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * r;
      seed[i] = Math.random();
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aStart', new THREE.BufferAttribute(start, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  g.setDrawRange(0, i);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uFade: { value: 1 }, uSize: { value: 7 * view.renderer.getPixelRatio() }, uScanX: U.uScanX, uTime: { value: 0 } },
    vertexShader: PointsShader.vertexShader, fragmentShader: PointsShader.fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const points = new THREE.Points(g, mat); points.frustumCulled = false;
  model.add(points);
  return { points, mat, t: 0, done: false, count: i };
}

/* ------------------------------------------------------------------ point d'entrée */
export async function init(opts = {}) {
  const { hero, tourCanvas, reduce = false, mobile = false, site = {} } = opts;
  // Pas de WebGL : on s'arrête sans bruit (le fond dégradé et la liste des services restent)
  if (!webglAvailable()) throw new Error('webgl');
  const conn = navigator.connection;
  const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || !!(conn && conn.saveData);
  const tier = mobile ? 'low' : lowEnd ? 'mid' : 'high';
  const Q = tier === 'low' ? { lathe: 72, seg: 20, curve: 16, holes: 18, tube: 60 } : { lathe: 144, seg: 40, curve: 40, holes: 24, tube: 120 };
  const U = { uPaint: { value: new THREE.Vector3(0.149, 0.149, 0.149) }, uPaintOn: { value: 0 }, uScanX: { value: 99 }, uScanOn: { value: 0 }, uXray: { value: 0 } };

  const T = makeTextures(tier), M = makeMaterials(T);
  // Modèle réel (GLB) si configuré : version allégée sur mobile ; la moto procédurale sert de secours
  let model = null;
  const bm = site.bikeModel, url = typeof bm === 'string' ? bm : bm && (mobile ? bm.mobile || bm.desktop : bm.desktop || bm.mobile);
  if (url) { try { model = await loadGLB(url, site.bikeRotationY, U, site.bikePaintMaterials); } catch (e) { model = null; } }
  if (!model) {
    try { if (document.fonts) await Promise.race([document.fonts.load('900 96px Orbitron'), new Promise(r => setTimeout(r, 800))]); } catch (e) { /* police de secours */ }
    const raw = buildBike(M, T, Q), b = new THREE.Box3().setFromObject(raw), c = b.getCenter(V3(0, 0, 0));
    model = new THREE.Group(); model.add(raw); raw.position.set(-c.x, 0, -c.z);
    model.userData.box = new THREE.Box3().setFromObject(model);
    MATS.set(model, { paint: [M.paint], xray: [], tint: [] });
  }
  const glb = !!model.userData.glb, { paint: paintMats, xray: xrayMats, tint: tintMats } = MATS.get(model);
  model.userData.stops = makeStops(model);
  let paintName = 'noir';

  const views = [];
  const hv = makeView(hero, model, 'hero', tier, T);
  views.push(hv);
  let tv = null;
  const canTour = !!tourCanvas && !reduce && !mobile;

  // ---------- Révélation signature : ordinateur + GLB, une fois par session, sautée au moindre geste ----------
  let reveal = null, sway = 1;
  const scan = { on: 0, x: 99 }; // état du scan de l'accueil, appliqué juste avant son rendu
  let seen = false; try { seen = sessionStorage.getItem('mc-reveal') === '1'; } catch (e) { /* stockage indisponible */ }
  const box0 = model.userData.box;
  const finishReveal = () => {
    if (!reveal || reveal.done) return;
    reveal.done = true;
    scan.on = 0; scan.x = 99;
    reveal.points.parent.remove(reveal.points); reveal.points.geometry.dispose(); reveal.mat.dispose();
    hv.setShadows(true);
    SKIP.forEach(ev => removeEventListener(ev, finishReveal));
  };
  const SKIP = ['wheel', 'pointerdown', 'keydown', 'touchstart', 'scroll'];
  if (glb && !mobile && !reduce && !seen) {
    try {
      reveal = await buildReveal(hv, model, tier === 'high' ? 52000 : 30000, U);
      try { sessionStorage.setItem('mc-reveal', '1'); } catch (e) { /* stockage indisponible */ }
      scan.on = 1; scan.x = box0.min.x - 0.1; sway = 0;
      hv.setShadows(false);
      SKIP.forEach(ev => addEventListener(ev, finishReveal, { passive: true }));
    } catch (e) { reveal = null; }
  }
  xrayMats.forEach(m => { m.userData.base = { transparent: m.transparent, depthWrite: m.depthWrite }; });
  let xrOn = false;
  const setXray = x => {
    U.uXray.value = x;
    const on = x > 0.002;
    if (on === xrOn) return;
    xrOn = on;
    xrayMats.forEach(m => { m.transparent = on || m.userData.base.transparent; m.depthWrite = on ? false : m.userData.base.depthWrite; });
  };

  // ---------- Animation ----------
  let spin = 0, boostV = 0, speedV = 0, chainOff = 0, tgtP = 0, curP = 0, running = false, last = 0;
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  if (!mobile && !reduce) addEventListener('pointermove', e => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; }, { passive: true });
  const frameTimes = [];
  let probeT = 0, probeN = 0, probed = false; // mesure des 2 premières secondes

  function heroCamera(v, t) {
    const size = v.object.userData.box.getSize(V3(0, 0, 0));
    const desk = v.w > 960, tanV = Math.tan(v.camera.fov * DEG / 2), tanH = tanV * v.camera.aspect;
    const dist = Math.max((size.x / 2 + 0.05) / ((desk ? 0.56 : 0.94) * tanH), (size.y / 2 + 0.05) / ((desk ? 0.62 : 0.6) * tanV));
    const az = (34 + (reduce ? 0 : mouse.sx * 10)) * DEG, el = (7 - (reduce ? 0 : mouse.sy * 4)) * DEG;
    const tgt = V3(0, size.y * 0.47, 0);
    v.camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(tgt);
    v.camera.lookAt(tgt);
    v.root.rotation.y = reduce ? -0.1 : Math.sin(t * 0.00016) * 0.32 * sway;
  }
  const tA = V3(0, 0, 0), tB = V3(0, 0, 0);
  function tourCamera(v, p, t) {
    const S = v.object.userData.stops, k = v.object.userData.box.getSize(V3(0, 0, 0)).x / BIKE_LEN;
    const s = clamp(p, 0, 1) * (S.length - 1), i = Math.min(Math.floor(s), S.length - 2);
    const u = smooth(clamp((s - i - 0.12) / 0.76, 0, 1)), A = S[i], B = S[i + 1];
    const tgt = tA.fromArray(A.t).lerp(tB.fromArray(B.t), u);
    const az = lerp(A.az, B.az, u) * DEG + Math.sin(t * 0.00025) * 0.025, el = lerp(A.el, B.el, u) * DEG;
    const dist = lerp(A.d, B.d, u) + Math.sin(Math.PI * u) * 0.8 * k;
    v.camera.position.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).multiplyScalar(dist).add(tgt);
    v.camera.lookAt(tgt);
  }
  function animateBike(v, dt) {
    if (!v.wF) return;
    v.wF.rotation.z -= spin * dt; v.wR.rotation.z -= spin * dt;
    if (v.sF) v.sF.rotation.z -= spin * dt * CHAIN.rr / CHAIN.rf;
    if (v.chain) placeChain(v.chain, chainOff);
  }
  function render(v) { if (v.composer) v.composer.render(); else v.renderer.render(v.scene, v.camera); }
  function renderHero() { U.uScanOn.value = scan.on; U.uScanX.value = scan.x; setXray(0); render(hv); }
  function loop(now) {
    if (!running) return;
    requestAnimationFrame(loop);
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016); last = now;
    // Qualité adaptative : au-delà de 20 ms par image en moyenne, on baisse la définition, puis le halo
    // Sonde de démarrage : sous 50 images/s pendant les 2 premières secondes → moins de particules, plus de halo, DPR réduit
    if (!probed && (hv.visible || (tv && tv.visible))) {
      probeN++;
      if (probeN > 10) probeT += dt;
      if (probeT >= 2) {
        probed = true;
        if ((probeN - 10) / probeT < 50) {
          views.forEach(v => v.degrade(true));
          if (reveal && !reveal.done) reveal.points.geometry.setDrawRange(0, reveal.count >> 1);
        }
      }
    }
    frameTimes.push(dt); if (frameTimes.length > 90) frameTimes.shift();
    if (frameTimes.length === 90) {
      const avg = frameTimes.reduce((a, b) => a + b, 0) / 90;
      if (avg > 0.02) { views.forEach(v => v.degrade()); frameTimes.length = 0; }
    }
    boostV *= Math.pow(0.3, dt);
    const target = 0.5 + speedV * 0.03 + boostV * 26;
    spin += (target - spin) * Math.min(1, dt * 2.5);
    chainOff += spin * dt * CHAIN.rr;
    mouse.sx += (mouse.x - mouse.sx) * Math.min(1, dt * 2); mouse.sy += (mouse.y - mouse.sy) * Math.min(1, dt * 2);
    if (hv.visible) {
      if (reveal && !reveal.done) {
        const r = reveal, T1 = 1.8, T2 = 1.3;
        r.t += dt;
        r.mat.uniforms.uT.value = Math.min(1, r.t / T1);
        r.mat.uniforms.uTime.value = r.t;
        scan.x = lerp(box0.min.x - 0.1, box0.max.x + 0.1, smooth(clamp((r.t - T1) / T2, 0, 1)));
        r.mat.uniforms.uFade.value = 1 - smooth(clamp((r.t - T1 - T2 * 0.55) / 0.7, 0, 1));
        if (r.t > T1 + T2 + 0.7) finishReveal();
      } else sway = Math.min(1, sway + dt / 1.5);
      animateBike(hv, dt); heroCamera(hv, now); hv.rig(mouse.sx, mouse.sy); hv.film(now / 1000); hv.tick(dt); renderHero();
    }
    if (tv && tv.visible) {
      curP += (tgtP - curP) * (1 - Math.exp(-dt * 3.2));
      // Arrêt « moteur / réparation » : carrosserie en rayons X et vue éclatée, pilotées par le défilement (réversibles)
      let xr = 0;
      if (glb) {
        const sp = curP * (STOPS.length - 1), bell = (c, w) => smooth(clamp(1 - Math.abs(sp - c) / w, 0, 1));
        xr = bell(3, 0.85);
        tv.explode(bell(3, 0.6));
      }
      // Étape « Dépannage » : la fumée ne sort du moteur que là, puis se dissipe
      if (smoke) { const sp1 = curP * (STOPS.length - 1); smoke.update(dt, smooth(clamp(1 - Math.abs(sp1 - 1) / 0.85, 0, 1))); }
      tourCamera(tv, curP, now); tv.rig(mouse.sx, mouse.sy); tv.film(now / 1000); tv.tick(dt);
      // Uniformes partagés (mêmes matériaux) : la visite n'a jamais le scan, l'accueil jamais les rayons X
      U.uScanOn.value = 0; U.uScanX.value = 99; setXray(xr);
      render(tv);
    }
    if (!views.some(v => v.visible) || document.hidden) { running = false; last = 0; }
  }
  const wake = () => {
    if (reduce) return;
    if (!running && !document.hidden && views.some(v => v.visible)) { running = true; last = 0; requestAnimationFrame(loop); }
  };
  const still = () => { if (reduce && hv.w) { heroCamera(hv, 0); renderHero(); } };
  document.addEventListener('visibilitychange', wake);
  const watch = v => {
    new IntersectionObserver(([e]) => { v.visible = e.isIntersecting; wake(); }, { rootMargin: '100px' }).observe(v.canvas);
    new ResizeObserver(() => { if (v.size()) { if (v === hv) still(); wake(); } }).observe(v.canvas);
  };
  watch(hv);
  hv.size(); heroCamera(hv, 0);
  if (reduce) renderHero();
  let smoke = null;
  // Vue de la visite créée à la demande (second contexte WebGL, post-traitement, copie du modèle)
  function startTour() {
    if (tv) return true;
    if (!canTour) return false;
    try {
      const tm = model.clone();
      tm.userData.box = model.userData.box; tm.userData.stops = model.userData.stops;
      tv = makeView(tourCanvas, tm, 'tour', tier, T);
    } catch (e) { tv = null; return false; }
    views.push(tv); tv.setupExplode(); watch(tv); tv.size(); tourCamera(tv, curP, 0);
    if (!reduce && tier !== 'low') smoke = makeSmoke(tv.scene, tv.object.userData.box, T);
    return true;
  }
  requestAnimationFrame(() => hero.classList.add('ready'));

  function applyPaint() {
    const p = PAINTS[paintName] || PAINTS.noir;
    if (glb) {
      // « Noir carbone » = aspect d'origine du modèle
      U.uPaint.value.set(((p.color >> 16) & 255) / 255, ((p.color >> 8) & 255) / 255, (p.color & 255) / 255);
      U.uPaintOn.value = paintName === 'noir' ? 0 : 1;
      // Autres matériaux « paint » : teinte multipliée sur la couleur d'origine (« Noir carbone » = origine)
      const c = new THREE.Color(p.color);
      tintMats.forEach(m => { m.color.setHex(m.userData.tintBase); if (paintName !== 'noir') m.color.multiply(c); });
      return;
    }
    paintMats.forEach(m => {
      m.color.setHex(p.color); m.metalness = p.metalness; m.roughness = p.roughness;
      m.clearcoat = p.clearcoat; m.clearcoatRoughness = p.clearcoatRoughness; m.iridescence = p.iridescence; m.iridescenceIOR = 1.5;
    });
  }
  applyPaint();

  const api = {
    paints: PAINTS,
    canTour,
    startTour,
    model: glb ? 'glb' : 'procedural',
    setPaint(name) { if (!PAINTS[name]) return; paintName = name; applyPaint(); still(); },
    boost(v = 1) { boostV = Math.max(boostV, v); wake(); },
    speed(v) { speedV = +v || 0; },
    tour(p) { tgtP = clamp(+p || 0, 0, 1); }
  };
  window.MC3D = api;
  return api;
}

/* ------------------------------------------------------------------ fumée du moteur (étape Dépannage) */
// Volutes grises discrètes qui montent du moteur et partent vers l'arrière ; w = intensité (0 à 1)
function makeSmoke(scene, box, T) {
  const size = box.getSize(V3(0, 0, 0)), k = size.x / BIKE_LEN;
  const o = V3(box.min.x + 0.6 * size.x, box.min.y + 0.32 * size.y, box.min.z + 0.72 * size.z);
  const rnd = (a) => (Math.random() - 0.5) * a;
  const ps = [];
  for (let i = 0; i < 46; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color: 0xb9b9c0, transparent: true, opacity: 0, depthWrite: false }));
    s.renderOrder = 6; s.visible = false; scene.add(s);
    ps.push({ s, life: Math.random(), v: 0.16 + Math.random() * 0.12, dx: rnd(0.14 * k), dz: rnd(0.1 * k), ph: Math.random() * 6.28 });
  }
  return {
    update(dt, w) {
      for (const p of ps) {
        p.life += dt * p.v;
        if (p.life > 1) { p.life -= 1; p.dx = rnd(0.14 * k); p.dz = rnd(0.1 * k); }
        const L = p.life, sc = (0.05 + L * 0.34) * k;
        p.s.position.set(o.x + p.dx - L * 0.22 * k + Math.sin(p.ph + L * 5) * 0.025 * k, o.y + L * 0.45 * k, o.z + p.dz + L * 0.08 * k);
        p.s.scale.set(sc, sc, 1);
        p.s.material.opacity = w * 0.46 * Math.sin(Math.PI * Math.min(1, L * 1.1));
        p.s.visible = w > 0.01;
      }
    }
  };
}

/* ------------------------------------------------------------------ une vue (renderer + scène) */
let areaInit = false;
function makeView(canvas, object, kind, tier, T) {
  const desk = tier !== 'low', bloom = tier === 'high';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !bloom, powerPreference: 'high-performance' });
  let dpr = Math.min(window.devicePixelRatio || 1, desk ? 2 : 1.5);
  renderer.setPixelRatio(dpr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = kind === 'hero' ? 0.86 : 1;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x303036, bloom ? 1 : 0);
  renderer.shadowMap.enabled = desk;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pm = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  scene.environment = pm.fromScene(room, 0.04).texture;
  pm.dispose(); if (room.dispose) room.dispose();
  if (bloom) scene.background = studioBackground(kind);
  scene.fog = new THREE.FogExp2(0x303036, 0.055);

  // Éclairage de studio : grande boîte à lumière, contre-jour rouge, débouchage froid
  let area = null;
  if (desk) {
    if (!areaInit) { RectAreaLightUniformsLib.init(); areaInit = true; }
    area = new THREE.RectAreaLight(0xffffff, 5, 2.4, 1.3); area.position.set(1.1, 2.5, 2.3); area.lookAt(0, 0.5, 0); scene.add(area);
  }
  const key = new THREE.DirectionalLight(0xffffff, desk ? 1.1 : 2.2); key.position.set(1.6, 3.6, 2.2); scene.add(key);
  if (desk) {
    key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 9 });
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 6;
  }
  const rim = new THREE.DirectionalLight(0xff2a1a, 3.2); rim.position.set(-2.6, 1.4, -2.2); scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xff3b2a, 1.8); rim2.position.set(2.8, 1.1, -2.6); scene.add(rim2);
  const fill = new THREE.DirectionalLight(0x9fb6ff, 0.55); fill.position.set(-3, 1.4, 2.6); scene.add(fill);

  // Sol sombre brillant qui s'estompe, ombre de contact douce, halo rouge
  const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.MeshPhysicalMaterial({ color: 0x2a2a30, roughness: 0.55, metalness: 0, specularIntensity: 0.12, transparent: true, alphaMap: T.fade, depthWrite: false, envMapIntensity: 0.06 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = desk; floor.renderOrder = -3; scene.add(floor);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.85), new THREE.MeshBasicMaterial({ map: T.shadow, transparent: true, depthWrite: false, fog: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = 0.002; contact.renderOrder = -2; scene.add(contact);
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), new THREE.MeshBasicMaterial({ map: T.glow, color: 0xe63027, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.001; halo.renderOrder = -1; scene.add(halo);

  // Poussière en suspension dans les faisceaux
  const nDust = tier === 'high' ? 320 : tier === 'mid' ? 160 : 50;
  const dpos = new Float32Array(nDust * 3), dvel = new Float32Array(nDust);
  for (let i = 0; i < nDust; i++) { dpos[i * 3] = (Math.random() - 0.5) * 3.4; dpos[i * 3 + 1] = Math.random() * 1.9; dpos[i * 3 + 2] = (Math.random() - 0.5) * 2.6; dvel[i] = 0.015 + Math.random() * 0.035; }
  const dgeo = new THREE.BufferGeometry(); dgeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
  const dust = new THREE.Points(dgeo, new THREE.PointsMaterial({ map: T.glow, color: 0xffd6c8, size: 0.014, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  scene.add(dust);

  // Halos des feux (sprites additifs)
  const glows = new THREE.Group();
  const sprite = (color, x, y, s) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: T.glow, color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); sp.position.set(x, y, 0); sp.scale.set(s, s, 1); glows.add(sp); return sp; };

  const root = new THREE.Group(); scene.add(root);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);

  let composer = null, bloomPass = null, filmPass = null;
  if (bloom) {
    const rt = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(new THREE.Vector2(2, 2), 0.28, 0.4, 0.92);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    filmPass = new ShaderPass(FilmShader);
    composer.addPass(filmPass);
  }

  const v = {
    canvas, renderer, scene, camera, root, composer, visible: false, w: 0, h: 0, object: null,
    setObject(obj) {
      if (v.object) root.remove(v.object);
      v.object = obj; root.add(obj);
      obj.traverse(o => { if (o.isMesh && !(o.material && o.material.transparent)) o.castShadow = desk; });
      v.wF = obj.getObjectByName('wheelF'); v.wR = obj.getObjectByName('wheelR');
      v.sF = obj.getObjectByName('sprocketF'); v.chain = obj.getObjectByName('chain');
      // Halos placés d'après la boîte englobante (phare à l'avant, feu à l'arrière)
      root.remove(glows); glows.clear();
      const b = obj.userData.box, s = b.getSize(V3(0, 0, 0));
      if (!obj.userData.glb) { sprite(0xdfeeff, b.max.x + 0.02, b.min.y + s.y * 0.725, 0.28); sprite(0xff2418, b.min.x + 0.01, b.min.y + s.y * 0.885, 0.3); root.add(glows); }
    },
    size() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return false;
      if (w === v.w && h === v.h) return true;
      v.w = w; v.h = h;
      renderer.setSize(w, h, false);
      if (composer) { composer.setPixelRatio(dpr); composer.setSize(w, h); }
      camera.aspect = w / h;
      // Décalage du sujet : accueil → à droite du titre ; visite → à gauche des cartes ; mobile → plus bas
      if (kind === 'hero') camera.setViewOffset(w, h, w > 960 ? -0.24 * w : 0, w > 960 ? -0.02 * h : -0.1 * h, w, h);
      else camera.setViewOffset(w, h, 0.17 * w, 0, w, h);
      camera.updateProjectionMatrix();
      return true;
    },
    // Lumière de studio qui suit doucement le curseur (reflets qui glissent sur le vernis)
    rig(mx, my) {
      if (area) { area.position.set(1.1 + mx * 2.6, 2.5 - my * 1.2, 2.3 - Math.abs(mx) * 0.6); area.lookAt(0, 0.5, 0); }
      key.position.set(1.6 + mx * 2.2, 3.6 - my * 0.8, 2.2);
    },
    setShadows(on) { if (desk) key.castShadow = on; },
    film(t) { if (filmPass) filmPass.uniforms.uTime.value = t; },
    // Vue éclatée : carrosserie soulevée, échappement écarté, pneus glissés hors des jantes (offsets en espace moto)
    setupExplode() {
      if (!v.object.userData.glb) return;
      v.scene.updateMatrixWorld(true);
      const c = v.object.userData.box.getCenter(V3(0, 0, 0)), parts = [];
      v.object.traverse(o => {
        if (!o.isMesh || !o.parent) return;
        const n = (o.material && o.material.name) || '';
        let off = null;
        if (/livery|glass|light160|cockpit|mirrorview|gauge/.test(n)) off = V3(0, 0.1, 0);
        else if (/muffler|exmanifold/.test(n)) { const m = new THREE.Box3().setFromObject(o).getCenter(V3(0, 0, 0)); off = V3(0, -0.035, Math.sign(m.z - c.z || 1) * 0.11); }
        else if (/fronttyre/.test(n)) off = V3(0.04, 0, 0.13);
        else if (/backtyre/.test(n)) off = V3(-0.04, 0, 0.13);
        if (!off) return;
        const w0 = o.getWorldPosition(V3(0, 0, 0)), l1 = o.parent.worldToLocal(w0.clone().add(off));
        parts.push({ o, base: o.position.clone(), delta: l1.sub(o.position) });
      });
      v.explodeParts = parts;
    },
    explode(e) { (v.explodeParts || []).forEach(p => p.o.position.copy(p.base).addScaledVector(p.delta, e)); },
    degrade(all) {
      if (all && bloomPass) bloomPass.enabled = false;
      if (dpr > 1) { dpr = Math.max(1, dpr - 0.25); renderer.setPixelRatio(dpr); if (composer) composer.setPixelRatio(dpr); v.w = 0; v.size(); }
      else if (bloomPass && bloomPass.enabled) bloomPass.enabled = false;
    },
    tick(dt) {
      const p = dgeo.attributes.position;
      for (let i = 0; i < nDust; i++) {
        let y = p.getY(i) + dvel[i] * dt; if (y > 1.9) y = 0;
        p.setY(i, y); p.setX(i, p.getX(i) + Math.sin(y * 3 + i) * 0.0015 * dt * 60 * 0.1);
      }
      p.needsUpdate = true;
    }
  };
  v.setObject(object);
  return v;
}
