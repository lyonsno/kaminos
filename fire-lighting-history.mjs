// One scene-history target per meaningful setting. Targets outlive renderer
// mounts and resolve the current consumer when replayed.
export function createFireLightingHistory({edits,getSource,sync=()=>{}}) {
  const scalar={setShadowCaptureBudget:'shadowCaptureBudget',setPointEvaluationBudget:'pointEvaluationBudget',setLightGrid:'volumeGrid',setSourceGrid:'sourceGrid',
    setSmokeEnvironmentBlur:'smokeEnvironmentBlur',setShadowEdgeFilter:'shadowEdgeFilter',
    setSurfaceEnabled:'surfaceEnabled',setCasterLevel:'shadowCasterLevel',
    setSampling:'shadowSampling',setSoftness:'shadowSoftness',setDirections:'directions',
    setAngularPattern:'angularPattern'};
  const methods={setCasterLevel:'setShadowCasterLevel',setSampling:'setShadowSampling',setSoftness:'setShadowSoftness'};
  const descriptors=Object.fromEntries(Object.entries(scalar).map(([name,key])=>[name,{
    read:s=>s[key],write:(source,value)=>source[methods[name]??name](value),
  }]));
  descriptors.setTransportQuality={read:s=>s.transportQuality,write:(source,value)=>source.setTransportQuality(value),patch:true};
  descriptors.setNearBox={read:s=>s.nearBox,write:(source,value)=>source.setNearBox(value),patch:true};
  descriptors.setQuadrature={read:s=>({points:s.pointCount,pointSampling:s.pointSampling}),
    write:(source,v)=>source.setQuadrature(v.points,v.pointSampling)};
  descriptors.setShadowQuality={read:s=>({resolution:s.shadowResolution,blockerSamples:s.blockerSamples,filterSamples:s.filterSamples}),
    write:(source,v)=>source.setShadowQuality(v),patch:true};
  descriptors.setShadowComparison={read:s=>({implementation:s.shadowImplementation,grain:s.shadowGrain,worldCellSize:s.shadowWorldCellSize}),
    write:(source,v)=>source.setShadowComparison(v),patch:true};
  descriptors.setSmokeShadowQuality={read:s=>({steps:s.smokeShadowSteps,resolution:s.smokeShadowResolution,
    filter:s.smokeShadowFilter,angleDegrees:s.smokeShadowFilterAngle,tapsPerAxis:s.smokeShadowFilterTaps,mediumResolution:s.smokeShadowMediumResolution}),
    write:(source,v)=>source.setSmokeShadowQuality(v),patch:true};
  // Asset replacement has its own asynchronous mutation. Scalar and graph
  // requests below publish desired settings synchronously, before preparation.
  descriptors.setCasterLevel.settled=true;
  const source=()=>{const s=getSource();if(!s)throw Error('Fire lighting is not mounted');return s;};
  for(const [name,d]of Object.entries(descriptors))edits.register('@fire-lighting:'+name,{
    read:()=>({value:structuredClone(d.read(source().debugState()))}),
    check:v=>{if(!Object.hasOwn(v,'value'))throw Error('Lighting setting requires a value');return structuredClone(v);},
    async write({value}){const s=source();await d.write(s,value);await s.whenRebuilt?.();sync();},
  });
  return {
    supports:name=>Object.hasOwn(descriptors,name),
    async run(name,value){
      const d=descriptors[name];if(!d)throw Error('Unknown lighting history operation: '+name);
      const consumer=source(),before={value:structuredClone(d.read(consumer.debugState()))};
      const next=d.patch?{...before.value,...value}:value,id='@fire-lighting:'+name;
      if(d.settled)await edits.applySettled(id,{value:next},'Adjust fire lighting');
      else {
        edits.assertCanRecordApplied(id);
        const requested=d.write(consumer,next);
        const after={value:structuredClone(d.read(consumer.debugState()))};
        edits.recordApplied(id,before,after,'Adjust fire lighting');
        sync();
        // Keep API settlement truthful without holding the global gesture.
        // A newer request can now supersede this preparation, and both requests
        // remain individually reversible in their actual acceptance order.
        await requested;await consumer.whenRebuilt?.();
      }
      return source().debugState();
    },
  };
}
