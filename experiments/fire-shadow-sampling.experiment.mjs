import {validateShadowSampling} from '../fire-shadow-sampling.mjs';
import {validateSourceQuadrature} from '../fire-source-quadrature.mjs';

export default {
  id:'fire-shadow-sampling',title:'Fire shadow sampling',
  async create({host,inputs,record,updateInputs=()=>{}}) {
    const session=await host.scene.open(),document=host.controls.document,win=document.defaultView;
    let requested=validateShadowSampling(inputs.sampling??'complementary');
    let selector,pointSelector,status;
    let requestedPoints=inputs.points??null;
    let requestedPointSampling=inputs.pointSampling??'all';
    validateSourceQuadrature(requestedPoints??1,requestedPointSampling);
    const persist=()=>updateInputs({...inputs,sampling:requested,...(requestedPoints===null?{}:{points:requestedPoints,pointSampling:requestedPointSampling})});
    const source=()=>{const value=win.__kaminosSceneRadiance;if(!value?.setShadowSampling)throw Error('This scene has no hybrid fire shadow consumer');return value;};
    const read=()=>{const state=win.__kaminosSceneRadiance?.debugState();return {requested,available:!!state?.shadowSampling,effective:state?.shadowSampling??null,softness:state?.shadowSoftness??null,points:state?.pointCount??null,pointSampling:state?.pointSampling??null,evaluatedPoints:state?.evaluatedPointCount??null,capturedPoints:state?.capturedPointCount??null,shadows:state?.shadows??[],bounceGain:win.kaminosSceneGIDebugState?.().gain??null};};
    const sync=()=>{const state=read();if(selector)selector.value=state.effective??requested;if(pointSelector)pointSelector.value=state.pointSampling==='paired'?'4-paired':String(state.points??requestedPoints??1);if(status)status.textContent=state.available?`Live: ${state.effective} · ${state.points} source(s), ${state.evaluatedPoints??'?'} evaluated per pixel · ${state.capturedPoints??'?'} cube captures · 16 filter taps per evaluated source · softness ${state.softness}`:'Awaiting hybrid lighting; load an authored hybrid fire scene.';};
    const apply=(points,mode)=>{
      validateSourceQuadrature(points,mode);
      if(source().setQuadrature)source().setQuadrature(points,mode);
      else if(mode==='all'&&[1,2].includes(points))source().setPointCount(points);
      else throw Error('This runtime has no four-source quadrature consumer');
    };
    const setQuadrature=({points,pointSampling='all'})=>{apply(points,pointSampling);requestedPoints=points;requestedPointSampling=pointSampling;persist();sync();session.redraw();const effective=read();record({kind:'fire-shadow.quadrature',phase:'applied',requested:{points,pointSampling},effective});return effective;};
    const stop=session.onFrame(()=>{if(win.__kaminosSceneRadiance?.setShadowSampling){source().setShadowSampling(requested);if(requestedPoints!==null)apply(requestedPoints,requestedPointSampling);sync();stop();}});
    return {
      read,
      operations:{
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
        pointLabel.append(pointSelector);label.append(selector);panel.append(pointLabel,label,status);sync();
      },
      async dispose(){stop();await session.dispose();},
    };
  },
};
