export function summarizePairedTiming(series, pairs, repetitions) {
  if(!Number.isSafeInteger(pairs)||pairs<1||!Number.isSafeInteger(repetitions)||repetitions<1||!Array.isArray(series?.samples)||series.samples.length!==pairs)
    throw Error('paired timing requires every requested sample');
  const rows=series.samples.map((s,i)=>{
    const order=i%2===0?['A','B']:['B','A'];
    if(s.index!==i||JSON.stringify(s.order)!==JSON.stringify(order)||s.timestamps?.length!==4)throw Error('paired timing order/index/shape mismatch');
    const v=s.timestamps.map(x=>BigInt(x));if(v.some(x=>x<=0n)||v[1]<=v[0]||v[3]<=v[2]||v[2]<v[1])throw Error('paired timing unwritten/nonmonotonic/empty interval');
    const ms=[Number(v[1]-v[0])/1e6/repetitions,Number(v[3]-v[2])/1e6/repetitions];
    const a=ms[order.indexOf('A')],b=ms[order.indexOf('B')];
    return {index:i,order:order.join(''),aMs:a,bMs:b,ratio:b/a};
  });
  const describe=values=>{const a=values.toSorted((x,y)=>x-y);return {count:a.length,median:a[Math.floor((a.length-1)/2)],p10:a[Math.floor((a.length-1)*.1)],p90:a[Math.floor((a.length-1)*.9)],min:a[0],max:a.at(-1)};};
  const blocks=[];for(let i=0;i+1<rows.length;i+=2)blocks.push(Math.sqrt(rows[i].ratio*rows[i+1].ratio));
  return {sampleCount:rows.length,discardedSamples:[],pairedRatio:describe(rows.map(r=>r.ratio)),byOrder:Object.fromEntries(['AB','BA'].map(order=>[order,describe(rows.filter(r=>r.order===order).map(r=>r.ratio))])),counterbalancedBlockRatio:blocks.length?describe(blocks):null,unpairedTail:rows.length%2,aMs:describe(rows.map(r=>r.aMs)),bMs:describe(rows.map(r=>r.bMs)),rows,meaning:'B/A elapsed GPU time. Quantiles describe observed spread, not confidence bounds or proof of contention immunity.'};
}
