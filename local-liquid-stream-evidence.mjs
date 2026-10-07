// Validates a complete readback of the live liquid-volume contact descriptor.
export function assertLiquidVolumeCapture(capture) {
  const h=capture?.header, records=capture?.records;
  if(!['plug','round_poiseuille'].includes(capture?.expectedProfile)
    || capture.requestedProfile!==capture.expectedProfile || capture.effectiveProfile!==capture.expectedProfile) throw Error('Effective water profile differs from the requested profile');
  if(capture.sourceFrameId!=='kaminos/finger-fluid-bench:gpu-simulation-frame'
    || capture.sourceFrameHash!==0x6c2673d1 || h?.[7]!==capture.sourceFrameHash) throw Error('Liquid volume capture source frame identity differs from its producer');
  if(capture.coverage!=='active-liquid-particles' || capture.volumeMeaning!=='world-volume-per-particle'
    || !Array.isArray(h) || h.length!==20 || h[16]!==2) throw Error('Liquid volume capture coverage is unsupported');
  if(h[0]!==0x4b4c4643 || h[1]!==1 || h[5]!==1 || h[6]!==1 || h[15]!==32 || h[13]!==0 || h[14]!==0) throw Error('Liquid volume capture header is invalid');
  if(h[2]!==capture.allocationGeneration || h[3]!==capture.epoch || h[4]!==capture.producerTick || h[4]<1) throw Error('Liquid volume capture has a stale identity or tick');
  if(h[8]!==h[9]+h[11] || h[9]>h[12] || h[10]>h[9]) throw Error('Liquid volume capture accounting is inconsistent');
  if(!Array.isArray(records) || records.length!==h[9]*32) throw Error('Liquid volume capture contains partial records');
  const ids=new Set();let airborneCount=0,supportedCount=0,totalVolume=0;
  for(let i=0;i<h[9];i++) {
    const r=records.slice(i*32,(i+1)*32);
    if(!r.every(Number.isFinite) || r[20]!==1 || r[23]<=0 || r[24]!==h[2] || r[25]!==h[3] || r[26]!==h[4] || r[31]!==2) throw Error('Liquid volume capture contains an invalid record');
    if(ids.has(r[3])) throw Error('Liquid volume capture repeats a particle identity');
    ids.add(r[3]);totalVolume+=r[23];
    if(r[28]<.5)airborneCount++;else supportedCount++;
  }
  if(supportedCount!==h[10])throw Error('Liquid volume support count differs from the raw records');
  if(!airborneCount) throw Error('Liquid volume capture has no airborne liquid');
  return {packedCount:h[9],airborneCount,supportedCount,totalVolume,writeTick:h[4]};
}
