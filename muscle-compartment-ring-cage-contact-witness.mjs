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
  result,
  source,
  route,
  bundleIdentity,
  residualLedger,
}) {
  if (!bundleIdentity?.sha256 ||
      bundleIdentity.sourceCarrierSha256 !== sourceCarrier.identity.sha256 ||
      bundleIdentity.packedCarrierSha256 !== result.packedCarrier.identity.sha256 ||
      !bundleIdentity.residualLedgerSha256 ||
      residualLedger?.sourceCarrierSha256 !== result.packedCarrier.identity.sha256 ||
      residualLedger?.sourceInputSha256 !== source.input.effective.sha256) {
    throw new Error('ring-cage witness requires an exact visual bundle identity');
  }
  const payload = JSON.stringify({
    sourceCages: sourceCarrier.cages.map(cagePayload),
    packedCages: result.packedCarrier.cages.map(cagePayload),
    source,
    route,
    bundleIdentity,
    residualLedger,
  });
  const initial = result.metrics.initial;
  const packed = result.metrics.packed;
  const maxVolumeError = Math.max(...packed.cages.map(row => row.relativeVolumeError));
  const colors = ['#ff6b6b', '#ffd166', '#4ecdc4', '#8f7cff'];
  const legend = sourceCarrier.cages.map((cage, index) =>
    `<span><i style="background:${colors[index]}"></i>${escapeHtml(cage.constructionId)}</span>`,
  ).join('');
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
    .controls { display:flex; gap:8px; margin-bottom:13px; }
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
    @media (max-width:600px) { .panel { top:10px; left:10px; width:calc(100vw - 20px); padding:12px; } .hint { display:none; } }
  </style>
  <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/"}}</script>
</head>
<body>
  <div id="viewport"></div>
  <section class="panel" aria-label="Ring-cage contact assay controls and residuals">
    <h1>Current-K4 cage-level contact</h1>
    <p class="authority">Agent-authored provisional assay · no packing or anatomical admission</p>
    <p class="status">Solver disposition · ${escapeHtml(result.status)}</p>
    <p class="explanation">The source state is the squeezed, crowded construction. The proposal is the same identity-bound tetrahedral cages after whole-centerline curvature-regularized contact relief; fixed attachments remain fixed and visible residuals remain binding.</p>
    <div class="controls">
      <button data-state="before">Source crowded input</button>
      <button data-state="packed">Curvature-bearing proposal · residual remains</button>
    </div>
    <div class="metrics">
      <span class="head">measurement</span><span class="head value">source</span><span class="head value">proposal</span>
      <span>movable pairwise total</span><span class="value">${formatMetric(initial.pairwise.movableTotalPenetration)}</span><span class="value proposal">${formatMetric(packed.pairwise.movableTotalPenetration)}</span>
      <span>movable pairwise max</span><span class="value">${formatMetric(initial.pairwise.movableMaximumPenetration)}</span><span class="value proposal">${formatMetric(packed.pairwise.movableMaximumPenetration)}</span>
      <span>fixed pairwise total</span><span class="value">${formatMetric(initial.pairwise.fixedTotalPenetration)}</span><span class="value proposal">${formatMetric(packed.pairwise.fixedTotalPenetration)}</span>
      <span>movable skeletal total</span><span class="value">${formatMetric(initial.skeletal.movableTotalPenetration)}</span><span class="value proposal">${formatMetric(packed.skeletal.movableTotalPenetration)}</span>
      <span>movable skeletal max</span><span class="value">${formatMetric(initial.skeletal.movableMaximumPenetration)}</span><span class="value proposal">${formatMetric(packed.skeletal.movableMaximumPenetration)}</span>
      <span>maximum local turn</span><span class="value">${formatMetric(Math.max(...initial.cages.map(row => row.centerline.maximumTurningAngle)))}</span><span class="value proposal">${formatMetric(Math.max(...packed.cages.map(row => row.centerline.maximumTurningAngle)))}</span>
      <span>maximum total turn</span><span class="value">${formatMetric(Math.max(...initial.cages.map(row => row.centerline.totalTurningAngle)))}</span><span class="value proposal">${formatMetric(Math.max(...packed.cages.map(row => row.centerline.totalTurningAngle)))}</span>
      <span>compartment escape</span><span class="value">${formatMetric(initial.compartment.maximumEscape)}</span><span class="value proposal">${formatMetric(packed.compartment.maximumEscape)}</span>
      <span>maximum volume error</span><span class="value">${formatMetric(Math.max(...initial.cages.map(row => row.relativeVolumeError)))}</span><span class="value proposal">${formatMetric(maxVolumeError)}</span>
      <span>fixed-node drift</span><span class="value">0.0000</span><span class="value proposal">${formatMetric(result.fixedNodeMaximumDrift)}</span>
      <span>pairwise contact rows</span><span class="value">—</span><span class="value proposal">${residualLedger.pairwise.contacts.length}</span>
      <span>skeletal contact rows</span><span class="value">—</span><span class="value proposal">${residualLedger.skeletal.contacts.length}</span>
      <span>termination</span><span class="value">—</span><span class="value proposal">${escapeHtml(result.termination?.reason || 'unrecorded')}</span>
    </div>
    <div class="legend">${legend}<span><i style="background:#f5f1e8"></i>fixed attachments</span><span><i style="background:#b9d8ef"></i>skeletal capsule</span><span><i style="background:#ff8a3d"></i>movable pairwise pressure</span><span><i style="background:#ffffff"></i>fixed pairwise pressure</span><span><i style="background:#48c7ff"></i>skeletal pressure</span></div>
    <p class="identity">bundle ${escapeHtml(bundleIdentity.sha256)}<br>source ${escapeHtml(bundleIdentity.sourceCarrierSha256)}<br>proposal ${escapeHtml(bundleIdentity.packedCarrierSha256)}<br>ledger ${escapeHtml(bundleIdentity.residualLedgerSha256)}<br>route requested ${escapeHtml(route.requested)}<br>route effective ${escapeHtml(route.effective)}</p>
  </section>
  <div class="hint">Drag to orbit · wheel to zoom · solid colored surfaces are the actual tetrahedral cage boundary, not a centerline tube reconstruction</div>
  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    const payload=${payload};
    const colors=[0xff6b6b,0xffd166,0x4ecdc4,0x8f7cff];
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
    function cageMesh(cage,color,opacity){
      const vertices=[];
      for(const face of cage.faces) for(const index of face) vertices.push(...cage.positions[index]);
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3)); geometry.computeVertexNormals();
      const material=new THREE.MeshPhysicalMaterial({color,roughness:.34,metalness:.02,clearcoat:.25,transparent:true,opacity,side:THREE.DoubleSide,depthWrite:true});
      return new THREE.Mesh(geometry,material);
    }
    function addCage(group,cage,index,opacity=1){
      const mesh=cageMesh(cage,colors[index],opacity); group.add(mesh);
      const edge=new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry,18),new THREE.LineBasicMaterial({color:colors[index],transparent:true,opacity:.2})); group.add(edge);
      group.add(line(cage.axisNodeIndices.map(nodeIndex=>cage.positions[nodeIndex]),0xffffff,.72));
      const fixedPositions=[];
      for(const nodeIndex of cage.fixedNodeIndices){
        const point=cage.positions[nodeIndex]; fixedPositions.push(point);
      }
      const unique=[];
      for(const point of fixedPositions) if(!unique.some(row=>new THREE.Vector3(...row).distanceTo(new THREE.Vector3(...point))<1e-6)) unique.push(point);
      for(const point of unique){
        const handle=new THREE.Mesh(new THREE.SphereGeometry(.055,16,12),new THREE.MeshStandardMaterial({color:0xf5f1e8,roughness:.35})); handle.position.set(...point); group.add(handle);
      }
    }
    function capsuleBetween(a,b,radius){
      const start=new THREE.Vector3(...a),end=new THREE.Vector3(...b),delta=end.clone().sub(start),span=delta.length();
      const mesh=new THREE.Mesh(new THREE.CapsuleGeometry(radius,Math.max(.001,span-radius*2),8,22),new THREE.MeshPhysicalMaterial({color:0xcdd6df,roughness:.42,transparent:true,opacity:.88}));
      mesh.position.copy(start).add(end).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()); return mesh;
    }
    const obstacle=payload.source.obstacles[0]; scene.add(capsuleBetween(obstacle.start,obstacle.end,obstacle.radius+(obstacle.clearance||0)));
    const compartment=payload.source.compartment,size=compartment.maximum.map((v,i)=>v-compartment.minimum[i]),center=compartment.maximum.map((v,i)=>(v+compartment.minimum[i])/2);
    const box=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)),new THREE.LineDashedMaterial({color:0x86a6c8,transparent:true,opacity:.2,dashSize:.08,gapSize:.05})); box.computeLineDistances(); box.position.set(...center); scene.add(box);
    const beforeGroup=new THREE.Group(),packedGroup=new THREE.Group(),ghostGroup=new THREE.Group(),contactGroup=new THREE.Group();
    payload.sourceCages.forEach((cage,index)=>addCage(beforeGroup,cage,index,.82));
    payload.packedCages.forEach((cage,index)=>addCage(packedGroup,cage,index,.82));
    payload.sourceCages.forEach((cage,index)=>ghostGroup.add(line(cage.axisNodeIndices.map(nodeIndex=>cage.positions[nodeIndex]),colors[index],.2)));
    const contacts=[...payload.residualLedger.pairwise.contacts,...payload.residualLedger.skeletal.contacts];
    const maximumContact=Math.max(1e-9,...contacts.map(contact=>contact.penetration));
    for(const contact of contacts){
      const target=contact.closestObstacleBoundaryPoint||contact.closestObstacleAxisPoint||contact.closestCageBoundaryPoint;
      const color=contact.kind==='pairwise-boundary-inside-cage'
        ? (contact.fixed?0xffffff:0xff8a3d)
        : 0x48c7ff;
      contactGroup.add(pressureLine([contact.point,target],color));
      const radius=.018+.065*Math.sqrt(contact.penetration/maximumContact);
      const marker=new THREE.Mesh(new THREE.SphereGeometry(radius,12,8),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.94,depthTest:false,depthWrite:false}));
      marker.position.set(...contact.point); marker.renderOrder=21; contactGroup.add(marker);
    }
    scene.add(beforeGroup,packedGroup,ghostGroup,contactGroup);
    const bounds=new THREE.Box3();
    for(const cage of [...payload.sourceCages,...payload.packedCages]) for(const point of cage.positions) bounds.expandByPoint(new THREE.Vector3(...point));
    bounds.expandByPoint(new THREE.Vector3(...obstacle.start)); bounds.expandByPoint(new THREE.Vector3(...obstacle.end));
    const framingCenter=bounds.getCenter(new THREE.Vector3()),framingSize=bounds.getSize(new THREE.Vector3()),framingRadius=Math.max(.25,framingSize.length()*.5);
    const framingDistance=framingRadius/Math.tan(THREE.MathUtils.degToRad(camera.fov*.5))*1.12;
    camera.near=Math.max(.001,framingRadius/500); camera.far=Math.max(100,framingRadius*30); camera.updateProjectionMatrix();
    const query=new URLSearchParams(location.search);
    const expectedIdentity=payload.bundleIdentity;
    const requestedIdentity={bundle:query.get('bundle'),source:query.get('source'),packed:query.get('packed'),ledger:query.get('ledger'),routeRequested:query.get('routeRequested'),routeEffective:query.get('routeEffective')};
    if(requestedIdentity.bundle!==expectedIdentity.sha256||requestedIdentity.source!==expectedIdentity.sourceCarrierSha256||requestedIdentity.packed!==expectedIdentity.packedCarrierSha256||requestedIdentity.ledger!==expectedIdentity.residualLedgerSha256||requestedIdentity.routeRequested!==payload.route.requested||requestedIdentity.routeEffective!==payload.route.effective){
      document.body.innerHTML='<pre style="margin:24px;color:#ff8b8b">identity-bound capture route mismatch\\n'+JSON.stringify({requested:requestedIdentity,effective:expectedIdentity},null,2)+'</pre>';
      throw new Error('identity-bound capture route mismatch');
    }
    const viewDirection=query.get('view')==='side'
      ? new THREE.Vector3(-1.2,.2,.08)
      : new THREE.Vector3(1.08,.72,1.12);
    camera.position.copy(framingCenter).add(viewDirection.normalize().multiplyScalar(framingDistance));
    controls.target.copy(framingCenter); controls.minDistance=framingRadius*.4; controls.maxDistance=framingRadius*10; controls.update();
    function showState(state){
      const packed=state==='packed'; beforeGroup.visible=!packed; packedGroup.visible=packed; ghostGroup.visible=packed; contactGroup.visible=packed;
      document.querySelectorAll('[data-state]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.state===state)));
      document.documentElement.dataset.witnessState=state;
    }
    document.querySelectorAll('[data-state]').forEach(button=>button.addEventListener('click',()=>showState(button.dataset.state)));
    function resize(){const width=Math.max(1,viewport.clientWidth),height=Math.max(1,viewport.clientHeight);renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();}
    new ResizeObserver(resize).observe(viewport); resize();
    const requested=query.get('state'); showState(requested==='before'?'before':'packed');
    renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera);});
    document.documentElement.dataset.witnessLoaded='true';
    document.documentElement.dataset.witnessRouteRequested=payload.route.requested;
    document.documentElement.dataset.witnessRouteEffective=payload.route.effective;
    document.documentElement.dataset.witnessBundle=expectedIdentity.sha256;
    document.documentElement.dataset.sourceCarrier=expectedIdentity.sourceCarrierSha256;
    document.documentElement.dataset.packedCarrier=expectedIdentity.packedCarrierSha256;
    document.documentElement.dataset.residualLedger=expectedIdentity.residualLedgerSha256;
  </script>
</body>
</html>`;
}
