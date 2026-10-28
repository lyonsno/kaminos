export function coarseRestFrame({cells,bonds,floorY}){
 if(!cells.length)throw new Error('Rest encoding needs material cells');
 const finite=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
 if(cells.some(c=>!finite(c.position))||bonds.some(b=>!finite(b.anchorA)||!finite(b.anchorB)))throw new Error('Rest encoding needs finite material coordinates');
 const origin=[0,1,2].map(k=>{const values=cells.map(c=>c.position[k]);return Math.min(...values)+(Math.max(...values)-Math.min(...values))/2;});
 const contacts=bonds.map(b=>[0,1,2].map(k=>(cells[b.a].position[k]+b.anchorA[k]+cells[b.b].position[k]+b.anchorB[k])/2-origin[k]));
 const local=cells.map(c=>c.position.map((x,k)=>x-origin[k]));
 const scale=Math.max(0,...local.flat().map(Math.abs),...contacts.flat().map(Math.abs));
 // All positions and paired anchors share one binary lattice. Every integer
 // coordinate fits Float32's significand, so packing cannot preload a joint.
 const quantum=scale===0?0:Math.max(2**-149,2**(Math.ceil(Math.log2(scale))-23));
 const snap=x=>quantum?Math.round(x/quantum)*quantum:0;
 const encoded=cells.map((c,i)=>({...c,position:local[i].map(snap)}));
 const joints=bonds.map((b,i)=>{const contact=contacts[i].map(snap);return {...b,anchorA:contact.map((x,k)=>x-encoded[b.a].position[k]),anchorB:contact.map((x,k)=>x-encoded[b.b].position[k])};});
 const maxPositionAdjustment=Math.max(...encoded.flatMap((c,i)=>c.position.map((x,k)=>Math.abs(x+origin[k]-cells[i].position[k]))));
 return {origin,quantum,cells:encoded,bonds:joints,floorY:floorY-origin[1],maxPositionAdjustment};
}
