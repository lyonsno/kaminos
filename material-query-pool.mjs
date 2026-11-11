// Spatial capture coherence and optimizer batch diversity are separate concerns.
// A rolling pool mixes complete retained captures without changing their labels.
export function createMaterialQueryPool(capacity){
 if(!Number.isSafeInteger(capacity)||capacity<1)throw Error('Positive query pool capacity required');
 const queries=new Float32Array(capacity*8),labels=new Float32Array(capacity*3),raw=new Float32Array(capacity*3);
 let count=0,cursor=0;
 return {
  get count(){return count;},
  add(capture){
   const n=capture.queries.length/8;
   if(!Number.isSafeInteger(n)||n<1||n>capacity||capture.filtered.length!==n*3||capture.raw.length!==n*3)throw Error('Capture does not fit query pool');
   for(let i=0;i<n;i++){
    queries.set(capture.queries.subarray(i*8,i*8+8),cursor*8);labels.set(capture.filtered.subarray(i*3,i*3+3),cursor*3);raw.set(capture.raw.subarray(i*3,i*3+3),cursor*3);
    cursor=(cursor+1)%capacity;count=Math.min(capacity,count+1);
   }
  },
  sample(n,random){
   if(!count||!Number.isSafeInteger(n)||n<1)throw Error('Nonempty pool and positive sample count required');
   const batch={queries:new Float32Array(n*8),filtered:new Float32Array(n*3),raw:new Float32Array(n*3)};
   for(let i=0;i<n;i++){
    const u=random();if(!(u>=0&&u<1))throw Error('Pool RNG must return [0,1)');const index=Math.floor(u*count);
    batch.queries.set(queries.subarray(index*8,index*8+8),i*8);batch.filtered.set(labels.subarray(index*3,index*3+3),i*3);batch.raw.set(raw.subarray(index*3,index*3+3),i*3);
   }
   return batch;
  }
 };
}
