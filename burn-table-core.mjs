export const BURN_TABLE_STATES=Object.freeze([
  {id:'original',label:'Original',heat:0,char:0,reaction:0},
  {id:'scorched',label:'Scorched',heat:.35,char:.3,reaction:0},
  {id:'active',label:'Active hot char',heat:1,char:.72,reaction:1},
  {id:'cooled',label:'Cooled scar',heat:0,char:.88,reaction:0},
].map(Object.freeze));
export function checkedBurnControls(value={}) {
  const result={heat:0,char:0,reaction:0,profile:'wood',...value};
  for(const key of ['heat','char','reaction'])if(!Number.isFinite(result[key])||result[key]<0||result[key]>1)throw new RangeError(`Invalid burn ${key}`);
  if(!['wood','metal'].includes(result.profile))throw new RangeError('Invalid burn profile');
  return result;
}
export function evaluateBurnState(value,exposure) {
  const state=checkedBurnControls(value);
  if(!Number.isFinite(exposure)||exposure<0||exposure>1)throw new RangeError('Invalid burn exposure');
  const heat=state.heat*exposure;
  const wood=state.profile==='wood';
  return {heat,char:wood?state.char*exposure:0,reaction:wood?state.reaction*exposure:0,
    glow:Math.max(0,(heat-.55)/.45)};
}

export const BURN_TABLE_ASSET={root:'generated-meshes',path:'sinter-burnt-log-preview-300k-4k-921a6272.glb',
  sha256:'921a62729de2a211b8d995bf6102008462ccae02b6b6c002594b087ae044145c'};
