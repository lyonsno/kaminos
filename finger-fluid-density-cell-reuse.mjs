// Experimental shader variant: share cell admission only within lambda -> delta.
// Two integer-valued f32 lanes avoid bitcasting subnormal floats or losing27bits.
export function createDensityCellReuseShader(shader) {
  if(typeof shader!=='string')throw Error('cell reuse requires shader source');
  const entry=name=>{const begin=shader.indexOf('fn '+name+'(');const end=shader.indexOf('\n}',begin)+2;if(begin<0||end<begin+2)throw Error('cell reuse missing entry '+name);return {begin,end,body:shader.slice(begin,end)};};
  const lambda=entry('compute_density_lambda'),delta=entry('solve_position_delta');
  if(lambda.end>delta.begin)throw Error('cell reuse source entry ordering changed');
  const once=(s,a,b)=>{if(s.split(a).length!==2)throw Error('cell reuse source contract changed: '+a);return s.replace(a,b);};
  const stencil=['z','y','x'].map(v=>`for (var ${v} = -1; ${v} <= 1; ${v} = ${v} + 1)`);
  for(const body of [lambda.body,delta.body])for(const loop of stencil)if(body.split(loop).length!==2)throw Error('cell reuse requires unchanged27cell stencil');
  const admission='        if (!density_neighbor_cell_might_contribute(position, neighborCell, selfRadiusScale)) { continue; }';
  const bounds='        if (any(neighborCell < vec3<i32>(0)) || any(neighborCell >= vec3<i32>(params.gridDims.xyz))) { continue; }';
  const bit='(1u << u32((z + 1) * 9 + (y + 1) * 3 + (x + 1)))';
  let l=once(lambda.body,'  var gradientSquared = 0.0;','  var gradientSquared = 0.0;\n  var densityCellAdmissionMask = 0u;');
  l=once(l,admission,admission+'\n        densityCellAdmissionMask = densityCellAdmissionMask | '+bit+';');
  l=once(l,'  particles[index].delta.w = density;','  particles[index].delta.w = density;\n  particles[index].delta.x = f32(densityCellAdmissionMask & 65535u);\n  particles[index].delta.y = f32(densityCellAdmissionMask >> 16u);');
  let d=once(delta.body,'  let lambda = particles[index].predicted.w;','  let lambda = particles[index].predicted.w;\n  let densityCellAdmissionMask = u32(particles[index].delta.x) | (u32(particles[index].delta.y) << 16u);');
  d=once(d,bounds+'\n'+admission,'        if ((densityCellAdmissionMask & '+bit+') == 0u) { continue; }');
  // Apply later replacement first to keep the earlier source offsets intact.
  return shader.slice(0,lambda.begin)+l+shader.slice(lambda.end,delta.begin)+d+shader.slice(delta.end);
}
