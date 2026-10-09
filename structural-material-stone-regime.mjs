export function configureStoneRegime(manifest,arrays,name='stiff-brittle-v1'){
 if(!['stiff-brittle-v1','legacy'].includes(name))throw new Error(`Unknown stone regime: ${name}`);
 const source=manifest.material,model=manifest.model;
 if(model.kind!=='graph'||!Number.isSafeInteger(model.elements)||model.elements<1||!(source.young>0)||!(source.density>0)||!(source.poisson>-1&&source.poisson<.5))throw new Error('Explicit prepared graph material required');
 if(!(arrays.coefficients instanceof Float32Array)||arrays.coefficients.length!==model.elements*64*36||!(arrays.parameters instanceof Float32Array)||arrays.parameters.length!==model.elements*16)throw new Error('Complete prepared 64-mask matrix and parameter layout required');
 const material={...source,young:name==='legacy'?source.young:100000},threshold=name==='legacy'?18:180,volumeBarrier=material.young/(2*(1+material.poisson)),scale=material.young/source.young;
 const coefficients=new Float32Array(model.elements*36),parameters=arrays.parameters.slice();
 for(let t=0;t<model.elements;t++){for(let k=0;k<36;k++)coefficients[t*36+k]=arrays.coefficients[t*64*36+k]*scale;parameters[t*16+7]=volumeBarrier;}
 if(!coefficients.every(Number.isFinite)||!parameters.every(Number.isFinite))throw new Error('Stone regime produces nonfinite material coefficients');
 return{profile:{name,route:'kaminos.provisional-stone-regime.v1',sourceMaterial:{...source},material,threshold,volumeBarrier,claim:'Explicit expressive stiffness and brittle stress criterion, not calibrated stone properties'},model:{...model,constitutiveLayout:'separated-intact-tetrahedra-v1',volumeBarrier},arrays:{...arrays,coefficients,parameters}};
}
