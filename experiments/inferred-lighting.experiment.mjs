import {Group, Mesh, SphereGeometry, MeshBasicMaterial, Float32BufferAttribute, Matrix3, Vector3} from '../lib/three.core.js';
import {validateLightingReport, validateLightingSuite, makeDiffuseEvaluator} from '../lib/inferred-lighting.js';
import {loadLightingSurface} from '../lib/inferred-lighting-surface.js';

export default {
  id:'inferred-lighting', title:'Inferred environment light',
  async create({host, inputs, record}) {
    let report = null, suite = null, caseId = null, caseRequest = 0, surfaceRequest = 0, disposed = false;
    const fetchJson = async url => {
      const response = await fetch(url);
      if (!response.ok) throw Error(`Lighting report: HTTP ${response.status}`);
      return response.json();
    };
    let suiteUrl;
    if (inputs.suiteUrl) {
      suiteUrl = new URL(inputs.suiteUrl, globalThis.location?.href);
      suite = validateLightingSuite(await fetchJson(suiteUrl));
    }
    if (inputs.reportUrl) {
      report = validateLightingReport(await fetchJson(inputs.reportUrl));
    }
    const session = await host.scene.open();
    const root = new Group(); root.name = 'Inferred environment light';
    const probes = ['neutral', 'reference', 'estimated'].map((name, i) => {
      const geometry = new SphereGeometry(.65, 48, 32);
      geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(geometry.attributes.normal.count*3), 3));
      const mesh = new Mesh(geometry, new MeshBasicMaterial({vertexColors:true}));
      mesh.name = {neutral:'Uniform neutral',reference:'Reference HDR',estimated:'Estimated light'}[name];
      mesh.position.set((i-1)*1.7, .75, 0); root.add(mesh);
      return {name, mesh, evaluate:null, matrix:null};
    });
    root.visible = false;
    let asset;
    try {
      asset = await session.attach(root, {owned:true,metadata:{label:root.name,source:'experiment:inferred-lighting',type:'experiment'}});
    } catch (error) {
      probes.forEach(p => {p.mesh.geometry.dispose(); p.mesh.material.dispose();});
      await session.dispose(); throw error;
    }
    let exposure = 0, yaw = 0, panel = null, surface = 'probes', surfaceIdentity = null, albedo = null;
    const normal = new Vector3(), matrix = new Matrix3();
    const read = () => ({objectId:asset.id, status:report ? 'estimated' : 'awaiting-report', exposure, yaw,
      estimator:report ? (report.estimator ?? 'EMLight') : null,
      checkpointSha256:report?.checkpointSha256 ?? null, effectiveDevice:report?.effectiveDevice ?? null,
      sourceRevision:report?.sourceRevision ?? null, environmentSha256:report?.environmentSha256 ?? null,
      caseId,cases:suite?.cases.map(({id,label})=>({id,label})) ?? [],surface,surfaceIdentity,metrics:report?.metrics ?? null,
      comparison:'degree-2 diffuse SH; independent mean-luminance normalization', view:session.readView()});
    function update(force = false) {
      if (!report) return;
      root.updateMatrixWorld(true);
      let changed = false;
      for (const probe of probes) {
        const {mesh} = probe, elements = mesh.matrixWorld.elements;
        if (!force && probe.matrix?.every((v,i) => v === elements[i])) continue;
        matrix.getNormalMatrix(mesh.matrixWorld);
        const {normal:normals, color:colors} = mesh.geometry.attributes;
        for (let i=0; i<normals.count; i++) {
          normal.fromBufferAttribute(normals, i).applyMatrix3(matrix).normalize();
          colors.setXYZ(i, ...probe.evaluate(normal.toArray(), exposure, yaw*Math.PI/180));
        }
        colors.needsUpdate = true; probe.matrix = [...elements]; changed = true;
      }
      if (changed) session.redraw();
    }
    function sync() {
      if (!panel) return;
      panel.status.textContent = report ? `${report.estimator ?? 'EMLight'} · ${report.effectiveDevice} · ${surface === 'probes' ? 'relative diffuse light' : 'MoGe + SuperMAT albedo · diffuse only'}` : 'No estimate loaded';
      panel.image.hidden = !report;
      if (report) panel.image.src = report.input.image;
      if (panel.cases) panel.cases.value = caseId ?? '';
      panel.surface.value = surface;
      panel.reference.hidden = !report; panel.estimated.hidden = !report;
      if (report?.lights.reference.preview) panel.reference.src = report.lights.reference.preview;
      if (report?.lights.estimated.preview) panel.estimated.src = report.lights.estimated.preview;
      panel.metrics.textContent = report?.metrics ? `Diffuse error: estimate ${report.metrics.estimatedRmse.toFixed(3)} / neutral ${report.metrics.neutralRmse.toFixed(3)}` : '';
      panel.exposure.value = String(exposure); panel.yaw.value = String(yaw);
    }
    function load(value) {
      const next = validateLightingReport(value);
      const uniform = [[...Array(3).fill(Math.sqrt(4*Math.PI))], ...Array.from({length:8},()=>[0,0,0])];
      const evaluators = probes.map(p => makeDiffuseEvaluator(p.name === 'neutral' ? uniform : next.lights[p.name].sh, surface === 'probes' ? .5 : 1));
      report = next; probes.forEach((p,i) => {p.evaluate = evaluators[i];});
      root.visible = true; update(true); sync();
      const effective = read(); record({kind:'inferred-lighting.load',phase:'applied',target:asset.id,effective});
      return effective;
    }
    async function selectCase(id) {
      const entry = suite?.cases.find(c => c.id === id);
      if (!entry) throw Error('Unknown lighting case');
      const request = ++caseRequest;
      const next = validateLightingReport(await fetchJson(new URL(entry.reportUrl,suiteUrl)));
      if (next.environmentSha256 !== entry.environmentSha256) throw Error('Lighting case source hash mismatch');
      if (disposed || request !== caseRequest) return read();
      caseId = id; exposure = 0; yaw = 0; return load(next);
    }
    async function setSurface(name) {
      if (!['probes','bag','orb'].includes(name)) throw Error('Unknown material surface');
      const request = ++surfaceRequest;
      const next = name === 'probes' ? {geometry:new SphereGeometry(.65,48,32),albedo:null,provenance:null} : await loadLightingSurface(name);
      if (disposed || request !== surfaceRequest) {next.geometry.dispose();next.albedo?.dispose();return read();}
      if (!next.geometry.attributes.color) next.geometry.setAttribute('color',new Float32BufferAttribute(new Float32Array(next.geometry.attributes.normal.count*3),3));
      const geometries = probes.map(()=>next.geometry.clone()); next.geometry.dispose();
      const previousAlbedo = albedo; albedo = next.albedo;
      for (const [i,p] of probes.entries()) {
        p.mesh.geometry.dispose(); p.mesh.geometry = geometries[i];
        p.mesh.material.map = albedo; p.mesh.material.needsUpdate = true;
        p.mesh.scale.setScalar(name === 'probes' ? 1 : 1.55); p.matrix = null;
      }
      previousAlbedo?.dispose(); surface = name; surfaceIdentity = next.provenance;
      if (report) load(report); else sync();
      record({kind:'inferred-lighting.surface',phase:'applied',effective:read()}); return read();
    }
    const frame = () => session.setView({position:[0, .75, 9],target:[0,.75,0]});
    if (report) {load(report); frame();}
    try {
      if (suite) {await selectCase(inputs.caseId ?? suite.cases[0].id); frame();}
      if (inputs.surface) await setSurface(inputs.surface);
    } catch (error) {albedo?.dispose(); await session.dispose(); throw error;}
    const stop = session.onFrame(() => update());
    return {
      read,
      operations:{
        loadReport(value) {
          validateLightingReport(value); caseRequest++; caseId = null; return load(value);
        },
        selectCase,setSurface,
        setExposure(value) {
          if (!Number.isFinite(value)) throw Error('Exposure must be finite');
          exposure=value; update(true); sync();
          record({kind:'inferred-lighting.exposure',phase:'applied',effective:read()}); return read();
        },
        setYaw(value) {
          if (!Number.isFinite(value)) throw Error('Yaw must be finite');
          yaw=value; update(true); sync();
          record({kind:'inferred-lighting.yaw',phase:'applied',effective:read()}); return read();
        },
        frame,
      },
      mount({root:container,document,invoke}) {
        const status = document.createElement('p'); status.setAttribute('role','status');
        const image = document.createElement('img'); image.alt='Estimator camera input'; image.style.cssText='width:100%;aspect-ratio:4/3;object-fit:contain';
        const file = document.createElement('input'); file.type='file'; file.accept='.json,application/json'; file.setAttribute('aria-label','Lighting report');
        const failed = error => {status.textContent=error.message;};
        file.addEventListener('change', async () => {
          try {if(file.files[0]) await invoke('loadReport',JSON.parse(await file.files[0].text()));} catch(error) {failed(error);}
        });
        const select = (title,options,operation) => {
          const label=document.createElement('label'),text=document.createElement('span'),input=document.createElement('select');
          text.textContent=title; input.setAttribute('aria-label',title); input.style.cssText='width:100%;margin-bottom:8px';
          for (const [value,name] of options) {const option=document.createElement('option');option.value=value;option.textContent=name;input.append(option);}
          input.addEventListener('change',async()=>{input.disabled=true;try{await invoke(operation,input.value);}catch(error){sync();failed(error);}finally{input.disabled=false;}});
          label.append(text,input);container.append(label);return input;
        };
        const cases = suite ? select('Environment',suite.cases.map(c=>[c.id,c.label]),'selectCase') : null;
        const surfaceSelect = select('Object',[['probes','Neutral spheres'],['bag','Backpack · MoGe + SuperMAT'],['orb','Orb · MoGe + SuperMAT']],'setSurface');
        container.append(status,image);
        const field = (title,operation,step) => {
          const label=document.createElement('label'), grip=document.createElement('span'), input=document.createElement('input');
          grip.textContent=title; input.type='number'; input.step=String(step); input.className='transform-input'; input.setAttribute('aria-label',title);
          input.addEventListener('change',()=>{if(input.value.trim()) invoke(operation,Number(input.value)).catch(failed);});
          label.append(grip,input); container.append(label); host.controls.installNumberDrag({input,grip,step}); return input;
        };
        const reference=document.createElement('img'),estimated=document.createElement('img'),metrics=document.createElement('p');
        const maps=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Environment maps';maps.append(summary);
        for (const [preview,title] of [[reference,'Reference HDR panorama'],[estimated,'Estimated environment']]) {
          preview.alt=title;preview.style.cssText='width:100%;aspect-ratio:2/1;object-fit:contain';
          const caption=document.createElement('p');caption.textContent=title;maps.append(caption,preview);
        }
        metrics.style.fontSize='12px';container.append(metrics);
        panel={status,image,cases,surface:surfaceSelect,reference,estimated,metrics,exposure:field('Exposure (EV)','setExposure',.1),yaw:field('Light yaw (degrees)','setYaw',1)};
        const labels=document.createElement('p'); labels.textContent='Uniform neutral / Reference HDR / Estimated light'; container.append(labels);
        const frame=document.createElement('button');frame.type='button';frame.textContent='Frame comparison';
        frame.addEventListener('click',()=>invoke('frame').catch(failed));container.append(frame,maps,file);sync();
      },
      dispose() {disposed=true;caseRequest++;surfaceRequest++;stop();albedo?.dispose();return session.dispose();},
    };
  },
};
