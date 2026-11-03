// Authored reference units, independent of the allocation's cell count and bounds.
// Width is in scene world units; time retains the simulation's existing convention.
export function resolveWorldCalibration(c={}, {grid=Number(c.resolution??64),scale=Number(c.simulationDomainScale??1)}={}) {
 const mode=c.calibrationMode??'legacy';
 if(!['legacy','world'].includes(mode))throw Error('Unknown simulation calibration mode');
 if(mode==='legacy')return {mode,enabled:false,cellGain:1,lengthGain:1,materialCells:0,velocityCells:0};
 const width=Number(c.simulationWorldScale),materialCells=Number(c.calibrationMaterialCells),velocityCells=Number(c.calibrationVelocityCells);
 if(!Number.isFinite(width)||width<=0||!Number.isFinite(scale)||scale<=0||!Number.isSafeInteger(materialCells)||materialCells<4||!Number.isSafeInteger(velocityCells)||velocityCells<2||!Number.isSafeInteger(grid)||grid<2)throw Error('World calibration requires a positive world width and saved reference material/velocity cell counts');
 const lengthGain=width/(2*scale);
 return {mode,enabled:true,width,materialCells,velocityCells,lengthGain,cellGain:lengthGain*grid/materialCells,referenceCellWidth:width/materialCells,currentCellWidth:2*scale/grid};
}
export function captureWorldCalibration(c,scale){
 const next={calibrationMode:'world',simulationWorldScale:2*scale,calibrationMaterialCells:Number(c.resolution),calibrationVelocityCells:Number(c.fineVelocity)||Number(c.resolution)};
 resolveWorldCalibration(next,{grid:next.calibrationMaterialCells,scale});return next;
}
export const WORLD_CALIBRATION_FIELDS=[
 {key:'calibrationMode',id:'volume-calibration-mode',param:'volume_calibration_mode',value:'legacy',label:'Simulation calibration',description:'World scale keeps authored forces, inlet speed/thickness, mixing diffusivity and wavelet wavelengths independent of grid detail and coverage. Capture current tuning once in Simulation grids. Legacy retains the previous cell-relative behavior.',type:'select-one'},
 {key:'simulationWorldScale',id:'volume-simulation-world-scale',param:'volume_simulation_world_scale',value:2,label:'Simulation world scale',description:'Reference width in scene world units. Changes the authored physical velocity/force and wavelength scale linearly, and diffusivity quadratically. Does not resize coverage or sources. Grid detail and pressure iterations remain numerical quality choices.',type:'number'},
 {key:'calibrationMaterialCells',id:'volume-calibration-material-cells',param:'volume_calibration_material_cells',value:64,label:'Reference material cells',description:'Saved when capturing current tuning. Interprets existing cell-unit coefficients; changing actual grid detail never changes this reference.',type:'number'},
 {key:'calibrationVelocityCells',id:'volume-calibration-velocity-cells',param:'volume_calibration_velocity_cells',value:64,label:'Reference velocity cells',description:'Saved reference for wavelet wavelengths and calibrated confinement. Actual velocity resolution remains independently adjustable.',type:'number'},
];
export const WORLD_CALIBRATION_WGSL=/* wgsl */`
fn calibrationCellGain()->f32{return u.world_calibration.x;}
fn calibrationConfinementGain()->f32{
 return select(1.0,f32(GRID)*u.world_calibration.y/max(1.0,u.world_calibration.w),u.world_calibration.w>0.0);
}
fn calibrationNoiseCoordinate(cell:vec3<f32>)->vec3<f32>{
 if(u.world_calibration.w<=0.0){return cell;}
 let referenceHalfWidth=u.calibration_pose.w*u.world_calibration.y;
 let world=u.calibration_pose.xyz+cellToWorld(cell)*u.calibration_pose.w;
 return (world/referenceHalfWidth+1.0)*u.world_calibration.w*.5;
}
`;
export function readWorldCalibrationControls(controls){
 return Object.fromEntries(WORLD_CALIBRATION_FIELDS.map(f=>{
  const d=controls[f.id];if(!d)throw Error(`Missing calibration control ${f.id}`);
  const value=d.rawValue??d.value;return [f.key,f.type==='select-one'?value:Number(value)];
 }));
}

// Both texture initializers and the shader reset use this same world-anchored
// coordinate convention. Only the coordinates reset when authored scale changes;
// transported gas and velocity retain their history.
export function calibrationSignature(c){return JSON.stringify([c.mode,c.width,c.materialCells,c.velocityCells]);}
export function calibrationWaveletLattice(dims,{calibration={enabled:false},transform={scale:1,translate:[0,0,0]}}={}){
 const [nx,ny,nz]=dims,values=new Float32Array(nx*ny*nz*8);let i=0;
 const {enabled,width,velocityCells}=calibration;
 const gain=enabled?transform.scale*2/width*velocityCells/nx:1;
 const offset=enabled?transform.translate.map(t=>(t-transform.scale)*velocityCells/width+velocityCells/2):[0,0,0];
 for(let set=0;set<2;set++)for(let z=0;z<nz;z++)for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  values[i++]=(x+.5)*gain+offset[0];values[i++]=(y+.5)*gain+offset[1];values[i++]=(z+.5)*gain+offset[2];i++;
 }
 return values;
}
