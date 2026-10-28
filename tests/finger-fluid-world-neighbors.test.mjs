// kaminos-test: node
import assert from 'node:assert/strict';
import {createFingerFluidDiagnosticShaderFixture} from '../finger-fluid-webgpu-core.js';
import {applyWorldSpaceNeighbors,worldNeighborFunctions} from '../finger-fluid-world-neighbors.mjs';
const original=createFingerFluidDiagnosticShaderFixture();
const transformed=applyWorldSpaceNeighbors(original,{cellWidth:.185});
assert.ok(original.includes('clamp((position - params.boundsMin.xyz) / span'),'The legacy route retains its original bounded grid');
assert.ok(!transformed.includes('neighborCell >= vec3<i32>(params.gridDims.xyz)'),'World cells cannot be rejected by former search dimensions');
const loops=[...transformed.matchAll(/while \(current >= 0\) \{([\s\S]*?)current = particleNext\[neighborIndex\]\.w;/g)];
assert.equal(loops.length,13,'Every production neighbor consumer must use the same collision-safe list');
for(const [,loop] of loops)assert.ok(loop.includes('particleNext[neighborIndex].xyz != neighborCell'),'Hash collisions must be filtered before any neighbor effect');
assert.throws(()=>applyWorldSpaceNeighbors(original.replace('let neighborIndex = u32(current);','let unexpectedNode = u32(current);'),{cellWidth:.185}),/every bucket/,'A new unadapted traversal must fail compilation visibly');
for(const cellWidth of [0,-1,NaN,Infinity,1e-50,1e50])assert.throws(()=>worldNeighborFunctions(cellWidth),/positive finite f32/);
console.log('All production neighbor loops retain exact build-time cell membership; legacy route unchanged');

// Refining the grid must shrink zero-weight work while retaining the wider
// physical neighborhood used by cohesion and topology.
const refined=applyWorldSpaceNeighbors(original,{cellWidth:.127422765,uniformSupportRadius:.127422765,nominalCellWidth:.185});
function body(source,name){
 const start=source.indexOf(`fn ${name}(`),open=source.indexOf('{',start);
 assert.ok(start>=0&&open>start,`${name} exists`);
 let end=open+1,depth=1;
 for(;depth&&end<source.length;end++){if(source[end]==='{')depth++;else if(source[end]==='}')depth--;}
 return source.slice(open+1,end-1);
}
const viscosity=body(refined,'compute_velocity_viscosity');
assert.match(viscosity,/world_neighbor_cell_might_contribute/,'Viscosity must skip cells outside its interaction radius before walking them');
assert.match(viscosity,/neighborSearchRadius = worldUniformSupportRadius/,'Viscosity uses the existing scaled physical support');
for(const name of ['measure_neighbor_topology','apply_surface_cohesion']){
 const stage=body(refined,name);
 assert.match(stage,/neighborSearchRadius = params\.fluid\.x/,'Cohesion and topology keep nominal support even with finer search cells');
 assert.match(stage,/neighborSearchCellWidth = worldNominalCellWidth/,'Wide support retains a coarse index instead of scanning a volume of tiny empty cells');
 assert.match(stage,/neighborCellMin\.z; z <= neighborCellMax\.z/,'A wider physical support can visit more than three fine cells');
}
for(const name of ['compute_density_lambda','solve_position_delta','classify_free_surface','compute_velocity_viscosity','compute_vorticity','apply_vorticity_confinement','classify_unsupported_sheet','compute_support_particle_shift','estimate_interface_curvature','compact_interface_records','compute_material_tracer_diffusion']){
 const stage=body(refined,name);
 assert.match(stage,/neighborSearchRadius = worldUniformSupportRadius/,`${name} retains scaled support`);
 assert.match(stage,/world_neighbor_pair_might_contribute/,`${name} rejects zero-contribution pairs before weight and payload work`);
}
assert.throws(()=>applyWorldSpaceNeighbors(original.replace('fn compute_velocity_viscosity(','fn unfamiliar_neighbor_consumer('),{cellWidth:.1,uniformSupportRadius:.1}),/radius contract/,'A new consumer cannot silently inherit a short radius');
