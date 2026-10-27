import {validateShadowSampling,validateShadowComparison} from '../fire-shadow-sampling.mjs';
import {validateSourceQuadrature} from '../fire-source-quadrature.mjs';
import {DEFAULT_SHADOW_QUALITY,validateShadowQuality} from '../fire-shadow-quality.mjs';
import {installRenderingNumberControl} from '../rendering-number-controls.mjs';

export default {
  id:'fire-shadow-sampling',title:'Fire shadow sampling',
  async create({host,inputs,record,updateInputs=()=>{}}) {
    return createFireShadowSettings({session:await host.scene.open(),document:host.controls.document,inputs,record,updateInputs,diagnostics:true});
  },
};

// The ordinary Scene Rendering inspector and the experiment share operations,
// validation and controls. Only the experiment supplies owner-input persistence.
export function createFireShadowSettings({session,document,inputs={},record=()=>{},updateInputs=()=>{},applyInitial=true,installNumberDrag,diagnostics=false}) {
    const win=document.defaultView;
    let requested=validateShadowSampling(inputs.sampling??'complementary');
    let selector,pointSelector,status,implementationSelector,grainSelector,cellInput,cellRow,retry,casterSelector,casterStatus,surfaceSwitch,smokeFilterSwitch,edgeSwitch;
    let requestedComparison=inputs.shadowComparison===undefined?null:validateShadowComparison(inputs.shadowComparison);
    let requestedQuality=inputs.shadowQuality===undefined?null:validateShadowQuality(inputs.shadowQuality);
    const qualityControls=[],lightControls=[],mediumControls=[],numberScrubs=[];
    let requestedPoints=inputs.points??null;
    let requestedPointSampling=inputs.pointSampling??'all';
    validateSourceQuadrature(requestedPoints??1,requestedPointSampling);
    const persist=()=>updateInputs({...inputs,sampling:requested,...(requestedPoints===null?{}:{points:requestedPoints,pointSampling:requestedPointSampling}),...(requestedQuality===null?{}:{shadowQuality:requestedQuality}),...(requestedComparison===null?{}:{shadowComparison:requestedComparison})});
    const source=()=>{const value=win.__kaminosSceneRadiance;if(!value?.setShadowSampling)throw Error('This scene has no hybrid fire shadow consumer');return value;};
    const read=()=>{const state=win.__kaminosSceneRadiance?.debugState();return {requested,status:state?.status,error:state?.error,available:!!state?.shadowSampling,effective:state?.shadowSampling??null,softness:state?.shadowSoftness??null,points:state?.pointCount??null,pointSampling:state?.pointSampling??null,evaluatedPoints:state?.evaluatedPointCount??null,capturedPoints:state?.capturedPointCount??null,shadowComparison:state?.shadowImplementation===undefined?null:{implementation:state.shadowImplementation,grain:state.shadowGrain,worldCellSize:state.shadowWorldCellSize},shadowQuality:state?.shadowResolution===undefined?null:{resolution:state.shadowResolution,blockerSamples:state.blockerSamples,filterSamples:state.filterSamples},maxShadowResolution:state?.maxShadowResolution??null,shadows:state?.shadows??[],bounceGain:win.kaminosSceneGIDebugState?.().gain??null};};
    const shown=new WeakMap();
    const sync=(force=false)=>{
      const value=(control,next)=>{if(control&&(force||shown.get(control)!==String(next))){control.value=String(next);shown.set(control,String(next));}};
      const state=read();
      const medium=win.__kaminosSceneRadiance?.debugState();
      for(const {key,number} of lightControls)value(number,medium?.[key]??16);
      if(edgeSwitch)edgeSwitch.checked=medium?.shadowEdgeFilter===true;
      if(smokeFilterSwitch)smokeFilterSwitch.checked=medium?.smokeShadowFilter===true;
      for(const {key,number} of mediumControls)value(number,medium?.[key]??(key==='smokeShadowSteps'?0:16));
      if(surfaceSwitch)surfaceSwitch.checked=win.__kaminosSceneRadiance?.debugState().surfaceEnabled!==false;
      const comparison=state.shadowComparison??requestedComparison??validateShadowComparison();
      value(implementationSelector,comparison.implementation);
      value(grainSelector,comparison.grain);
      if(grainSelector&&!diagnostics)for(const option of grainSelector.children)option.hidden=option.value==='ordered'&&comparison.grain!=='ordered';
      if(cellInput){value(cellInput,comparison.worldCellSize);cellRow.hidden=comparison.grain!=='world';}
      value(selector,state.effective??requested);
      const caster=win.__kaminosSceneRadiance?.debugState().casters;
      value(casterSelector,caster?.level??'original');
      if(casterStatus)casterStatus.textContent=caster?.error?`Caster load failed: ${caster.error}; using ${caster.level}.`:caster?.level!=='original'&&caster?`${caster.targets} mapped kiln(s): ${caster.originalTriangles.toLocaleString()} → ${caster.captureTriangles.toLocaleString()} caster triangles. Visible geometry and smoke visibility unchanged. Error unmeasured.`:'Original scene geometry. Reduced choices apply only to the mapped kiln, not other objects.';
      value(pointSelector,state.pointSampling==='paired'?'4-paired':String(state.points??requestedPoints??1));
      for(const {key,number} of qualityControls){
        value(number,state.shadowQuality?.[key]??requestedQuality?.[key]??DEFAULT_SHADOW_QUALITY[key]);
        if(key==='resolution'&&state.maxShadowResolution)number.max=String(state.maxShadowResolution);
      }
      const quality=state.shadowQuality;
      if(status)status.textContent=state.available?`Configured: ${state.effective} · ${state.shadowComparison?`${comparison.implementation} / ${comparison.grain} grain`:'comparison unavailable'} · ${state.points} sources, ${state.evaluatedPoints??'?'} evaluated per pixel · ${state.capturedPoints??'?'} current-frame cubes · ${quality?.resolution??'?'} px/face · ${quality?.blockerSamples??'?'} blocker + up to ${quality?.filterSamples??'?'} filter taps/source · softness ${state.softness}`:'Awaiting hybrid lighting; load an authored hybrid fire scene.';
      if(status&&!diagnostics&&state.available)status.textContent=`${state.evaluatedPoints??'?'} of ${state.points} sources per pixel · ${quality?.resolution??'?'} px/face · ${quality?.blockerSamples??'?'} blocker + ${quality?.filterSamples??'?'} shadow samples${state.effective!=='complementary'||comparison.implementation!=='shared'?` · Saved diagnostic mode: ${state.effective} / ${comparison.implementation}`:''}`;
      if(status&&state.status==='compiling-lighting')status.textContent='Compiling lighting asynchronously; holding the last image. Additional changes are queued.';
      if(status&&state.status==='lighting-compile-failed')status.textContent=`Lighting compilation failed: ${state.error}. Retry compilation below.`;
      if(status&&win.__kaminosSceneRadiance?.debugState().surfaceEnabled===false)status.textContent='Fire surface lighting off: no point reduction, shadow captures or direct surface-light contribution. Visible flame and distributed smoke lighting unchanged.';
      if(retry)retry.hidden=state.status!=='lighting-compile-failed';
    };
    const apply=(points,mode)=>{
      validateSourceQuadrature(points,mode);
      if(source().setQuadrature)source().setQuadrature(points,mode);
      else if(mode==='all'&&[1,2].includes(points))source().setPointCount(points);
      else throw Error('This runtime has no four-source quadrature consumer');
    };
    const setQuadrature=({points,pointSampling='all'})=>{apply(points,pointSampling);requestedPoints=points;requestedPointSampling=pointSampling;persist();sync();session.redraw();const effective=read();record({kind:'fire-shadow.quadrature',phase:'applied',requested:{points,pointSampling},effective});return effective;};
    const applyQuality=value=>{
      validateShadowQuality(value,{maxTextureDimension2D:read().maxShadowResolution??Infinity});
      if(!source().setShadowQuality)throw Error('This runtime has no shadow quality consumer');
      source().setShadowQuality(value);
    };
    const setShadowQuality=value=>{
      applyQuality(value);requestedQuality={...read().shadowQuality};persist();sync();session.redraw();
      const effective=read();record({kind:'fire-shadow.quality',phase:'applied',requested:value,effective});return effective;
    };
    const applyComparison=value=>{if(!source().setShadowComparison)throw Error('This runtime has no shadow comparison consumer');source().setShadowComparison(value);};
    const setShadowComparison=value=>{
      const next=validateShadowComparison({...requestedComparison,...read().shadowComparison,...value});
      applyComparison(next);requestedComparison=next;persist();sync();session.redraw();
      const effective=read();record({kind:'fire-shadow.comparison',phase:'applied',requested:next,effective});return effective;
    };
    const stop=applyInitial?session.onFrame(()=>{if(win.__kaminosSceneRadiance?.setShadowSampling){source().setShadowSampling(requested);if(requestedPoints!==null)apply(requestedPoints,requestedPointSampling);if(requestedQuality!==null)applyQuality(requestedQuality);if(requestedComparison!==null)applyComparison(requestedComparison);sync();stop();}}):()=>{};
    return {
      read,sync,
      operations:{
        setLightGrid(value){source().setLightGrid(value);sync();session.redraw();record({kind:'fire-shadow.light-grid',effective:value});return read();},
        setShadowEdgeFilter(value){source().setShadowEdgeFilter(value);sync();session.redraw();record({kind:'fire-shadow.edge-filter',effective:value});return read();},
        setSurfaceEnabled(value){source().setSurfaceEnabled(value);sync();session.redraw();record({kind:'fire-shadow.surface-enabled',effective:value});return read();},
        setSmokeShadowQuality(value){source().setSmokeShadowQuality(value);sync();session.redraw();record({kind:'fire-shadow.smoke-quality',requested:value,effective:source().debugState().frame?.smokeShadow??null});return source().debugState();},
        async setCasterLevel(value){await source().setShadowCasterLevel(value);sync();session.redraw();const effective=source().debugState().casters;record({kind:'fire-shadow.caster-level',requested:value,effective});return effective;},
        async retryCompile(){await source().retryRebuild();sync();session.redraw();return read();},
        setShadowComparison,setShadowQuality,restoreShadowQuality(){return setShadowQuality(DEFAULT_SHADOW_QUALITY);},
        setQuadrature,setPoints(value){return setQuadrature({points:value});},
        setSampling(value){validateShadowSampling(value);source().setShadowSampling(value);requested=value;persist();sync();session.redraw();const effective=read();record({kind:'fire-shadow.sampling',phase:'applied',requested:value,effective});return effective;},
        setSoftness(value){if(!Number.isFinite(value)||value<0)throw Error('finite nonnegative softness required');source().setShadowSoftness(value);sync();session.redraw();return read();},
        setBounceGain(value){if(!Number.isFinite(value)||value<0)throw Error('finite nonnegative bounce gain required');const control=document.getElementById('scene-gi-gain');if(!control)throw Error('scene GI control unavailable');control.value=String(value);control.dispatchEvent(new win.Event('change'));session.redraw();return read();},
      },
      mount({root:panel,document,invoke}){
        const failed=error=>{sync(true);status.textContent=error.message;};
        const native=document.getElementById('rendering-fire-shadows');
        if(applyInitial&&native){
          const jump=document.createElement('button');jump.type='button';jump.textContent='Fire lighting controls → Scene · Rendering';
          jump.addEventListener('click',()=>{document.querySelector('[data-inspector-context="scene"]')?.click();const rendering=document.getElementById('authoring-render-slot');if(rendering)rendering.open=true;native.open=true;native.scrollIntoView({block:'center'});});
          panel.append(jump);return;
        }
        const label=document.createElement('label');label.textContent='Shadow sampling ';
        selector=document.createElement('select');selector.setAttribute('aria-label','Fire shadow sampling');
        for(const [value,text]of [['fixed','Repeated sample pattern'],['complementary','Complementary neighboring pixels']]){const option=document.createElement('option');option.value=value;option.textContent=text;selector.append(option);}
        status=document.createElement('div');status.setAttribute('role','status');
        selector.addEventListener('change',()=>invoke('setSampling',selector.value).catch(failed));
        const surfaceLabel=document.createElement('label');surfaceLabel.textContent='Fire surface lighting';
        surfaceSwitch=document.createElement('input');surfaceSwitch.type='checkbox';surfaceSwitch.setAttribute('aria-label','Fire surface lighting');surfaceSwitch.addEventListener('change',()=>invoke('setSurfaceEnabled',surfaceSwitch.checked).catch(failed));surfaceLabel.append(surfaceSwitch);panel.append(surfaceLabel);
        const pointLabel=document.createElement('label');pointLabel.textContent='Flame lighting sources ';
        pointSelector=document.createElement('select');pointSelector.setAttribute('aria-label','Flame lighting sources');
        for(const [value,text]of [[1,'One source — whole flame'],[2,'Two sources — evaluate both'],[4,'Four sources — evaluate all'],[6,'Six sources — evaluate all'],[8,'Eight sources — evaluate all'],['4-paired','Four sources — evaluate complementary pairs']]){const option=document.createElement('option');option.value=String(value);option.textContent=text;pointSelector.append(option);}
        pointSelector.addEventListener('change',()=>invoke('setQuadrature',{points:pointSelector.value==='4-paired'?4:Number(pointSelector.value),pointSampling:pointSelector.value==='4-paired'?'paired':'all'}).catch(failed));
        pointLabel.append(pointSelector);label.append(selector);panel.append(pointLabel);if(diagnostics)panel.append(label);
        const comparisonControl=(text,choices,key)=>{
          const row=document.createElement('label');row.textContent=text;
          const select=document.createElement('select');select.setAttribute('aria-label',text);
          for(const [value,title] of choices){const option=document.createElement('option');option.value=value;option.textContent=title;select.append(option);}
          select.addEventListener('change',()=>invoke('setShadowComparison',{[key]:select.value}).catch(failed));
          row.append(select);panel.append(row);return select;
        };
        if(diagnostics)implementationSelector=comparisonControl('Capture implementation',[['shared','Shared preparation + uniform offsets'],['legacy','Before optimization — per-source preparation + arithmetic']],'implementation');
        grainSelector=comparisonControl('Shadow grain placement',[['ordered','Ordered screen pattern — baseline'],['screen','Scrambled screen grain — stable'],['screen-animated','Scrambled screen grain — animated'],['world','Scrambled world-space grain']],'grain');
        cellRow=document.createElement('label');cellRow.textContent='World grain cell size';
        cellInput=document.createElement('input');cellInput.type='number';cellInput.min='0.000001';cellInput.step='any';cellInput.setAttribute('aria-label','World grain cell size');
        cellInput.addEventListener('change',()=>invoke('setShadowComparison',{worldCellSize:Number(cellInput.value)}).catch(failed));
        cellRow.append(cellInput);panel.append(cellRow);numberScrubs.push(installRenderingNumberControl(cellInput,installNumberDrag));
        const grainHelp=document.createElement('details'),grainSummary=document.createElement('summary'),grainText=document.createElement('p');
        grainSummary.textContent='About grain and A/B';
        grainText.textContent='Independent comparisons; shader changes may pause briefly. Grain scrambles complementary filter phases and source pairs, with no temporal history. Animated screen grain changes every rendered frame, including with a frozen flame. Stable screen grain stays on pixels; world grain stays in world-space cells. This is sampling noise, not simulated photographic film or a denoiser. Use complementary sampling to compare filter grain.';
        grainHelp.append(grainSummary,grainText);if(diagnostics)panel.append(grainHelp);
        const casterLabel=document.createElement('label');casterLabel.textContent='Kiln shadow caster';
        casterSelector=document.createElement('select');casterSelector.setAttribute('aria-label','Kiln shadow caster');
        for(const [value,text]of [['original','Original geometry'],['10k','10k triangles — reduced caster'],['5k','5k triangles — reduced caster']]){const option=document.createElement('option');option.value=value;option.textContent=text;casterSelector.append(option);}
        casterSelector.addEventListener('change',()=>invoke('setCasterLevel',casterSelector.value).catch(failed));
        casterStatus=document.createElement('div');casterStatus.setAttribute('aria-live','polite');casterLabel.append(casterSelector);panel.append(casterLabel,casterStatus);
        const gridRow=document.createElement('label');gridRow.textContent='Smoke light receiver resolution';
        gridRow.title='Independent lighting samples across the domain width. Material and flow resolution stay independent. Height follows the domain aspect.';
        const gridInput=document.createElement('input');gridInput.type='number';gridInput.min='1';gridInput.step='1';gridInput.setAttribute('aria-label','Smoke light receiver resolution');
        gridInput.addEventListener('change',()=>invoke('setLightGrid',Number(gridInput.value)).catch(failed));gridRow.append(gridInput);panel.append(gridRow);lightControls.push({key:'volumeGrid',number:gridInput});numberScrubs.push(installRenderingNumberControl(gridInput,installNumberDrag));
        const edgeLabel=document.createElement('label');edgeLabel.textContent='Smooth solid shadow texels';
        edgeLabel.title='Compare neighboring cubemap texels for narrow edges and blocker-free visibility. Broad detected penumbras keep the ordinary filter taps.';
        edgeSwitch=document.createElement('input');edgeSwitch.type='checkbox';edgeSwitch.setAttribute('aria-label','Smooth solid shadow texels');
        edgeSwitch.addEventListener('change',()=>invoke('setShadowEdgeFilter',edgeSwitch.checked).catch(failed));edgeLabel.append(edgeSwitch);panel.append(edgeLabel);
        const heading=document.createElement('h3');heading.textContent='Shadow quality';panel.append(heading);
        for(const [key,text,help] of [
          ['resolution','Shadow cube resolution','Pixels per cube face. Lower values reduce capture size and shadow detail.'],
          ['blockerSamples','Blocker-search samples','Depth reads used to estimate blocker distance and penumbra width.'],
          ['filterSamples','Soft-shadow samples','Depth reads used to smooth visibility when blockers are found.'],
        ]){
          const row=document.createElement('label');row.textContent=text;row.title=help;
          const number=document.createElement('input');
          number.type='number';number.min='1';number.step='1';number.setAttribute('aria-label',text+' value');
          const change=value=>invoke('setShadowQuality',{[key]:Number(value)}).catch(failed);
          // Rebuild only on release/commit, not every intermediate drag pixel.
          number.addEventListener('change',()=>change(number.value));
          qualityControls.push({key,number});row.append(number);panel.append(row);numberScrubs.push(installRenderingNumberControl(number,installNumberDrag));
        }
        for(const [key,param,text,min] of [['smokeShadowSteps','steps','Smoke shadow steps',0],['smokeShadowResolution','resolution','Smoke shadow angular resolution',1]]){
          const row=document.createElement('label');row.textContent=text;
          row.title=key==='smokeShadowSteps'?'Zero disables smoke attenuation. Positive values integrate the existing medium into light-space optical-depth prefixes.':'Pixels per face in the smoke optical-depth atlas; independent of solid shadow resolution.';
          const number=document.createElement('input');number.type='number';number.min=String(min);number.step='1';number.setAttribute('aria-label',text);
          number.addEventListener('change',()=>invoke('setSmokeShadowQuality',{[param]:Number(number.value)}).catch(failed));
          mediumControls.push({key,number});row.append(number);panel.append(row);numberScrubs.push(installRenderingNumberControl(number,installNumberDrag));
        }
        const restore=document.createElement('button');restore.type='button';restore.textContent='Restore 256 / 9 / 16';
        const smokeFilterLabel=document.createElement('label');smokeFilterLabel.textContent='Smooth smoke shadow directions';
        smokeFilterLabel.title='Experimental 3×3 neighboring-direction transmission filter. Softens angular smoke-shadow detail without extra raymarch steps or temporal history. Off restores the unfiltered map.';
        smokeFilterSwitch=document.createElement('input');smokeFilterSwitch.type='checkbox';smokeFilterSwitch.setAttribute('aria-label','Smooth smoke shadow directions');
        smokeFilterSwitch.addEventListener('change',()=>invoke('setSmokeShadowQuality',{filter:smokeFilterSwitch.checked}).catch(failed));
        smokeFilterLabel.append(smokeFilterSwitch);panel.append(smokeFilterLabel);
        restore.addEventListener('click',()=>invoke('restoreShadowQuality').catch(failed));
        const help=document.createElement('p');help.textContent='Applies on release. GPU pipelines compile asynchronously while the last image is held; JavaScript shader graph preparation still runs cooperatively on the main thread. All source cubes update each rendered frame. The viewport and flame resolution are unchanged.';
        retry=document.createElement('button');retry.type='button';retry.textContent='Retry lighting compilation';
        retry.addEventListener('click',()=>invoke('retryCompile').catch(failed));
        if(diagnostics)panel.append(restore,help);
        panel.append(retry,status);sync();
      },
      async dispose(){stop();for(const scrub of numberScrubs.splice(0))scrub?.dispose?.();await session.dispose();},
    };
}
