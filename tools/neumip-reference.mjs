// Scalar reference follows the author's exported matrices, GLSL coordinate
// convention, depth offset, mip interpolation and logarithmic color transform.
function network(model,prefix,input){let a=input;for(let k=0;k<4;k++){const l=model.layers.find(x=>x.name===`${prefix}.mpl${k}`);a=Array.from({length:l.output},(_,j)=>{let n=l.biases[j]??0;for(let i=0;i<l.input;i++)n+=l.weights[j*l.input+i]*a[i];return l.relu?Math.max(0,n):n;});}return a;}
function sample(t,uv){const p=uv.map((u,i)=>u*[t.width,t.height][i]-.5),lo=p.map(Math.floor),w=p.map((x,i)=>x-lo[i]),result=Array(t.channels).fill(0);for(let y=0;y<2;y++)for(let x=0;x<2;x++){const ix=((lo[0]+x)%t.width+t.width)%t.width,iy=((lo[1]+y)%t.height+t.height)%t.height;for(let c=0;c<t.channels;c++)result[c]+=t.data[(iy*t.width+ix)*t.channels+c]*(x?w[0]:1-w[0])*(y?w[1]:1-w[1]);}return result;}
export function referenceNeumip(model,uv,view,light,lod){
 const depth=network(model,'offset_network',[...sample(model.offset,uv),view[0],view[1]])[0];
 const z=Math.max(.6,Math.sqrt(Math.max(0,1-view[0]**2-view[1]**2))),shifted=uv.map((u,i)=>u-Math.floor(u)+depth*view[i]/z*.05);
 const l=Math.max(0,Math.min(model.mips.length-1,lod)),lo=Math.floor(l),hi=Math.min(lo+1,model.mips.length-1),w=l-lo;
 const a=sample(model.mips[lo],shifted),b=sample(model.mips[hi],shifted),f=a.map((x,i)=>x*(1-w)+b[i]*w);
 const v=network(model,'main',[light[0],light[1],view[0],view[1],...f]);
 return [v[0]+1.13983*v[2],v[0]-.39465*v[1]-.58060*v[2],v[0]+2.03211*v[1]].map((x,i)=>(Math.exp(x)-1)*(.1+1/(1+Math.exp(-v[i+3]))));
}
