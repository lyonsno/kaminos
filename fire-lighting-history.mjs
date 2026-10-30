// One scene-history target per meaningful setting. Targets outlive renderer
// mounts and resolve the current consumer when replayed.
export function createFireLightingHistory({edits,getSource,sync=()=>{}}) {
  const scalar={setPointEvaluationBudget:'pointEvaluationBudget',setLightGrid:'volumeGrid',
    setSmokeEnvironmentBlur:'smokeEnvironmentBlur',setShadowEdgeFilter:'shadowEdgeFilter',
    setSurfaceEnabled:'surfaceEnabled',setCasterLevel:'shadowCasterLevel',
    setSampling:'shadowSampling',setSoftness:'shadowSoftness',setDirections:'directions',
    setAngularPattern:'angularPattern'};
  const methods={setCasterLevel:'setShadowCasterLevel',setSampling:'setShadowSampling',setSoftness:'setShadowSoftness'};
  const descriptors=Object.fromEntries(Object.entries(scalar).map(([name,key])=>[name,{
    read:s=>s[key],write:(source,value)=>source[methods[name]??name](value),
  }]));
  descriptors.setQuadrature={read:s=>({points:s.pointCount,pointSampling:s.pointSampling}),
    write:(source,v)=>source.setQuadrature(v.points,v.pointSampling)};
  descriptors.setShadowQuality={read:s=>({resolution:s.shadowResolution,blockerSamples:s.blockerSamples,filterSamples:s.filterSamples}),
    write:(source,v)=>source.setShadowQuality(v),patch:true};
  descriptors.setShadowComparison={read:s=>({implementation:s.shadowImplementation,grain:s.shadowGrain,worldCellSize:s.shadowWorldCellSize}),
    write:(source,v)=>source.setShadowComparison(v),patch:true};
  descriptors.setSmokeShadowQuality={read:s=>({steps:s.smokeShadowSteps,resolution:s.smokeShadowResolution,
    filter:s.smokeShadowFilter,angleDegrees:s.smokeShadowFilterAngle,tapsPerAxis:s.smokeShadowFilterTaps,mediumResolution:s.smokeShadowMediumResolution}),
    write:(source,v)=>source.setSmokeShadowQuality(v),patch:true};
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
      const next=d.patch?{...d.read(source().debugState()),...value}:value;
      await edits.applySettled('@fire-lighting:'+name,{value:next},'Adjust fire lighting');
      return source().debugState();
    },
  };
}
