import {Group, Mesh, SphereGeometry, MeshBasicMaterial, Float32BufferAttribute, Matrix3, Vector3} from '../lib/three.core.js';
import {validateLightingReport, makeDiffuseEvaluator} from '../lib/inferred-lighting.js';

export default {
  id:'inferred-lighting', title:'Inferred room light',
  async create({host, inputs, record}) {
    let report = null;
    if (inputs.reportUrl) {
      const response = await fetch(inputs.reportUrl);
      if (!response.ok) throw Error(`Lighting report: HTTP ${response.status}`);
      report = validateLightingReport(await response.json());
    }
    const session = await host.scene.open();
    const root = new Group(); root.name = 'Inferred room light';
    const probes = ['reference', 'estimated'].map((name, i) => {
      const geometry = new SphereGeometry(.65, 48, 32);
      geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(geometry.attributes.normal.count*3), 3));
      const mesh = new Mesh(geometry, new MeshBasicMaterial({vertexColors:true}));
      mesh.name = name === 'reference' ? 'Reference HDR' : 'Estimated light';
      mesh.position.set(i ? .85 : -.85, .75, 0); root.add(mesh);
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
    let exposure = 0, yaw = 0, panel = null;
    const normal = new Vector3(), matrix = new Matrix3();
    const read = () => ({objectId:asset.id, status:report ? 'estimated' : 'awaiting-report', exposure, yaw,
      checkpointSha256:report?.checkpointSha256 ?? null, effectiveDevice:report?.effectiveDevice ?? null,
      sourceRevision:report?.sourceRevision ?? null, environmentSha256:report?.environmentSha256 ?? null,
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
      panel.status.textContent = report ? `EMLight · ${report.effectiveDevice} · relative diffuse light` : 'No estimate loaded';
      panel.image.hidden = !report;
      if (report) panel.image.src = report.input.image;
      panel.exposure.value = String(exposure); panel.yaw.value = String(yaw);
    }
    function load(value) {
      const next = validateLightingReport(value);
      const evaluators = probes.map(p => makeDiffuseEvaluator(next.lights[p.name].sh));
      report = next; probes.forEach((p,i) => {p.evaluate = evaluators[i];});
      root.visible = true; update(true); sync();
      const effective = read(); record({kind:'inferred-lighting.load',phase:'applied',target:asset.id,effective});
      return effective;
    }
    if (report) load(report);
    const stop = session.onFrame(() => update());
    return {
      read,
      operations:{
        loadReport:load,
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
        frame() {return session.setView({position:[0, .75, 4.4],target:[0,.75,0]});},
      },
      mount({root:container,document,invoke}) {
        const status = document.createElement('p'); status.setAttribute('role','status');
        const image = document.createElement('img'); image.alt='Estimator camera input'; image.style.cssText='width:100%;aspect-ratio:4/3;object-fit:contain';
        const file = document.createElement('input'); file.type='file'; file.accept='.json,application/json'; file.setAttribute('aria-label','Lighting report');
        const failed = error => {status.textContent=error.message;};
        file.addEventListener('change', async () => {
          try {if(file.files[0]) await invoke('loadReport',JSON.parse(await file.files[0].text()));} catch(error) {failed(error);}
        });
        container.append(status,image,file);
        const field = (title,operation,step) => {
          const label=document.createElement('label'), grip=document.createElement('span'), input=document.createElement('input');
          grip.textContent=title; input.type='number'; input.step=String(step); input.className='transform-input'; input.setAttribute('aria-label',title);
          input.addEventListener('change',()=>{if(input.value.trim()) invoke(operation,Number(input.value)).catch(failed);});
          label.append(grip,input); container.append(label); host.controls.installNumberDrag({input,grip,step}); return input;
        };
        panel={status,image,exposure:field('Exposure (EV)','setExposure',.1),yaw:field('Light yaw (degrees)','setYaw',1)};
        const labels=document.createElement('p'); labels.textContent='Reference HDR / Estimated light'; container.append(labels);
        const frame=document.createElement('button');frame.type='button';frame.textContent='Frame comparison';
        frame.addEventListener('click',()=>invoke('frame').catch(failed));container.append(frame);sync();
      },
      dispose() {stop();return session.dispose();},
    };
  },
};
