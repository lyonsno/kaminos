#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// GLTFExporter uses FileReader for the final in-memory GLB. Node has Blob but
// not FileReader, so provide the two methods the exporter needs for geometry-
// only assets. No browser or texture pipeline is involved in source generation.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    result = null;
    onload = null;
    onloadend = null;
    onerror = null;
    async readAsArrayBuffer(blob) {
      try {
        this.result = await blob.arrayBuffer();
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      }
      catch (error) { this.onerror?.(error); }
    }
    async readAsDataURL(blob) {
      try {
        const bytes = Buffer.from(await blob.arrayBuffer());
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${bytes.toString('base64')}`;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      } catch (error) { this.onerror?.(error); }
    }
  };
}

const OUT = resolve(process.argv[2] || 'assets/burner-assemblies');
await mkdir(OUT, { recursive: true });

const colors = {
  iron: 0x252c32,
  ironLight: 0x46515a,
  graphite: 0x11171b,
  stainless: 0xaeb9bd,
  brass: 0xb47b3c,
  copper: 0xc1784e,
  refractory: 0xe1cba3,
  ceramicBlue: 0x417d82,
  ceramicDark: 0x173538,
};

function material(name, color, metalness, roughness) {
  const value = new THREE.MeshStandardMaterial({ color, metalness, roughness });
  value.name = name;
  return value;
}

function part(parent, name, geometry, mat, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function group(parent, name, position = [0, 0, 0], rotation = [0, 0, 0]) {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(...position);
  node.rotation.set(...rotation);
  parent.add(node);
  return node;
}

function circleLoop(radius, segments = 96, clockwise = false, center = [0, 0]) {
  return Array.from({ length: segments }, (_, i) => {
    const a = (clockwise ? -1 : 1) * 2 * Math.PI * i / segments;
    return [center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius];
  });
}

function roundedRectLoop(length, width, radius, cornerSegments = 8, clockwise = false) {
  const x = length * 0.5, z = width * 0.5, r = Math.min(radius, x, z);
  const corners = [
    [x - r, -z + r, -Math.PI / 2, 0],
    [x - r, z - r, 0, Math.PI / 2],
    [-x + r, z - r, Math.PI / 2, Math.PI],
    [-x + r, -z + r, Math.PI, Math.PI * 1.5],
  ];
  const points = [];
  for (const [cx, cz, start, end] of corners) {
    for (let j = 0; j <= cornerSegments; j++) {
      const a = start + (end - start) * j / cornerSegments;
      points.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  return clockwise ? points.reverse() : points;
}

function shapeFromLoop(loop, holes = []) {
  const shape = new THREE.Shape();
  shape.moveTo(loop[0][0], loop[0][1]);
  for (const point of loop.slice(1)) shape.lineTo(point[0], point[1]);
  shape.closePath();
  for (const hole of holes) {
    const path = new THREE.Path();
    path.moveTo(hole[0][0], hole[0][1]);
    for (const point of hole.slice(1)) path.lineTo(point[0], point[1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

function planExtrusion(shape, bottom, height, bevel = 0) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: bevel > 0,
    bevelSegments: bevel > 0 ? 2 : 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    curveSegments: 8,
  });
  // Shape coordinates are X/Z; move the extrusion's depth onto the Y axis.
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, bottom + height, 0);
  return geometry;
}

function ringMesh(parent, name, major, tube, mat, position, rotation = [Math.PI / 2, 0, 0], radialSegments = 8) {
  const geometry = new THREE.TorusGeometry(major, tube, radialSegments, 48);
  return part(parent, name, geometry, mat, position, rotation);
}

function cylinder(parent, name, radiusTop, radiusBottom, height, mat, position, rotation = [0, 0, 0], sides = 24) {
  return part(parent, name, new THREE.CylinderGeometry(radiusTop, radiusBottom, height, sides), mat, position, rotation);
}

function beam(parent, name, start, end, width, depth, mat) {
  const a = new THREE.Vector3(...start), b = new THREE.Vector3(...end);
  const direction = b.clone().sub(a);
  const mesh = part(parent, name, new THREE.BoxGeometry(width, direction.length(), depth), mat,
    a.clone().add(b).multiplyScalar(0.5).toArray());
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return mesh;
}

function openPipeGeometry(outerRadius, innerRadius, length, segments = 48) {
  const points = [
    new THREE.Vector2(outerRadius, 0),
    new THREE.Vector2(outerRadius, length),
    new THREE.Vector2(innerRadius, length),
    new THREE.Vector2(innerRadius, 0),
  ];
  const geometry = new THREE.LatheGeometry(points, segments);
  geometry.rotateX(Math.PI / 2); // +Y axis becomes +Z.
  return geometry;
}

function setAssetMetadata(root, type, outlets, description) {
  root.userData = {
    schema: 'kaminos.burner-assembly.v1',
    assetType: type,
    units: 'meters',
    coordinates: { handedness: 'right', up: '+Y', forward: '+Z', right: '+X' },
    description,
    outlets,
  };
}

function makeAnnular() {
  const root = group(new THREE.Group(), 'Annular burner — HaloForge');
  root.userData.role = 'annular-burner-assembly';
  const iron = material('Satin cast iron', colors.iron, 0.72, 0.38);
  const ironLight = material('Machined iron highlights', colors.ironLight, 0.8, 0.3);
  const brass = material('Warm brass port rims', colors.brass, 0.82, 0.24);
  const ceramic = material('Refractory annular deck', colors.refractory, 0.12, 0.72);
  const dark = material('Recessed burner channel', colors.graphite, 0.28, 0.64);
  const portCount = 24, portCircleRadius = 0.372, portRadius = 0.019;
  const top = 0.22, deckThickness = 0.046;

  const manifold = new THREE.LatheGeometry([
    new THREE.Vector2(0.475, 0.035), new THREE.Vector2(0.535, 0.065),
    new THREE.Vector2(0.535, 0.135), new THREE.Vector2(0.49, 0.175),
    new THREE.Vector2(0.215, 0.175), new THREE.Vector2(0.185, 0.14),
    new THREE.Vector2(0.185, 0.07), new THREE.Vector2(0.225, 0.035),
    new THREE.Vector2(0.475, 0.035),
  ], 128);
  part(root, 'Toroidal fuel plenum', manifold, iron);

  const holeLoops = [circleLoop(0.205, 128, true)];
  const outletRows = [];
  for (let i = 0; i < portCount; i++) {
    const angle = 2 * Math.PI * i / portCount;
    const x = portCircleRadius * Math.cos(angle), z = portCircleRadius * Math.sin(angle);
    holeLoops.push(circleLoop(portRadius, 24, true, [x, z]));
    outletRows.push({
      id: `ring-port-${String(i + 1).padStart(2, '0')}`,
      position: [Number(x.toFixed(6)), top, Number(z.toFixed(6))],
      direction: [0, 1, 0],
      aperture: { shape: 'circle', radius: portRadius, diameter: portRadius * 2,
        description: 'Machined circular through-port in the top face; all ports form one upward annular outlet array.' },
    });
  }
  const outerLoop = circleLoop(0.55, 160, false);
  const deckShape = shapeFromLoop(outerLoop, holeLoops);
  part(root, 'Perforated annular deck — 24 open ports', planExtrusion(deckShape, top - deckThickness, deckThickness), ceramic);

  ringMesh(root, 'Outer deck bead', 0.538, 0.012, ironLight, [0, top + 0.004, 0]);
  ringMesh(root, 'Central opening bead', 0.213, 0.009, brass, [0, top + 0.004, 0]);
  const portArray = group(root, 'Twenty-four brass port lips');
  const portLipGeometry = new THREE.TorusGeometry(0.025, 0.0032, 8, 32);
  for (let i = 0; i < portCount; i++) {
    const angle = 2 * Math.PI * i / portCount;
    const x = portCircleRadius * Math.cos(angle), z = portCircleRadius * Math.sin(angle);
    part(portArray, `Port lip ${String(i + 1).padStart(2, '0')}`, portLipGeometry, brass,
      [x, top + 0.002, z], [Math.PI / 2, 0, 0]);
  }

  const feet = group(root, 'Three leveling shoes');
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 6 + i * 2 * Math.PI / 3;
    const x = Math.cos(a) * 0.405, z = Math.sin(a) * 0.405;
    cylinder(feet, `Foot ${i + 1}`, 0.075, 0.09, 0.04, ironLight, [x, 0.02, z]);
    cylinder(feet, `Isolator pad ${i + 1}`, 0.082, 0.082, 0.012, dark, [x, 0.006, z]);
  }

  const feed = group(root, 'Rear fuel inlet');
  const feedGeo = new THREE.LatheGeometry([
    new THREE.Vector2(0.042, 0), new THREE.Vector2(0.042, 0.14),
    new THREE.Vector2(0.029, 0.14), new THREE.Vector2(0.029, 0),
  ], 40);
  const feedPose = new THREE.Object3D();
  feedPose.position.set(0, 0.095, -0.50);
  feedPose.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1));
  root.add(feedPose);
  part(feedPose, 'Hollow feed neck', feedGeo, ironLight);
  cylinder(feedPose, 'Hex inlet union', 0.058, 0.058, 0.055, brass, [0, 0.125, 0], [0, 0, 0], 6);
  cylinder(feedPose, 'Union collar', 0.045, 0.045, 0.016, iron, [0, 0.16, 0], [0, 0, 0], 32);

  const outlets = {
    pattern: '24 upward circular ports distributed evenly around a central open annulus',
    count: portCount,
    centerlineRadius: portCircleRadius,
    entries: outletRows,
  };
  setAssetMetadata(root, 'annular', outlets,
    'Compact cast plenum with a machined refractory ring deck and a genuinely open central aperture.');
  return { root, outlets };
}

function makeLinear() {
  const root = group(new THREE.Group(), 'Linear burner — RibbonRail');
  root.userData.role = 'linear-burner-assembly';
  const iron = material('Blue-black burner steel', colors.iron, 0.7, 0.34);
  const edge = material('Brushed stainless rail', colors.stainless, 0.86, 0.26);
  const brass = material('Bronze hardware', colors.copper, 0.78, 0.28);
  const ceramic = material('Deep teal ceramic deck', colors.ceramicBlue, 0.26, 0.42);
  const channel = material('Shadowed slot throat', colors.graphite, 0.18, 0.75);
  const deckBottom = 0.228, deckHeight = 0.044, slotLength = 1.035, slotWidth = 0.036;

  part(root, 'Long plenum housing', planExtrusion(shapeFromLoop(roundedRectLoop(1.38, 0.34, 0.045)), 0.055, 0.19, 0.008), iron);
  const deckShape = shapeFromLoop(roundedRectLoop(1.28, 0.284, 0.037), [
    roundedRectLoop(slotLength, slotWidth, slotWidth / 2, 8, true),
  ]);
  part(root, 'Slotted ceramic emitter deck — continuous open ribbon', planExtrusion(deckShape, deckBottom, deckHeight), ceramic);

  // Dark floor is recessed well below the open slot. Nothing spans or caps the
  // 1.035 m by 0.036 m outlet in the emitter deck.
  part(root, 'Recessed gas trough floor', new THREE.BoxGeometry(1.06, 0.025, 0.086), channel, [0, 0.115, 0]);
  part(root, 'Left slot wear rail', new THREE.BoxGeometry(1.18, 0.012, 0.014), edge, [0, deckBottom + deckHeight + 0.003, -0.029]);
  part(root, 'Right slot wear rail', new THREE.BoxGeometry(1.18, 0.012, 0.014), edge, [0, deckBottom + deckHeight + 0.003, 0.029]);
  part(root, 'Left deck shoulder', new THREE.BoxGeometry(1.12, 0.028, 0.024), brass, [0, deckBottom + deckHeight + 0.005, -0.116]);
  part(root, 'Right deck shoulder', new THREE.BoxGeometry(1.12, 0.028, 0.024), brass, [0, deckBottom + deckHeight + 0.005, 0.116]);

  const feet = group(root, 'Four isolation feet');
  for (let i = 0; i < 4; i++) {
    const x = i % 2 ? 0.5 : -0.5;
    const z = i < 2 ? -0.12 : 0.12;
    part(feet, `Foot ${i + 1}`, new THREE.BoxGeometry(0.20, 0.05, 0.11), iron, [x, 0.03, z]);
    cylinder(feet, `Foot pad ${i + 1}`, 0.048, 0.048, 0.013, channel, [x, 0.0065, z], [0, 0, 0], 32);
  }

  const fasteners = group(root, 'Deck fasteners');
  for (const x of [-0.54, -0.36, -0.18, 0, 0.18, 0.36, 0.54]) {
    for (const z of [-0.127, 0.127]) {
      cylinder(fasteners, `Hex bolt ${x.toFixed(2)} ${z.toFixed(2)}`, 0.012, 0.012, 0.012,
        brass, [x, deckBottom + deckHeight + 0.006, z], [0, 0, 0], 6);
    }
  }

  const inlet = group(root, 'End-fed gas inlet', [0.69, 0.13, 0]);
  part(inlet, 'Inlet boss', new THREE.CylinderGeometry(0.063, 0.063, 0.07, 32), brass, [0.015, 0, 0], [0, 0, Math.PI / 2]);
  part(inlet, 'Open supply socket', openPipeGeometry(0.048, 0.032, 0.18, 40), edge,
    [0.045, 0, 0], [0, Math.PI / 2, 0]);
  ringMesh(inlet, 'Socket rim', 0.043, 0.005, brass, [0.225, 0, 0], [0, Math.PI / 2, 0]);

  const outlet = {
    id: 'continuous-ribbon-slot',
    position: [0, deckBottom + deckHeight, 0],
    direction: [0, 1, 0],
    aperture: { shape: 'rounded-rectangle', length: slotLength, width: slotWidth,
      cornerRadius: slotWidth / 2, description: 'One continuous through-slot, long axis along +X, facing upward.' },
  };
  setAssetMetadata(root, 'linear', { pattern: 'one continuous upward ribbon slot', count: 1, entries: [outlet] },
    'Low, rail-like plenum with an uninterrupted rounded slot cut through its ceramic emitter deck.');
  return { root, outlets: { pattern: 'one continuous upward ribbon slot', count: 1, entries: [outlet] } };
}

function makeDirectional() {
  const root = group(new THREE.Group(), 'Directional nozzle — VectorLance');
  root.userData.role = 'directional-nozzle-assembly';
  const iron = material('Charcoal enamel frame', colors.iron, 0.66, 0.31);
  const dark = material('Dark inner throat', colors.graphite, 0.22, 0.58);
  const titanium = material('Brushed titanium bell', colors.stainless, 0.88, 0.23);
  const brass = material('Copper-brass control details', colors.brass, 0.84, 0.25);
  const refractory = material('Copper refractory liner', 0xa95432, 0.3, 0.54);

  part(root, 'Weighted swivel base', planExtrusion(shapeFromLoop(roundedRectLoop(0.67, 0.50, 0.065)), 0.025, 0.105), iron);
  part(root, 'Base top inset', planExtrusion(shapeFromLoop(roundedRectLoop(0.48, 0.34, 0.045)), 0.13, 0.018), titanium);
  for (const x of [-0.24, 0.24]) {
    cylinder(root, `Base anchor ${x < 0 ? 'L' : 'R'}`, 0.018, 0.018, 0.014, brass, [x, 0.153, -0.13], [0, 0, 0], 6);
  }

  const pivot = [0, 0.66, -0.095];
  for (const x of [-0.205, 0.205]) {
    beam(root, `Elevation yoke arm ${x < 0 ? 'L' : 'R'}`, [x, 0.13, -0.18], [x, pivot[1], pivot[2]], 0.065, 0.072, iron);
    cylinder(root, `Yoke pivot bearing ${x < 0 ? 'L' : 'R'}`, 0.09, 0.09, 0.07, brass,
      [x, pivot[1], pivot[2]], [0, 0, Math.PI / 2], 48);
    cylinder(root, `Pivot lock cap ${x < 0 ? 'L' : 'R'}`, 0.042, 0.042, 0.012, titanium,
      [x + (x < 0 ? -0.041 : 0.041), pivot[1], pivot[2]], [0, 0, Math.PI / 2], 32);
    cylinder(root, `Pivot index hub ${x < 0 ? 'L' : 'R'}`, 0.018, 0.018, 0.014, dark,
      [x + (x < 0 ? -0.05 : 0.05), pivot[1], pivot[2]], [0, 0, Math.PI / 2], 24);
  }

  const elevation = -0.27;
  const barrel = group(root, 'Aimed hollow nozzle barrel', pivot, [elevation, 0, 0]);
  const shellGeometry = new THREE.LatheGeometry([
    new THREE.Vector2(0.118, 0), new THREE.Vector2(0.138, 0.20),
    new THREE.Vector2(0.178, 0.54), new THREE.Vector2(0.242, 0.82),
    new THREE.Vector2(0.245, 0.93), new THREE.Vector2(0.202, 0.93),
    new THREE.Vector2(0.194, 0.83), new THREE.Vector2(0.142, 0.49),
    new THREE.Vector2(0.105, 0.18), new THREE.Vector2(0.105, 0),
  ], 96);
  shellGeometry.rotateX(Math.PI / 2);
  part(barrel, 'Bell shell with open bore', shellGeometry, titanium);

  const linerGeometry = new THREE.LatheGeometry([
    new THREE.Vector2(0.145, 0.50), new THREE.Vector2(0.197, 0.81),
    new THREE.Vector2(0.198, 0.89), new THREE.Vector2(0.188, 0.89),
    new THREE.Vector2(0.188, 0.81), new THREE.Vector2(0.138, 0.50),
  ], 80);
  linerGeometry.rotateX(Math.PI / 2);
  part(barrel, 'Removable refractory muzzle liner', linerGeometry, refractory);
  ringMesh(barrel, 'Muzzle crown', 0.231, 0.016, brass, [0, 0, 0.923], [0, 0, 0], 10);
  ringMesh(barrel, 'Rear neck collar', 0.132, 0.011, iron, [0, 0, 0.17], [0, 0, 0]);

  // Three exterior cooling hoops follow the bell's widening profile while
  // staying outside the hollow bore.
  for (const [index, [z, radius]] of [[0.28, 0.151], [0.46, 0.169], [0.66, 0.206]].entries()) {
    ringMesh(barrel, `Cooling hoop ${index + 1}`, radius, 0.0045, iron,
      [0, 0, z], [0, 0, 0], 8);
  }

  const valve = group(root, 'Rear metering valve', [-0.25, 0.185, -0.12]);
  cylinder(valve, 'Valve body', 0.055, 0.055, 0.09, brass, [0, 0, 0], [Math.PI / 2, 0, 0], 10);
  cylinder(valve, 'Valve stem', 0.018, 0.018, 0.085, titanium, [0, 0.07, 0], [0, 0, 0], 20);
  cylinder(valve, 'Cross-grip wheel', 0.053, 0.053, 0.018, iron, [0, 0.125, 0], [0, 0, 0], 12);

  const sin = Math.sin(-elevation), cos = Math.cos(-elevation);
  const outlet = {
    id: 'directional-circular-mouth',
    position: [0, Number((pivot[1] + sin * 0.93).toFixed(6)), Number((pivot[2] + cos * 0.93).toFixed(6))],
    direction: [0, Number(sin.toFixed(8)), Number(cos.toFixed(8))],
    aperture: { shape: 'circle', radius: 0.188, diameter: 0.376,
      description: 'Hollow flared mouth, facing forward and 15.47 degrees above horizontal; the barrel remains open through its throat.' },
  };
  setAssetMetadata(root, 'directional-nozzle', { pattern: 'one aimed circular nozzle mouth', count: 1, entries: [outlet] },
    'Pivot-mounted hollow bell with a fixed upward-forward aim and a visible elevation yoke.');
  return { root, outlets: { pattern: 'one aimed circular nozzle mouth', count: 1, entries: [outlet] } };
}

async function exportGlb(root, file) {
  root.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  const bytes = await exporter.parseAsync(root, { binary: true, onlyVisible: true, trs: false });
  await writeFile(resolve(OUT, file), Buffer.from(bytes));
}

const designs = [
  { key: 'annular', filename: 'annular-haloforge.glb', maker: makeAnnular },
  { key: 'linear', filename: 'linear-ribbonrail.glb', maker: makeLinear },
  { key: 'directional', filename: 'directional-vectorlance.glb', maker: makeDirectional },
];
const outputs = {};
for (const design of designs) {
  const { root, outlets } = design.maker();
  await exportGlb(root, design.filename);
  outputs[design.key] = { root, outlets, filename: design.filename };
}

const comparison = group(new THREE.Group(), 'Burner assembly comparison');
comparison.userData = {
  schema: 'kaminos.burner-assembly-comparison.v1',
  units: 'meters',
  coordinates: { handedness: 'right', up: '+Y', forward: '+Z', right: '+X' },
  layout: 'three independent assemblies, ordered annular / linear / directional along +X',
};
const placements = { annular: [-1.55, 0, 0], linear: [0, 0, 0], directional: [1.55, 0, 0] };
for (const key of ['annular', 'linear', 'directional']) {
  const clone = outputs[key].root.clone(true);
  clone.position.set(...placements[key]);
  clone.name = `${key} design at comparison position`;
  clone.userData.comparisonTranslation = placements[key];
  comparison.add(clone);
}
await exportGlb(comparison, 'burner-assembly-comparison.glb');

const outletData = {
  schema: 'kaminos.burner-outlets.v1',
  units: 'meters; all positions are in each standalone asset root coordinate frame',
  coordinateSystem: { handedness: 'right', up: '+Y', forward: '+Z', right: '+X', gltfUnits: '1 unit = 1 meter' },
  assets: Object.fromEntries(Object.entries(outputs).map(([key, value]) => [key, {
    file: value.filename,
    name: value.root.name,
    outlets: value.outlets,
  }])),
  comparison: {
    file: 'burner-assembly-comparison.glb',
    rootTranslationMeters: placements,
    outletCoordinatesRemainLocalToEachNamedAssemblyRoot: true,
  },
};
await writeFile(resolve(OUT, 'outlets.json'), `${JSON.stringify(outletData, null, 2)}\n`);

for (const path of Object.values(outputs).map(value => value.filename).concat('burner-assembly-comparison.glb')) {
  console.log(resolve(OUT, path));
}
console.log(resolve(OUT, 'outlets.json'));
