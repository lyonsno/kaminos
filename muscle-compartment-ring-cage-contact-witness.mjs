import {
  extractMuscleCompartmentRingCageBoundary,
} from './muscle-compartment-ring-cage-contact-core.mjs';

function formatMetric(value) {
  if (!Number.isFinite(value)) return 'non-finite';
  if (Math.abs(value) < 1e-6) return value.toExponential(2);
  return value.toFixed(4);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function cagePayload(cage) {
  const boundary = extractMuscleCompartmentRingCageBoundary(cage.manifest);
  const nodeIndex = new Map(cage.manifest.nodes.map((node, index) => [node.id, index]));
  const fixedIds = new Set(
    cage.manifest.constraints.boundaryMasks
      .filter(mask => mask.fixed)
      .map(mask => mask.nodeId),
  );
  return {
    cageId: cage.cageId,
    constructionId: cage.constructionId,
    positions: cage.manifest.nodes.map(node => node.currentPosition),
    faces: boundary.faces.map(face => face.nodeIds.map(nodeId => nodeIndex.get(nodeId))),
    fixedNodeIndices: cage.manifest.nodes
      .map((node, index) => fixedIds.has(node.id) ? index : null)
      .filter(index => index !== null),
    axisNodeIndices: cage.manifest.nodes
      .map((node, index) => node.id.endsWith(':axis') ? index : null)
      .filter(index => index !== null),
  };
}

export function renderMuscleCompartmentRingCageContactHtml({
  sourceCarrier,
  observedCarrier,
  initializedCarrier,
  result,
  source,
  route,
  bundleIdentity,
  residualLedger,
  presentation = {},
}) {
  const effectiveObservedCarrier = observedCarrier ?? sourceCarrier;
  const effectiveInitializedCarrier = initializedCarrier ?? sourceCarrier;
  const observedCarrierSha256 = bundleIdentity?.observedCarrierSha256 ??
    bundleIdentity?.sourceCarrierSha256;
  const initializedCarrierSha256 = bundleIdentity?.initializedCarrierSha256 ??
    bundleIdentity?.sourceCarrierSha256;
  if (!bundleIdentity?.sha256 ||
      !effectiveObservedCarrier?.identity?.sha256 ||
      !effectiveInitializedCarrier?.identity?.sha256 ||
      observedCarrierSha256 !== effectiveObservedCarrier.identity.sha256 ||
      initializedCarrierSha256 !== effectiveInitializedCarrier.identity.sha256 ||
      bundleIdentity.packedCarrierSha256 !== result.packedCarrier.identity.sha256 ||
      !bundleIdentity.residualLedgerSha256 ||
      residualLedger?.sourceCarrierSha256 !== result.packedCarrier.identity.sha256 ||
      residualLedger?.sourceInputSha256 !== source.input.effective.sha256) {
    throw new Error('ring-cage witness requires an exact visual bundle identity');
  }
  const presentationFocus = presentation.focus || null;
  if (presentationFocus && (
    typeof presentationFocus !== 'object' ||
    Array.isArray(presentationFocus) ||
    JSON.stringify(Object.keys(presentationFocus).sort()) !==
      JSON.stringify(['point', 'radius']) ||
    !Array.isArray(presentationFocus.point) ||
    presentationFocus.point.length !== 3 ||
    !presentationFocus.point.every(Number.isFinite) ||
    !Number.isFinite(presentationFocus.radius) ||
    !(presentationFocus.radius > 0)
  )) {
    throw new Error('ring-cage witness presentation focus requires point[3] and radius > 0');
  }
  const authoredBone = presentation.authoredBone || null;
  if (authoredBone && (
    !Array.isArray(authoredBone.positions) ||
    !authoredBone.positions.every(point =>
      Array.isArray(point) && point.length === 3 && point.every(Number.isFinite)) ||
    !Array.isArray(authoredBone.faces) ||
    !authoredBone.faces.every(face =>
      Array.isArray(face) && face.length >= 3 &&
      face.every(index => Number.isInteger(index) && index >= 0 && index < authoredBone.positions.length))
  )) {
    throw new Error('ring-cage witness authored bone requires indexed finite mesh geometry');
  }
  const exactContactByState = presentation.exactContact ? {
    observed:presentation.exactContact.observed ?? presentation.exactContact.initial,
    initialized:presentation.exactContact.initialized ?? presentation.exactContact.initial,
    packed:presentation.exactContact.packed,
  } : null;
  const exactContact = exactContactByState ? {
    initial:exactContactByState.initialized?.summary,
    packed:exactContactByState.packed?.summary,
  } : null;
  if (exactContact && (!exactContact.initial || !exactContact.packed)) {
    throw new Error('ring-cage witness exact contact requires initial and packed summaries');
  }
  const payload = JSON.stringify({
    observedCages: effectiveObservedCarrier.cages.map(cagePayload),
    initializedCages: effectiveInitializedCarrier.cages.map(cagePayload),
    packedCages: result.packedCarrier.cages.map(cagePayload),
    source,
    route,
    bundleIdentity,
    residualLedger,
    presentationFocus,
    authoredBone,
    exactContact,
    exactContactByState,
  });
  const initial = result.metrics.initial;
  const packed = result.metrics.packed;
  const maxVolumeError = Math.max(...packed.cages.map(row => row.relativeVolumeError));
  const title = presentation.title || 'Current-K4 cage-level contact';
  const explanation = presentation.explanation ||
    'The source state is the squeezed, crowded construction. The proposal is the same ' +
    'identity-bound tetrahedral cages after whole-centerline curvature-regularized contact ' +
    'relief; fixed attachments remain fixed and visible residuals remain binding.';
  const sourceLabel = presentation.sourceLabel || 'Source crowded input';
  const proposalLabel = presentation.proposalLabel ||
    'Curvature-bearing proposal · residual remains';
  const authorityLabel = presentation.authorityLabel ||
    'Agent-authored provisional assay · no packing or anatomical admission';
  const colors = ['#ff6b6b', '#ffd166', '#4ecdc4', '#8f7cff', '#ff9f68', '#4f9dd9'];
  const legend = effectiveInitializedCarrier.cages.map((cage, index) =>
    `<span><i style="background:${colors[index]}"></i>${escapeHtml(cage.constructionId)}</span>`,
  ).join('');
  const exactRows = exactContact ? `
      <span>exact authored pairwise max</span><span class="value">${formatMetric(exactContact.initial.maximumPairwisePenetration)}</span><span class="value proposal">${formatMetric(exactContact.packed.maximumPairwisePenetration)}</span>
      <span>exact authored bone max</span><span class="value">${formatMetric(exactContact.initial.maximumSkeletalPenetration)}</span><span class="value proposal">${formatMetric(exactContact.packed.maximumSkeletalPenetration)}</span>
      <span>exact pairwise families</span><span class="value">${exactContact.initial.pairwiseIntersectionCount}</span><span class="value proposal">${exactContact.packed.pairwiseIntersectionCount}</span>
      <span>exact bone families</span><span class="value">${exactContact.initial.skeletalIntersectionCount}</span><span class="value proposal">${exactContact.packed.skeletalIntersectionCount}</span>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Current-K4 ring-cage contact assay</title>
  <style>
    :root { color-scheme:dark; font-family:Inter,ui-sans-serif,system-ui,sans-serif; }
    * { box-sizing:border-box; }
    body { margin:0; overflow:hidden; background:#07090d; color:#f4eee3; }
    #viewport { position:fixed; inset:0; }
    canvas { display:block; width:100%; height:100%; }
    .panel { position:fixed; z-index:3; top:18px; left:18px; width:min(430px,calc(100vw - 36px)); max-height:calc(100vh - 36px); overflow:auto; padding:16px 17px; border:1px solid #ffffff24; border-radius:14px; background:#0b1017eb; box-shadow:0 16px 60px #000a; backdrop-filter:blur(14px); }
    h1 { margin:0 0 4px; font:650 19px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:-.03em; }
    .authority { margin:0 0 7px; color:#e5b77d; font-size:10px; letter-spacing:.08em; text-transform:uppercase; }
    .status { margin:0 0 9px; color:#ffd166; font:700 10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.06em; text-transform:uppercase; }
    .explanation { margin:0 0 13px; color:#aeb9c6; font-size:11px; line-height:1.4; }
    .controls { display:flex; gap:8px; margin-bottom:9px; }
    .diagnostic-controls { margin-bottom:13px; }
    .diagnostic-controls button { min-height:31px; padding:5px 6px; font-size:9px; }
    button { flex:1; min-height:42px; padding:8px 10px; border:1px solid #ffffff24; border-radius:9px; color:#dce6f0; background:#111923; cursor:pointer; font:600 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace; }
    button[aria-pressed="true"] { color:#081016; background:#e7d1a8; border-color:#fff1d0; }
    .metrics { display:grid; grid-template-columns:1.45fr .82fr .82fr; gap:5px 9px; font:10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; }
    .head { color:#8e9baa; text-transform:uppercase; font-size:9px; letter-spacing:.08em; }
    .value { text-align:right; color:#dce6f0; }
    .proposal { color:#8ce6be; }
    .legend { display:flex; flex-wrap:wrap; gap:7px 13px; margin-top:13px; color:#aeb9c6; font-size:10px; }
    .legend i { display:inline-block; width:8px; height:8px; margin-right:5px; border-radius:50%; }
    .hint { position:fixed; z-index:2; right:18px; bottom:16px; max-width:390px; padding:9px 12px; border-radius:9px; background:#080c12d9; color:#aeb8c4; font-size:11px; text-align:right; }
    .identity { margin:11px 0 0; color:#778493; font:9px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
    .contact-families { margin:9px 0 0; color:#ffbd82; font:9px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; }
    @media (max-width:600px) { .panel { top:10px; left:10px; width:calc(100vw - 20px); padding:12px; } .hint { display:none; } }
  </style>
  <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}</script>
</head>
<body>
  <div id="viewport"></div>
  <section class="panel" aria-label="Ring-cage contact assay controls and residuals">
    <h1>${escapeHtml(title)}</h1>
    <p class="authority">${escapeHtml(authorityLabel)}</p>
    <p class="status">Solver disposition · ${escapeHtml(result.status)}</p>
    <p class="explanation">${escapeHtml(explanation)}</p>
    <div class="controls state-controls">
      <button data-state="observed">${escapeHtml(presentation.observedLabel || 'Exact authored source')}</button>
      <button data-state="initialized">${escapeHtml(sourceLabel)}</button>
      <button data-state="packed">${escapeHtml(proposalLabel)}</button>
    </div>
    <div class="controls diagnostic-controls" aria-label="Independent diagnostic overlays">
      <button data-diagnostic="wireframe">wireframe</button>
      <button data-diagnostic="source-ghost">source ghost</button>
      <button data-diagnostic="displacement">displacement</button>
      <button data-diagnostic="contacts">contacts</button>
    </div>
    <p id="contact-families" class="contact-families"></p>
    <div class="metrics">
      <span class="head">measurement</span><span class="head value">solver init</span><span class="head value">proposal</span>
      <span>movable pairwise total</span><span class="value">${formatMetric(initial.pairwise.movableTotalPenetration)}</span><span class="value proposal">${formatMetric(packed.pairwise.movableTotalPenetration)}</span>
      <span>movable pairwise max</span><span class="value">${formatMetric(initial.pairwise.movableMaximumPenetration)}</span><span class="value proposal">${formatMetric(packed.pairwise.movableMaximumPenetration)}</span>
      <span>fixed pairwise total</span><span class="value">${formatMetric(initial.pairwise.fixedTotalPenetration)}</span><span class="value proposal">${formatMetric(packed.pairwise.fixedTotalPenetration)}</span>
      <span>movable skeletal total</span><span class="value">${formatMetric(initial.skeletal.movableTotalPenetration)}</span><span class="value proposal">${formatMetric(packed.skeletal.movableTotalPenetration)}</span>
      <span>movable skeletal max</span><span class="value">${formatMetric(initial.skeletal.movableMaximumPenetration)}</span><span class="value proposal">${formatMetric(packed.skeletal.movableMaximumPenetration)}</span>
      <span>maximum local turn</span><span class="value">${formatMetric(Math.max(...initial.cages.map(row => row.centerline.maximumTurningAngle)))}</span><span class="value proposal">${formatMetric(Math.max(...packed.cages.map(row => row.centerline.maximumTurningAngle)))}</span>
      <span>maximum total turn</span><span class="value">${formatMetric(Math.max(...initial.cages.map(row => row.centerline.totalTurningAngle)))}</span><span class="value proposal">${formatMetric(Math.max(...packed.cages.map(row => row.centerline.totalTurningAngle)))}</span>
      <span>compartment escape</span><span class="value">${formatMetric(initial.compartment.maximumEscape)}</span><span class="value proposal">${formatMetric(packed.compartment.maximumEscape)}</span>
      <span>maximum volume error</span><span class="value">${formatMetric(Math.max(...initial.cages.map(row => row.relativeVolumeError)))}</span><span class="value proposal">${formatMetric(maxVolumeError)}</span>
${exactRows}
      <span>fixed-node drift</span><span class="value">0.0000</span><span class="value proposal">${formatMetric(result.fixedNodeMaximumDrift)}</span>
      <span>pairwise contact rows</span><span class="value">—</span><span class="value proposal">${residualLedger.pairwise.contacts.length}</span>
      <span>skeletal contact rows</span><span class="value">—</span><span class="value proposal">${residualLedger.skeletal.contacts.length}</span>
      <span>termination</span><span class="value">—</span><span class="value proposal">${escapeHtml(result.termination?.reason || 'unrecorded')}</span>
    </div>
    <div class="legend">${legend}<span><i style="background:#f5f1e8"></i>fixed attachments</span><span><i style="background:#b9d8ef"></i>${authoredBone ? 'exact authored bone' : 'skeletal capsule'}</span><span><i style="background:#99a8ba"></i>source boundary / ring displacement</span><span><i style="background:#ff8a3d"></i>exact movable pairwise family witness</span><span><i style="background:#ffffff"></i>packed fixed pairwise residual</span><span><i style="background:#48c7ff"></i>exact skeletal family witness</span></div>
    <p class="identity">bundle ${escapeHtml(bundleIdentity.sha256)}<br>generation ${escapeHtml(bundleIdentity.generation || 'legacy-unversioned')}<br>observed ${escapeHtml(observedCarrierSha256)}<br>initialized ${escapeHtml(initializedCarrierSha256)}<br>proposal ${escapeHtml(bundleIdentity.packedCarrierSha256)}<br>ledger ${escapeHtml(bundleIdentity.residualLedgerSha256)}<br>route requested ${escapeHtml(route.requested)}<br>route effective ${escapeHtml(route.effective)}</p>
  </section>
  <div class="hint">Drag to orbit · wheel to zoom · solid colored surfaces are the actual tetrahedral cage boundary, not a centerline tube reconstruction</div>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    const payload=${payload};
    const colors=[0xff6b6b,0xffd166,0x4ecdc4,0x8f7cff,0xff9f68,0x4f9dd9];
    const viewport=document.querySelector('#viewport');
    const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.08;
    renderer.setClearColor(0x07090d,1);
    viewport.append(renderer.domElement);
    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(38,1,.01,1000);
    const controls=new OrbitControls(camera,renderer.domElement);
    controls.enableDamping=true; controls.dampingFactor=.08;
    scene.add(new THREE.HemisphereLight(0xc8ddff,0x23140d,2.25));
    const key=new THREE.DirectionalLight(0xffead1,4.4); key.position.set(4,6,3); scene.add(key);
    const rim=new THREE.DirectionalLight(0x6e8fff,2.7); rim.position.set(-4,1,-5); scene.add(rim);
    function line(points,color,opacity=1){
      const geometry=new THREE.BufferGeometry().setFromPoints(points.map(point=>new THREE.Vector3(...point)));
      return new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity,depthTest:opacity>.3}));
    }
    function pressureLine(points,color){
      const geometry=new THREE.BufferGeometry().setFromPoints(points.map(point=>new THREE.Vector3(...point)));
      const visual=new THREE.Line(geometry,new THREE.LineBasicMaterial({color,transparent:true,opacity:.86,depthTest:false,depthWrite:false}));
      visual.renderOrder=20; return visual;
    }
    function witnessBeam(points,color,radius){
      const start=new THREE.Vector3(...points[0]),end=new THREE.Vector3(...points[1]),delta=end.clone().sub(start),span=delta.length();
      const visual=new THREE.Mesh(
        new THREE.CylinderGeometry(radius,radius,Math.max(.001,span),12),
        new THREE.MeshBasicMaterial({color,transparent:true,opacity:.96,depthTest:false,depthWrite:false}),
      );
      visual.position.copy(start).add(end).multiplyScalar(.5);
      visual.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize());
      visual.renderOrder=21;
      return visual;
    }
    function cageMesh(cage,color,opacity){
      const vertices=[];
      for(const face of cage.faces) for(const index of face) vertices.push(...cage.positions[index]);
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)); geometry.computeVertexNormals();
      const material=new THREE.MeshPhysicalMaterial({color,roughness:.34,metalness:.02,clearcoat:.25,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:true});
      return new THREE.Mesh(geometry,material);
    }
    function indexedSurfaceMesh(surface,color,opacity){
      const vertices=[];
      for(const face of surface.faces){
        for(let index=1;index<face.length-1;index+=1){
          vertices.push(...surface.positions[face[0]],...surface.positions[face[index]],...surface.positions[face[index+1]]);
        }
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)); geometry.computeVertexNormals();
      return new THREE.Mesh(geometry,new THREE.MeshPhysicalMaterial({color,roughness:.42,metalness:.02,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:true}));
    }
    function addCage(surfaceGroup,wireframeGroup,cage,index,opacity=1){
      const mesh=cageMesh(cage,colors[index],opacity); surfaceGroup.add(mesh);
      const edge=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,18),new THREE.LineBasicMaterial({color:colors[index],transparent:true,opacity:.45})); wireframeGroup.add(edge);
      surfaceGroup.add(line(cage.axisNodeIndices.map(nodeIndex=>cage.positions[nodeIndex]),0xffffff,.72));
      const fixedPositions=[];
      for(const nodeIndex of cage.fixedNodeIndices){
        const point=cage.positions[nodeIndex]; fixedPositions.push(point);
      }
      const unique=[];
      for(const point of fixedPositions) if(!unique.some(row=>new THREE.Vector3(...row).distanceTo(new THREE.Vector3(...point))<1e-6)) unique.push(point);
      for(const point of unique){
        const handle=new THREE.Mesh(new THREE.SphereGeometry(.055,16,12),new THREE.MeshStandardMaterial({color:0xf5f1e8,roughness:.35})); handle.position.set(...point); surfaceGroup.add(handle);
      }
    }
    function capsuleBetween(a,b,radius){
      const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start),span=delta.length();
      const mesh=new THREE.Mesh(new THREE.CapsuleGeometry(radius,Math.max(.001,span-radius*2),8,22),new THREE.MeshPhysicalMaterial({color:0xcdd6df,roughness:.42,transparent:true,opacity:.88}));
      mesh.position.copy(start).add(end).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()); return mesh;
    }
    const environmentGroup=new THREE.Group();
    if(payload.authoredBone){
      const bone=indexedSurfaceMesh(payload.authoredBone,0xcdd6df,.78); environmentGroup.add(bone);
      environmentGroup.add(new THREE.LineSegments(new THREE.EdgesGeometry(bone.geometry,18),new THREE.LineBasicMaterial({color:0xb9d8ef,transparent:true,opacity:.26})));
    }else{
      for(const obstacle of payload.source.obstacles||[]){
        if(obstacle.kind==='capsule') environmentGroup.add(capsuleBetween(obstacle.start,obstacle.end,obstacle.radius+(obstacle.clearance||0)));
      }
    }
    scene.add(environmentGroup);
    const compartment=payload.source.compartment,size=compartment.maximum.map((v,i)=>v-compartment.minimum[i]),center=compartment.maximum.map((v,i)=>(v+compartment.minimum[i])/2);
    const box=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),new THREE.LineDashedMaterial({color:0x86a6c8,transparent:true,opacity:.2,dashSize:.08,gapSize:.05})); box.computeLineDistances(); box.position.set(...center); scene.add(box);
    const stateGroups={
      observed:{surface:new THREE.Group(),wireframe:new THREE.Group()},
      initialized:{surface:new THREE.Group(),wireframe:new THREE.Group()},
      packed:{surface:new THREE.Group(),wireframe:new THREE.Group()},
    };
    const sourceBoundaryGhostGroup=new THREE.Group(),displacementGroup=new THREE.Group(),residualContactGroup=new THREE.Group();
    const stateContactGroups={observed:new THREE.Group(),initialized:new THREE.Group(),packed:new THREE.Group()};
    const exactContactRowsByState=Object.fromEntries(Object.entries(payload.exactContactByState||{}).map(([state,measurement])=>[
      state,
      [
        ...(measurement?.pairRows||[]).filter(row=>row.intersects).map(row=>({...row,kind:'pairwise'})),
        ...(measurement?.boneRows||[]).filter(row=>row.intersects).map(row=>({...row,kind:'skeletal'})),
      ].sort((left,right)=>right.maximumPenetration-left.maximumPenetration),
    ]));
    for(const [state,rows] of Object.entries(exactContactRowsByState)){
      for(const [rowIndex,row] of rows.entries()){
        if(!row.witness?.leftPoint||!row.witness?.rightPoint) continue;
        const color=row.kind==='skeletal'?0x48c7ff:0xff8a3d;
        const emphasis=rowIndex===0?1:.42;
        stateContactGroups[state].add(witnessBeam([row.witness.leftPoint,row.witness.rightPoint],color,.18+.34*emphasis));
        for(const point of [row.witness.leftPoint,row.witness.rightPoint]){
          const radius=.34+.7*emphasis;
          const marker=new THREE.Mesh(new THREE.SphereGeometry(radius,16,10),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.98,depthTest:false,depthWrite:false}));
          marker.position.set(...point); marker.renderOrder=22; stateContactGroups[state].add(marker);
        }
      }
    }
    payload.observedCages.forEach((cage,index)=>addCage(stateGroups.observed.surface,stateGroups.observed.wireframe,cage,index,.82));
    payload.initializedCages.forEach((cage,index)=>addCage(stateGroups.initialized.surface,stateGroups.initialized.wireframe,cage,index,.82));
    payload.packedCages.forEach((cage,index)=>addCage(stateGroups.packed.surface,stateGroups.packed.wireframe,cage,index,.82));
    payload.observedCages.forEach((sourceCage,index)=>{
      const sourceMesh=cageMesh(sourceCage,colors[index],0);
      const sourceBoundary=new THREE.LineSegments(
        new THREE.EdgesGeometry(sourceMesh.geometry,18),
        new THREE.LineBasicMaterial({color:colors[index],transparent:true,opacity:.42,depthTest:false,depthWrite:false}),
      );
      sourceBoundary.renderOrder=18;
      sourceBoundaryGhostGroup.add(sourceBoundary);
      const packedCage=payload.packedCages[index];
      for(const nodeIndex of sourceCage.axisNodeIndices){
        const sourcePoint=sourceCage.positions[nodeIndex];
        const packedPoint=packedCage.positions[nodeIndex];
        if(new THREE.Vector3(...sourcePoint).distanceTo(new THREE.Vector3(...packedPoint))>1e-6){
          displacementGroup.add(pressureLine([sourcePoint,packedPoint],colors[index]));
        }
      }
    });
    const contacts=[...payload.residualLedger.pairwise.contacts,...payload.residualLedger.skeletal.contacts];
    const maximumContact=Math.max(1e-9,...contacts.map(contact=>contact.penetration));
    for(const contact of contacts){
      const target=contact.closestObstacleBoundaryPoint||contact.closestObstacleAxisPoint||contact.closestCageBoundaryPoint;
      const color=contact.kind==='pairwise-boundary-inside-cage'
        ? (contact.fixed?0xffffff:0xff8a3d)
        : 0x48c7ff;
      residualContactGroup.add(pressureLine([contact.point,target],color));
      const radius=.018+.065*Math.sqrt(contact.penetration/maximumContact);
      const marker=new THREE.Mesh(new THREE.SphereGeometry(radius,12,8),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.94,depthTest:false,depthWrite:false}));
      marker.position.set(...contact.point); marker.renderOrder=21; residualContactGroup.add(marker);
    }
    for(const groups of Object.values(stateGroups)) scene.add(groups.surface,groups.wireframe);
    scene.add(sourceBoundaryGhostGroup,displacementGroup,residualContactGroup,...Object.values(stateContactGroups));
    const bounds=new THREE.Box3();
    for(const cage of [...payload.observedCages,...payload.initializedCages,...payload.packedCages]) for(const point of cage.positions) bounds.expandByPoint(new THREE.Vector3(...point));
    if(payload.authoredBone) for(const point of payload.authoredBone.positions) bounds.expandByPoint(new THREE.Vector3(...point));
    for(const obstacle of payload.source.obstacles||[]){
      if(obstacle.start) bounds.expandByPoint(new THREE.Vector3(...obstacle.start));
      if(obstacle.end) bounds.expandByPoint(new THREE.Vector3(...obstacle.end));
    }
    const framingCenter=bounds.getCenter(new THREE.Vector3()),framingSize=bounds.getSize(new THREE.Vector3()),framingRadius=Math.max(.25,framingSize.length()*.5);
    const framingDistance=framingRadius/Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))*1.12;
    camera.near=Math.max(.001,framingRadius/500); camera.far=Math.max(100,framingRadius*30); camera.updateProjectionMatrix();
    const query=new URLSearchParams(location.search);
    const expectedIdentity=payload.bundleIdentity;
    const requestedIdentity={bundle:query.get('bundle'),observed:query.get('observed')||query.get('source'),initialized:query.get('initialized')||query.get('source'),packed:query.get('packed'),ledger:query.get('ledger'),routeRequested:query.get('routeRequested'),routeEffective:query.get('routeEffective')};
    const requestedCaptureBatch=query.get('captureBatch')||'manual-unbatched';
    const effectiveObservedIdentity=expectedIdentity.observedCarrierSha256||expectedIdentity.sourceCarrierSha256;
    const effectiveInitializedIdentity=expectedIdentity.initializedCarrierSha256||expectedIdentity.sourceCarrierSha256;
    if(requestedIdentity.bundle!==expectedIdentity.sha256||requestedIdentity.observed!==effectiveObservedIdentity||requestedIdentity.initialized!==effectiveInitializedIdentity||requestedIdentity.packed!==expectedIdentity.packedCarrierSha256||requestedIdentity.ledger!==expectedIdentity.residualLedgerSha256||requestedIdentity.routeRequested!==payload.route.requested||requestedIdentity.routeEffective!==payload.route.effective){
      document.body.innerHTML='<pre style="margin:24px;color:#ff8b8b">identity-bound capture route mismatch\\n'+JSON.stringify({requested:requestedIdentity,effective:expectedIdentity},null,2)+'</pre>';
      throw new Error('identity-bound capture route mismatch');
    }
    const viewMode=query.get('view');
    const requestedState=['observed','initialized','packed'].includes(query.get('state'))?query.get('state'):(query.get('state')==='before'?'initialized':'packed');
    const strongestContact=(exactContactRowsByState[requestedState]||[])[0]||null;
    const generatedContactFocus=strongestContact?.witness?.leftPoint&&strongestContact?.witness?.rightPoint?{
      point:strongestContact.witness.leftPoint.map((value,axis)=>(value+strongestContact.witness.rightPoint[axis])/2),
      radius:Math.max(framingRadius*.82,strongestContact.maximumPenetration*5),
    }:null;
    const contactFocus=viewMode==='contact'?(payload.presentationFocus||generatedContactFocus):null;
    const effectiveCenter=contactFocus
      ? new THREE.Vector3(...contactFocus.point)
      : framingCenter;
    const effectiveRadius=contactFocus
      ? contactFocus.radius
      : framingRadius;
    const effectiveDistance=effectiveRadius/Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))*1.12;
    const viewDirection=viewMode==='side'
      ? new THREE.Vector3(-1.2,.2,.08)
      : new THREE.Vector3(1.08,.72,1.12);
    camera.position.copy(effectiveCenter).add(viewDirection.normalize().multiplyScalar(effectiveDistance));
    controls.target.copy(effectiveCenter); controls.minDistance=effectiveRadius*.4; controls.maxDistance=framingRadius*10; controls.update();
    if(viewMode==='contact'){
      for(const groups of Object.values(stateGroups)) groups.surface.traverse(object=>{
        if(object.isMesh&&object.material?.transparent){ object.material.opacity=.48; object.material.depthWrite=false; }
      });
      environmentGroup.traverse(object=>{
        if(object.isMesh&&object.material?.transparent){ object.material.opacity=.32; object.material.depthWrite=false; }
      });
    }
    const diagnostics={wireframe:false,sourceGhost:false,displacement:false,contacts:false};
    let currentState='packed';
    function applyDiagnostics(){
      for(const [state,groups] of Object.entries(stateGroups)) groups.wireframe.visible=diagnostics.wireframe&&state===currentState;
      sourceBoundaryGhostGroup.visible=diagnostics.sourceGhost;
      displacementGroup.visible=diagnostics.displacement;
      for(const [state,groups] of Object.entries(stateContactGroups)) groups.visible=diagnostics.contacts&&state===currentState;
      residualContactGroup.visible=diagnostics.contacts&&currentState==='packed';
      const rows=exactContactRowsByState[currentState]||[];
      document.querySelector('#contact-families').textContent=diagnostics.contacts
        ? (rows.length?rows.map((row,index)=>(index===0?'strongest → ':'')+row.key+' · '+row.maximumPenetration.toFixed(4)).join('  |  '):'no exact contact families in this state')
        : '';
      document.querySelectorAll('[data-diagnostic]').forEach(button=>button.setAttribute('aria-pressed',String(diagnostics[button.dataset.diagnostic.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())])));
    }
    function showState(state){
      currentState=state;
      for(const [name,groups] of Object.entries(stateGroups)) groups.surface.visible=name===state;
      applyDiagnostics();
      document.querySelectorAll('[data-state]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.state===state)));
      document.documentElement.dataset.witnessState=state;
    }
    document.querySelectorAll('[data-state]').forEach(button=>button.addEventListener('click',()=>showState(button.dataset.state)));
    document.querySelectorAll('[data-diagnostic]').forEach(button=>button.addEventListener('click',()=>{
      const key=button.dataset.diagnostic.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()); diagnostics[key]=!diagnostics[key]; applyDiagnostics();
    }));
    function resize(){const width=Math.max(1,viewport.clientWidth),height=Math.max(1,viewport.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
    new ResizeObserver(resize).observe(viewport); resize();
    for(const diagnostic of (query.get('diagnostics')||'').split(',').filter(Boolean)){
      const key=diagnostic.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()); if(Object.hasOwn(diagnostics,key)) diagnostics[key]=true;
    }
    showState(requestedState);
    document.documentElement.dataset.witnessLoaded='false';
    document.documentElement.dataset.witnessRenderComplete='false';
    document.documentElement.dataset.witnessRenderFrame='0';
    document.documentElement.dataset.witnessCaptureBatch=requestedCaptureBatch;
    document.documentElement.dataset.witnessRouteRequested=payload.route.requested;
    document.documentElement.dataset.witnessRouteEffective=payload.route.effective;
    document.documentElement.dataset.witnessBundle=expectedIdentity.sha256;
    document.documentElement.dataset.witnessGeneration=expectedIdentity.generation||'legacy-unversioned';
    document.documentElement.dataset.observedCarrier=effectiveObservedIdentity;
    document.documentElement.dataset.initializedCarrier=effectiveInitializedIdentity;
    document.documentElement.dataset.packedCarrier=expectedIdentity.packedCarrierSha256;
    document.documentElement.dataset.residualLedger=expectedIdentity.residualLedgerSha256;
    let renderedFrameCount=0;
    renderer.setAnimationLoop(()=>{
      controls.update();
      renderer.render(scene,camera);
      renderedFrameCount+=1;
      document.documentElement.dataset.witnessRenderFrame=String(renderedFrameCount);
      if(renderedFrameCount===1){
        document.documentElement.dataset.witnessRenderComplete='true';
        document.documentElement.dataset.witnessLoaded='true';
      }
    });
  </script>
</body>
</html>`;
}
