import {validateShadowSampling,validateShadowComparison} from '../fire-shadow-sampling.mjs';
import {validateSourceQuadrature} from '../fire-source-quadrature.mjs';
import {DEFAULT_SHADOW_QUALITY,validateShadowQuality} from '../fire-shadow-quality.mjs';

export default {
  id:'fire-shadow-sampling',title:'Fire shadow sampling',
  async create({host,inputs,record,updateInputs=()=>{}}) {
    const session=await host.scene.open(),document=host.controls.document,win=document.defaultView;
    let requested=validateShadowSampling(inputs.sampling??'complementary');
    let selector,pointSelector,status,implementationSelector,grainSelector,cellInput;
    let requestedComparison=inputs.shadowComparison===undefined?null:validateShadowComparison(inputs.shadowComparison);
    let requestedQuality=inputs.shadowQuality===undefined?null:validateShadowQuality(inputs.shadowQuality);
    const qualityControls=[];
    let requestedPoints=inputs.points??null;
    let requestedPointSampling=inputs.pointSampling??'all';
    validateSourceQuadrature(requestedPoints??1,requestedPointSampling);
    const persist=()=>updateInputs({...inputs,sampling:requested,...(requestedPoints===null?{}:{points:requestedPoints,pointSampling:requestedPointSampling}),...(requestedQuality===null?{}:{shadowQuality:requestedQuality}),...(requestedComparison===null?{}:{shadowComparison:requestedComparison})});
    const source=()=>{const value=win.__kaminosSceneRadiance;if(!value?.setShadowSampling)throw Error('This scene has no hybrid fire shadow consumer');return value;};
    const read=()=>{const state=win.__kaminosSceneRadiance?.debugState();return {requested,available:!!state?.shadowSampling,effective:state?.shadowSampling??null,softness:state?.shadowSoftness??null,points:state?.pointCount??null,pointSampling:state?.pointSampling??null,evaluatedPoints:state?.evaluatedPointCount??null,capturedPoints:state?.capturedPointCount??null,shadowComparison:state?.shadowImplementation===undefined?null:{implementation:state.shadowImplementation,grain:state.shadowGrain,worldCellSize:state.shadowWorldCellSize},shadowQuality:state?.shadowResolution===undefined?null:{resolution:state.shadowResolution,blockerSamples:state.blockerSamples,filterSamples:state.filterSamples},maxShadowResolution:state?.maxShadowResolution??null,shadows:state?.shadows??[],bounceGain:win.kaminosSceneGIDebugState?.().gain??null};};
    const sync=()=>{
      const state=read();
      const comparison=state.shadowComparison??requestedComparison??validateShadowComparison();
      if(implementationSelector)implementationSelector.value=comparison.implementation;
      if(grainSelector)grainSelector.value=comparison.grain;
      if(cellInput){cellInput.value=String(comparison.worldCellSize);cellInput.disabled=comparison.grain!=='world';}
      if(selector)selector.value=state.effective??requested;
      if(pointSelector)pointSelector.value=state.pointSampling==='paired'?'4-paired':String(state.points??requestedPoints??1);
      for(const {key,slider,number} of qualityControls){
        const value=state.shadowQuality?.[key]??requestedQuality?.[key]??DEFAULT_SHADOW_QUALITY[key];
        slider.max=String(Math.max(Number(slider.max),value));slider.value=number.value=String(value);
        if(key==='resolution'&&state.maxShadowResolution)number.max=String(state.maxShadowResolution);
      }
      const quality=state.shadowQuality;
      if(status)status.textContent=state.available?`Configured: ${state.effective} · ${state.shadowComparison?`${comparison.implementation} / ${comparison.grain} grain`:'comparison unavailable'} · ${state.points} sources, ${state.evaluatedPoints??'?'} evaluated per pixel · ${state.capturedPoints??'?'} current-frame cubes · ${quality?.resolution??'?'} px/face · ${quality?.blockerSamples??'?'} blocker + up to ${quality?.filterSamples??'?'} filter taps/source · softness ${state.softness}`:'Awaiting hybrid lighting; load an authored hybrid fire scene.';
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
      const next=validateShadowComparison({...read().shadowComparison,...requestedComparison,...value});
      applyComparison(next);requestedComparison=next;persist();sync();session.redraw();
      const effective=read();record({kind:'fire-shadow.comparison',phase:'applied',requested:next,effective});return effective;
    };
    const stop=session.onFrame(()=>{if(win.__kaminosSceneRadiance?.setShadowSampling){source().setShadowSampling(requested);if(requestedPoints!==null)apply(requestedPoints,requestedPointSampling);if(requestedQuality!==null)applyQuality(requestedQuality);if(requestedComparison!==null)applyComparison(requestedComparison);sync();stop();}});
    return {
      read,
      operations:{
        setShadowComparison,setShadowQuality,restoreShadowQuality(){return setShadowQuality(DEFAULT_SHADOW_QUALITY);},
        setQuadrature,setPoints(value){return setQuadrature({points:value});},
        setSampling(value){validateShadowSampling(value);source().setShadowSampling(value);requested=value;persist();sync();session.redraw();const effective=read();record({kind:'fire-shadow.sampling',phase:'applied',requested:value,effective});return effective;},
        setSoftness(value){if(!Number.isFinite(value)||value<0)throw Error('finite nonnegative softness required');source().setShadowSoftness(value);sync();session.redraw();return read();},
        setBounceGain(value){if(!Number.isFinite(value)||value<0)throw Error('finite nonnegative bounce gain required');const control=document.getElementById('scene-gi-gain');if(!control)throw Error('scene GI control unavailable');control.value=String(value);control.dispatchEvent(new win.Event('change'));session.redraw();return read();},
      },
      mount({root:panel,document,invoke}){
        const label=document.createElement('label');label.textContent='Shadow sampling ';
        selector=document.createElement('select');selector.setAttribute('aria-label','Fire shadow sampling');
        for(const [value,text]of [['fixed','Repeated sample pattern'],['complementary','Complementary neighboring pixels']]){const option=document.createElement('option');option.value=value;option.textContent=text;selector.append(option);}
        status=document.createElement('div');status.setAttribute('role','status');
        selector.addEventListener('change',()=>invoke('setSampling',selector.value).catch(error=>{sync();status.textContent=error.message;}));
        const pointLabel=document.createElement('label');pointLabel.textContent='Flame lighting sources ';
        pointSelector=document.createElement('select');pointSelector.setAttribute('aria-label','Flame lighting sources');
        for(const [value,text]of [[1,'One source — whole flame'],[2,'Two sources — evaluate both'],[4,'Four sources — evaluate all'],['4-paired','Four sources — evaluate complementary pairs']]){const option=document.createElement('option');option.value=String(value);option.textContent=text;pointSelector.append(option);}
        pointSelector.addEventListener('change',()=>invoke('setQuadrature',{points:pointSelector.value==='4-paired'?4:Number(pointSelector.value),pointSampling:pointSelector.value==='4-paired'?'paired':'all'}).catch(error=>{sync();status.textContent=error.message;}));
        pointLabel.append(pointSelector);label.append(selector);panel.append(pointLabel,label);
        const comparisonControl=(text,choices,key)=>{
          const row=document.createElement('label');row.textContent=text;
          const select=document.createElement('select');select.setAttribute('aria-label',text);
          for(const [value,title] of choices){const option=document.createElement('option');option.value=value;option.textContent=title;select.append(option);}
          select.addEventListener('change',()=>invoke('setShadowComparison',{[key]:select.value}).catch(error=>{sync();status.textContent=error.message;}));
          row.append(select);panel.append(row);return select;
        };
        implementationSelector=comparisonControl('Capture implementation',[['shared','Shared preparation + uniform offsets'],['legacy','Before optimization — per-source preparation + arithmetic']],'implementation');
        grainSelector=comparisonControl('Shadow grain placement',[['ordered','Ordered screen pattern — baseline'],['screen','Scrambled screen grain'],['world','Scrambled world-space grain']],'grain');
        const cellRow=document.createElement('label');cellRow.textContent='World grain cell size';
        cellInput=document.createElement('input');cellInput.type='number';cellInput.min='0.000001';cellInput.step='any';cellInput.setAttribute('aria-label','World grain cell size');
        cellInput.addEventListener('change',()=>invoke('setShadowComparison',{worldCellSize:Number(cellInput.value)}).catch(error=>{sync();status.textContent=error.message;}));
        cellRow.append(cellInput);panel.append(cellRow);
        const grainHelp=document.createElement('p');grainHelp.textContent='Independent comparisons; shader changes may pause briefly. Grain scrambles complementary filter phases and source pairs, with no temporal history. World cells are measured in scene units and stay in the world as objects move. Scrambling trades the ordered coverage of neighboring pixels for irregular grain; it is not a denoiser. Use complementary sampling to compare filter grain.';panel.append(grainHelp);
        const heading=document.createElement('h3');heading.textContent='Surface shadow cost';panel.append(heading);
        for(const [key,text,max,help] of [
          ['resolution','Shadow cube resolution',1024,'Pixels per cube face. Lower values reduce capture size and shadow detail.'],
          ['blockerSamples','Blocker-search samples',32,'Depth reads used to estimate blocker distance and penumbra width.'],
          ['filterSamples','Soft-shadow samples',64,'Depth reads used to smooth visibility when blockers are found.'],
        ]){
          const row=document.createElement('label');row.textContent=text;row.title=help;
          const slider=document.createElement('input'),number=document.createElement('input');
          slider.type='range';slider.min='1';slider.max=String(max);slider.step='1';slider.setAttribute('aria-label',text);
          number.type='number';number.min='1';number.step='1';number.setAttribute('aria-label',text+' value');
          const change=value=>invoke('setShadowQuality',{[key]:Number(value)}).catch(error=>{sync();status.textContent=error.message;});
          // Rebuild only on release/commit, not every intermediate drag pixel.
          slider.addEventListener('input',()=>{number.value=slider.value;});
          slider.addEventListener('change',()=>change(slider.value));
          number.addEventListener('change',()=>change(number.value));
          qualityControls.push({key,slider,number});row.append(slider,number);panel.append(row);
        }
        const restore=document.createElement('button');restore.type='button';restore.textContent='Restore 256 / 9 / 16';
        restore.addEventListener('click',()=>invoke('restoreShadowQuality').catch(error=>{sync();status.textContent=error.message;}));
        const help=document.createElement('p');help.textContent='Applies on release; shader rebuild may pause briefly. All source cubes still update every frame. These controls do not scale the viewport or flame.';
        panel.append(restore,help,status);sync();
      },
      async dispose(){stop();await session.dispose();},
    };
  },
};
