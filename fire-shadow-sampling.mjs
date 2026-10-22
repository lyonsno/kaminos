import {shadowStrata} from './fire-shadow-quality.mjs';
export function validateShadowComparison({implementation='shared',grain='ordered',worldCellSize=.02}={}) {
  if(!['shared','legacy'].includes(implementation))throw Error('shadow implementation must be shared or legacy');
  if(!['ordered','screen','screen-animated','world','balanced-pairs','balanced-filter','balanced'].includes(grain))throw Error('unknown shadow grain mode');
  if(!Number.isFinite(worldCellSize)||worldCellSize<=0)throw Error('world grain cell size must be finite and positive');
  return {implementation,grain,worldCellSize};
}

// Integer PCG permutation (same constants as the bundled Three TSL hash).
// Low four bits select the existing equal-area filter phase; a separate bit
// selects the source pair. A zero frame seed preserves stable spatial grain.
export function shadowGrainPhase(cell,frame=0) {
  const seed=(Math.imul(cell[0],73856093)^Math.imul(cell[1],19349663)^Math.imul(cell[2],83492791)^Math.imul(frame,2654435761))>>>0;
  const state=(Math.imul(seed,747796405)+2891336453)>>>0;
  const word=Math.imul((state>>>((state>>>28)+4))^state,277803737)>>>0;
  const bits=((word>>>22)^word)>>>0;
  return {x:bits&3,y:(bits>>>2)&3,pair:(bits>>>4)&1};
}
export function shadowGrainNode(cell,{uint,vec2},frame=null) {
  const c=cell.floor().toIVec3().toUVec3();
  let seed=c.x.mul(uint(73856093)).bitXor(c.y.mul(uint(19349663))).bitXor(c.z.mul(uint(83492791)));
  if(frame)seed=seed.bitXor(frame.mul(uint(2654435761)));
  const state=seed.mul(uint(747796405)).add(uint(2891336453));
  const word=state.shiftRight(state.shiftRight(uint(28)).add(uint(4))).bitXor(state).mul(uint(277803737));
  const bits=word.shiftRight(uint(22)).bitXor(word).toVar();
  return {bits,coordinates:vec2(bits.bitAnd(uint(3)).toFloat(),bits.shiftRight(uint(2)).bitAnd(uint(3)).toFloat()),firstPair:bits.shiftRight(uint(4)).bitAnd(uint(1)).equal(uint(0))};
}

// Scramble a bijection, not each pixel independently. Every 2x2 contains
// two pixels per pair; every 8x4 contains all 16 filter phases for EACH pair.
// The block scramble changes with frame without adding taps or history. This
// is stratification, not a blue-noise guarantee or a reconstruction filter.
export function balancedShadowPhase(cell,frame=0) {
  const x=Math.floor(cell[0]),y=Math.floor(cell[1]);
  const s=shadowGrainPhase([Math.floor(x/8),Math.floor(y/4),0],frame);
  return {x:((y&1)|((x&2)))^s.x,y:(((y>>>1)&1)|((x>>>1)&2))^s.y,pair:((x^y)&1)^s.pair};
}
export function balancedShadowNode(cell,tsl,frame) {
  const {vec3,uint,vec2}=tsl,c=cell.floor().toIVec3().toUVec3();
  const s=shadowGrainNode(vec3(cell.x.div(8),cell.y.div(4),0),tsl,frame);
  const px=c.y.bitAnd(uint(1)).bitOr(c.x.bitAnd(uint(2))).bitXor(s.bits.bitAnd(uint(3)));
  const py=c.y.shiftRight(uint(1)).bitAnd(uint(1)).bitOr(c.x.shiftRight(uint(1)).bitAnd(uint(2))).bitXor(s.bits.shiftRight(uint(2)).bitAnd(uint(3)));
  const pair=c.x.bitXor(c.y).bitAnd(uint(1)).bitXor(s.bits.shiftRight(uint(4)).bitAnd(uint(1)));
  return {bits:s.bits,coordinates:vec2(px.toFloat(),py.toFloat()),firstPair:pair.equal(uint(0))};
}
export function validateShadowSampling(value) {
  if(!['fixed','complementary'].includes(value))throw Error('shadow sampling must be fixed or complementary');
  return value;
}

// Equal-area polar strata. Every pixel samples all 16 broad strata; a 4x4
// pixel neighborhood fills their 16 complementary sub-strata. Permutations
// break radial/spoke alignment without changing support or quadrature weight.
export function complementaryDiskSample(index,phaseX,phaseY,count=16) {
  const {bands,sectors}=shadowStrata(count);
  if(!Number.isInteger(index)||index<0||index>=count)throw Error('valid stratum required');
  if(![phaseX,phaseY].every(v=>Number.isInteger(v)&&v>=0&&v<4))throw Error('valid pixel phase required');
  const band=Math.floor(index/sectors),sector=index%sectors;
  const area=(band+(((phaseY+sector*3+band)%4)+.5)/4)/bands;
  const angle=2*Math.PI*(sector+(((phaseX+band*3+sector)%4)+.5)/4)/sectors;
  return [Math.sqrt(area)*Math.cos(angle),Math.sqrt(area)*Math.sin(angle)];
}
