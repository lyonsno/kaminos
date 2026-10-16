import {validateShadowSampling} from '../fire-shadow-sampling.mjs';

export default {
  id:'fire-shadow-sampling',title:'Fire shadow sampling',
  async create({host,inputs,record,updateInputs=()=>{}}) {
    const session=await host.scene.open(),document=host.controls.document,win=document.defaultView;
    let requested=validateShadowSampling(inputs.sampling??'complementary');
    let selector,pointSelector,status;
    let requestedPoints=inputs.points??null;
    if(requestedPoints!==null&&![1,2].includes(requestedPoints))throw Error('surface point count must be 1 or 2');
    const persist=()=>updateInputs({...inputs,sampling:requested,...(requestedPoints===null?{}:{points:requestedPoints})});
    const source=()=>{const value=win.__kaminosSceneRadiance;if(!value?.setShadowSampling)throw Error('This scene has no hybrid fire shadow consumer');return value;};
    const read=()=>{const state=win.__kaminosSceneRadiance?.debugState();return {requested,available:!!state?.shadowSampling,effective:state?.shadowSampling??null,softness:state?.shadowSoftness??null,points:state?.pointCount??null,shadows:state?.shadows??[],bounceGain:win.kaminosSceneGIDebugState?.().gain??null};};
    const sync=()=>{const state=read();if(selector)selector.value=state.effective??requested;if(pointSelector)pointSelector.value=String(state.points??requestedPoints??1);if(status)status.textContent=state.available?`Live: ${state.effective} · ${state.points} surface point(s) · 16 filter taps per point · softness ${state.softness}`:'Awaiting hybrid lighting; load an authored hybrid fire scene.';};
    const stop=session.onFrame(()=>{if(win.__kaminosSceneRadiance?.setShadowSampling){source().setShadowSampling(requested);if(requestedPoints!==null)source().setPointCount(requestedPoints);sync();stop();}});
    return {
      read,
      operations:{
        setPoints(value){if(![1,2].includes(value))throw Error('surface point count must be 1 or 2');source().setPointCount(value);requestedPoints=value;persist();sync();session.redraw();const effective=read();record({kind:'fire-shadow.points',phase:'applied',requested:value,effective});return effective;},
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
        for(const [value,text]of [[1,'One source — whole flame'],[2,'Two sources — lower and upper emission']]){const option=document.createElement('option');option.value=String(value);option.textContent=text;pointSelector.append(option);}
        pointSelector.addEventListener('change',()=>invoke('setPoints',Number(pointSelector.value)).catch(error=>{sync();status.textContent=error.message;}));
        pointLabel.append(pointSelector);label.append(selector);panel.append(pointLabel,label,status);sync();
      },
      async dispose(){stop();await session.dispose();},
    };
  },
};
