#!/usr/bin/env node
// Standalone design assets. No scene-host, simulation or emitter-runtime dependency.
import * as T from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const out = process.argv[2];
if (!out) throw Error('Usage: node examples/burner-designs/generate.mjs <output-directory>');
// Node's Blob supports the exporter; FileReader is the only browser adapter needed.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => {
    this.result = result; this.onloadend?.();
  }, error => this.onerror?.(error)); }
};

const metal = (name, color, roughness, metalness) => {
  const m = new T.MeshStandardMaterial({ color, roughness, metalness });
  m.name = name; return m;
};
const materials = {
  iron: metal('Graphite cast body', '#333e43', .52, .68),
  bronze: metal('Satin bronze replaceable head', '#b79358', .35, .78),
  steel: metal('Machined steel', '#8a969d', .28, .9),
  ceramic: metal('Ivory ceramic insulator', '#d0c9b7', .7, .02),
  cavity: metal('Recessed plenum', '#171e23', .8, .35),
};
const v = a => new T.Vector3(...a);
function mesh(parent, name, geometry, material, position = [0, 0, 0]) {
  geometry.normalizeNormals();
  const m = new T.Mesh(geometry, material); m.name = name;
  m.position.fromArray(position); m.castShadow = m.receiveShadow = true;
  parent.add(m); return m;
}
function lathe(parent, name, profile, material, position, segments = 96) {
  return mesh(parent, name, new T.LatheGeometry(profile.map(p => new T.Vector2(...p)), segments), material, position);
}
function tube(parent, name, inside, outside, height, material, position, segments = 64) {
  // Closed annular wall, open axial bore. No disc masking the opening.
  return lathe(parent, name, [[inside, 0], [outside, 0], [outside, height],
    [inside, height], [inside, 0]], material, position, segments);
}
function cylinder(parent, name, radius, height, material, position, segments = 48) {
  return mesh(parent, name, new T.CylinderGeometry(radius, radius, height, segments), material, position);
}
function box(parent, name, size, position, material, bevel = .004) {
  const [w, h, d] = size, b = Math.min(bevel, w / 4, h / 4, d / 4);
  const shape = new T.Shape();
  shape.moveTo(-w / 2 + b, -d / 2 + b); shape.lineTo(w / 2 - b, -d / 2 + b);
  shape.lineTo(w / 2 - b, d / 2 - b); shape.lineTo(-w / 2 + b, d / 2 - b);
  shape.closePath();
  const g = new T.ExtrudeGeometry(shape, { depth: h - 2 * b, bevelEnabled: true,
    bevelSize: b, bevelThickness: b, bevelSegments: 2, steps: 1 });
  g.rotateX(-Math.PI / 2); g.translate(0, -h / 2 + b, 0);
  return mesh(parent, name, g, material, position);
}
function bolt(parent, position) {
  cylinder(parent, 'Socket screw washer', .008, .002, materials.steel, position);
  const head = tube(parent, 'Socket screw open hex recess', .0026, .0055, .004,
    materials.steel, [position[0], position[1] + .001, position[2]], 6);
  return head;
}
function inlet(parent, position) {
  const g = new T.Group(); g.name = 'Fuel connection'; g.position.fromArray(position);
  g.rotation.x = Math.PI / 2; parent.add(g);
  tube(g, 'Hex union', .009, .019, .026, materials.bronze, [0, 0, 0], 6);
  tube(g, 'Hose socket', .009, .013, .045, materials.steel, [0, .026, 0]);
  for (let i = 0; i < 3; i++) tube(g, 'Socket ridge', .009, .015, .004,
    materials.steel, [0, .033 + i * .012, 0]);
}
function design(name, description) {
  const root = new T.Group(); root.name = name;
  root.userData = { designStage: 'geometry-study', units: 'metres',
    origin: 'floor contact, Y up', description, sourcePlacementStatus: 'design intent; not a runtime binding' };
  return root;
}
function source(parent, name, position, direction, aperture) {
  const node = new T.Object3D(); node.name = name; node.position.fromArray(position);
  node.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), v(direction).normalize());
  node.userData = { role: 'proposed-emission-opening', aperture, localForward: '+Y',
    runtimeBinding: null };
  parent.add(node); return node;
}

function ring() {
  const root = design('01 · Crown / ring hearth', 'Twelve upward ports around an open centre. Removable bronze jet head on an annular plenum.');
  // Three feet leave the centre open all the way to the floor.
  for (let i = 0; i < 3; i++) {
    const a = i * 2 * Math.PI / 3;
    const foot = box(root, 'Radial mounting foot', [.075, .023, .12],
      [.151 * Math.sin(a), .0115, .151 * Math.cos(a)], materials.iron);
    foot.rotation.y = a;
    bolt(root, [.185 * Math.sin(a), .024, .185 * Math.cos(a)]);
  }
  lathe(root, 'Annular cast plenum', [[.095, .024], [.16, .024], [.176, .045],
    [.176, .095], [.164, .113], [.095, .113], [.095, .024]], materials.iron);
  tube(root, 'Recessed head seat', .098, .164, .008, materials.cavity, [0, .113, 0]);
  // A perforated head seals between jets; these are real bores, not dark decals.
  const head = new T.Shape(); head.absarc(0, 0, .164, 0, Math.PI * 2, false);
  const centre = new T.Path(); centre.absarc(0, 0, .098, 0, Math.PI * 2, true);
  head.holes.push(centre);
  for (let i = 0; i < 12; i++) {
    const a = i * 2 * Math.PI / 12, hole = new T.Path();
    hole.absarc(.135 * Math.sin(a), -.135 * Math.cos(a), .006, 0, Math.PI * 2, true);
    head.holes.push(hole);
  }
  const headGeometry = new T.ExtrudeGeometry(head, {depth: .016, bevelEnabled: false, curveSegments: 32});
  headGeometry.rotateX(-Math.PI / 2);
  mesh(root, 'Perforated bronze head', headGeometry, materials.bronze, [0, .121, 0]);
  for (let i = 0; i < 12; i++) {
    const a = i * 2 * Math.PI / 12, x = .135 * Math.sin(a), z = .135 * Math.cos(a);
    tube(root, `Jet ${i + 1} hex seat`, .006, .013, .016, materials.bronze, [x, .121, z], 6);
    tube(root, `Jet ${i + 1} open throat`, .006, .0095, .020, materials.steel, [x, .137, z]);
    source(root, `port-${String(i + 1).padStart(2, '0')}`, [x, .157, z], [0, 1, 0],
      { shape: 'circle', radius: .006 });
  }
  for (const a of [0, 2 * Math.PI / 3, 4 * Math.PI / 3])
    bolt(root, [.157 * Math.sin(a), .142, .157 * Math.cos(a)]);
  inlet(root, [0, .067, .174]);
  return root;
}
function rail() {
  const root = design('02 · Seam / linear flame rail', 'Long replaceable ribbon outlet. A narrow open slot, parallel lips and a recessed supply channel.');
  for (const x of [-.22, .22]) {
    box(root, 'Crosswise mounting foot', [.075, .025, .20], [x, .0125, 0], materials.iron);
    for (const z of [-.077, .077]) bolt(root, [x, .026, z]);
  }
  box(root, 'Plenum base', [.62, .026, .112], [0, .042, 0], materials.iron);
  for (const z of [-.052, .052]) box(root, 'Plenum side wall', [.62, .060, .018], [0, .081, z], materials.iron);
  for (const x of [-.30, .30]) box(root, 'End cheek', [.020, .072, .112], [x, .09, 0], materials.iron);
  box(root, 'Recessed slot floor', [.58, .006, .07], [0, .056, 0], materials.cavity, .001);
  for (const z of [-.0315, .0315]) box(root, 'Replaceable bronze slot lip', [.58, .025, .045], [0, .1115, z], materials.bronze, .002);
  for (const x of [-.25, .25]) for (const z of [-.044, .044]) bolt(root, [x, .126, z]);
  inlet(root, [.25, .072, .062]);
  source(root, 'ribbon-opening', [0, .124, 0], [0, 1, 0], { shape: 'rectangle', width: .58, depth: .018 });
  return root;
}
function nozzle() {
  const root = design('03 · Lance / directional nozzle', 'Tilted refractory mouth on a trunnion cradle. The open bore makes aiming and outlet direction explicit.');
  box(root, 'Mounting shoe', [.22, .026, .22], [0, .013, 0], materials.iron);
  for (const x of [-.08, .08]) for (const z of [-.08, .08]) bolt(root, [x, .027, z]);
  for (const x of [-.063, .063]) box(root, 'Cradle cheek', [.018, .13, .075], [x, .091, -.025], materials.iron);
  const barrel = new T.Group(); barrel.name = 'Angled burner body';
  barrel.position.set(0, .15, -.025); barrel.rotation.x = 35 * Math.PI / 180;
  root.add(barrel);
  lathe(barrel, 'Open machined nozzle shell', [[.026, -.08], [.045, -.08], [.049, -.035],
    [.049, .07], [.059, .097], [.059, .116], [.041, .116], [.030, .075], [.026, -.08]], materials.steel);
  tube(barrel, 'Bronze base coupling', .026, .05, .026, materials.bronze, [0, -.085, 0], 12);
  tube(barrel, 'Dark grip band', .045, .053, .027, materials.iron, [0, -.029, 0]);
  lathe(barrel, 'Refractory mouth liner', [[.032, .070], [.038, .070], [.043, .117],
    [.045, .129], [.037, .129], [.032, .070]], materials.ceramic);
  for (const y of [.022, .036, .050]) tube(barrel, 'Cooling collar', .048, .055, .004, materials.steel, [0, y, 0]);
  for (const x of [-.074, .074]) {
    const pivot = cylinder(root, 'Trunnion pivot', .024, .018, materials.bronze, [x, .15, -.025], 32);
    pivot.rotation.z = Math.PI / 2;
  }
  source(barrel, 'nozzle-opening', [0, .129, 0], [0, 1, 0], { shape: 'circle', radius: .037 });
  return root;
}

await mkdir(resolve(out), { recursive: true });
const designs = [['crown-ring', ring()], ['seam-rail', rail()], ['lance-nozzle', nozzle()]];
const manifest = { purpose: 'Burner geometry studies for operator comparison', units: 'metres',
  integration: 'Unbound assets. No simulation, scene-host, collision or active emission changes.', designs: [] };
const exporter = new GLTFExporter();
async function writeAsset(name, root) {
  const data = Buffer.from(await exporter.parseAsync(root, { binary: true, onlyVisible: true }));
  await writeFile(resolve(out, name + '.glb'), data);
  return { file: name + '.glb', bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
for (const [id, root] of designs) {
  root.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(root), openings = [];
  root.traverse(node => {
    if (node.userData.role !== 'proposed-emission-opening') return;
    openings.push({ name: node.name, position: node.getWorldPosition(new T.Vector3()).toArray(),
      direction: new T.Vector3(0, 1, 0).transformDirection(node.matrixWorld).toArray(), aperture: node.userData.aperture });
  });
  manifest.designs.push({ id, name: root.name, description: root.userData.description,
    dimensions: bounds.getSize(new T.Vector3()).toArray(), bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
    openings, ...await writeAsset(id, root) });
}
const comparison = new T.Group(); comparison.name = 'Burner studies · Crown / Seam / Lance';
for (const [[, root], x] of designs.map((d, i) => [d, [-.63, .05, .64][i]])) {
  root.position.x = x; comparison.add(root);
}
manifest.comparison = await writeAsset('burner-studies', comparison);
await writeFile(resolve(out, 'designs.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output: resolve(out), designs: manifest.designs.map(({ id, file, openings }) => ({ id, file, openings: openings.length })), comparison: manifest.comparison }));
