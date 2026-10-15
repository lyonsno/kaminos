// Browser-callable port of fast_simplification 0.2.0 (Fast-Quadric-Mesh-
// Simplification, Sven Forstmann, MIT), the simplifier that the accepted
// TRELLIS2MLX finishing route calls. Statement order, double arithmetic,
// fmin semantics and container behavior follow Simplify.h so the same input
// yields the same collapses; parity is asserted against the native wheel.

const fmin=(a,b)=>a!==a?b:b!==b?a:(a<b?a:b);

// The native wheel is built with clang's default -ffp-contract=on, which fuses
// the multiply-adds marked below into one rounding. fma() reproduces that
// single rounding: exact Dekker product, exact sum, round-to-odd tail
// (Boldo-Melquiond), final round-to-nearest.
const SPLIT=134217729,bits=new Float64Array(1),words=new Uint32Array(bits.buffer);
function nextToward(x,sign){
  if(x===0)return sign>0?Number.MIN_VALUE:-Number.MIN_VALUE;
  bits[0]=x;const up=(x>0)===(sign>0);
  if(up){if(++words[0]===0)words[1]++;}else{if(words[0]--===0)words[1]--;}
  return bits[0];
}
export function fma(a,b,c){
  const p=a*b;
  if(!Number.isFinite(p)||!Number.isFinite(c))return p+c;
  let t=SPLIT*a;const ah=t-(t-a),al=a-ah;t=SPLIT*b;const bh=t-(t-b),bl=b-bh;
  const e=((ah*bh-p)+ah*bl+al*bh)+al*bl;
  const s=p+c,bb=s-p,r=(p-(s-bb))+(c-bb);
  let v=r+e;const vb=v-r,w=(r-(v-vb))+(e-vb);
  if(w!==0){bits[0]=v;if((words[0]&1)===0)v=nextToward(v,w);}
  return s+v;
}

// vec3f::normalize: sqrt(x*x + y*y + z*z) with both additions fused.
const norm2=(x,y,z)=>fma(z,z,fma(x,x,y*y));

function growInt32(array,size){
  if(size<=array.length)return array;
  let n=Math.max(16,array.length);while(n<size)n*=2;
  const out=new Int32Array(n);out.set(array);return out;
}

class FastQuadricSimplifier{
  constructor(points,triangles){
    const nv=points.length/3,nt=triangles.length/3;
    this.nv=nv;this.nt=nt;
    this.p=Float64Array.from(points);
    this.q=new Float64Array(nv*10);this.tstart=new Int32Array(nv);this.tcount=new Int32Array(nv);this.border=new Uint8Array(nv);
    this.tv=Int32Array.from(triangles);this.terr=new Float64Array(nt*4);this.tdel=new Uint8Array(nt);this.tdirty=new Uint8Array(nt);
    this.tn=new Float64Array(nt*3);
    this.rtid=new Int32Array(0);this.rtv=new Int32Array(0);this.nrefs=0;
    this.qs=new Float64Array(10);
  }
  pushRef(tid,tvertex){
    if(this.nrefs>=this.rtid.length){this.rtid=growInt32(this.rtid,this.nrefs+1);this.rtv=growInt32(this.rtv,this.nrefs+1);}
    this.rtid[this.nrefs]=tid;this.rtv[this.nrefs]=tvertex;this.nrefs++;
  }
  // SymetricMatrix::det on the summed quadric held in this.qs.
  det(m,a11,a12,a13,a21,a22,a23,a31,a32,a33){
    let d=fma(m[a11]*m[a22],m[a33],m[a13]*m[a21]*m[a32]);
    d=fma(m[a12]*m[a23],m[a31],d);
    d=fma(-(m[a13]*m[a22]),m[a31],d);
    d=fma(-(m[a11]*m[a23]),m[a32],d);
    return fma(-(m[a12]*m[a21]),m[a33],d);
  }
  vertexError(q,x,y,z){
    let e=fma(q[0]*x,x,2*q[1]*x*y);
    e=fma(2*q[2]*x,z,e);e=fma(2*q[3],x,e);e=fma(q[4]*y,y,e);e=fma(2*q[5]*y,z,e);
    e=fma(2*q[6],y,e);e=fma(q[7]*z,z,e);e=fma(2*q[8],z,e);
    return e+q[9];
  }
  // Returns the error and writes the collapse point into out[0..2].
  calculateError(a,b,out){
    const q=this.qs,Q=this.q;for(let k=0;k<10;k++)q[k]=Q[a*10+k]+Q[b*10+k];
    const border=this.border[a]&this.border[b];
    let error=0;const det=this.det(q,0,1,2,1,4,5,2,5,7);
    if(det!==0&&!border){
      out[0]=-1/det*(this.det(q,1,2,3,4,5,6,5,7,8));
      out[1]=1/det*(this.det(q,0,2,3,1,5,6,2,7,8));
      out[2]=-1/det*(this.det(q,0,1,3,1,4,6,2,5,8));
      error=this.vertexError(q,out[0],out[1],out[2]);
    }else{
      const P=this.p,x1=P[a*3],y1=P[a*3+1],z1=P[a*3+2],x2=P[b*3],y2=P[b*3+1],z2=P[b*3+2];
      const x3=(x1+x2)/2,y3=(y1+y2)/2,z3=(z1+z2)/2;
      const e1=this.vertexError(q,x1,y1,z1),e2=this.vertexError(q,x2,y2,z2),e3=this.vertexError(q,x3,y3,z3);
      error=fmin(e1,fmin(e2,e3));
      if(e1===error){out[0]=x1;out[1]=y1;out[2]=z1;}
      if(e2===error){out[0]=x2;out[1]=y2;out[2]=z2;}
      if(e3===error){out[0]=x3;out[1]=y3;out[2]=z3;}
    }
    return error;
  }
  flipped(px,py,pz,i0,i1,v0,deleted){
    const {tv,tdel,tn,p}=this,ts=this.tstart[v0],tc=this.tcount[v0];
    for(let k=0;k<tc;k++){
      const tid=this.rtid[ts+k];if(tdel[tid])continue;
      const s=this.rtv[ts+k],id1=tv[tid*3+(s+1)%3],id2=tv[tid*3+(s+2)%3];
      if(id1===i1||id2===i1){deleted[k]=1;continue;}
      let d1x=p[id1*3]-px,d1y=p[id1*3+1]-py,d1z=p[id1*3+2]-pz;
      let sq=Math.sqrt(norm2(d1x,d1y,d1z));d1x/=sq;d1y/=sq;d1z/=sq;
      let d2x=p[id2*3]-px,d2y=p[id2*3+1]-py,d2z=p[id2*3+2]-pz;
      sq=Math.sqrt(norm2(d2x,d2y,d2z));d2x/=sq;d2y/=sq;d2z/=sq;
      if(Math.abs(fma(d2z,d1z,fma(d2x,d1x,d2y*d1y)))>0.999)return true;
      let nx=fma(d1y,d2z,-(d1z*d2y)),ny=fma(d1z,d2x,-(d1x*d2z)),nz=fma(d1x,d2y,-(d1y*d2x));
      sq=Math.sqrt(norm2(nx,ny,nz));nx/=sq;ny/=sq;nz/=sq;
      deleted[k]=0;
      if(fma(tn[tid*3+2],nz,fma(tn[tid*3],nx,tn[tid*3+1]*ny))<0.2)return true;
    }
    return false;
  }
  updateTriangles(i0,v,deleted,state){
    const {tv,tdel,tdirty,terr}=this,ts=this.tstart[v],tc=this.tcount[v],scratch=this.scratch;
    for(let k=0;k<tc;k++){
      const tid=this.rtid[ts+k],tvertex=this.rtv[ts+k];
      if(tdel[tid])continue;
      if(deleted[k]){tdel[tid]=1;state.deleted++;continue;}
      tv[tid*3+tvertex]=i0;tdirty[tid]=1;
      const e0=this.calculateError(tv[tid*3],tv[tid*3+1],scratch);
      const e1=this.calculateError(tv[tid*3+1],tv[tid*3+2],scratch);
      const e2=this.calculateError(tv[tid*3+2],tv[tid*3],scratch);
      terr[tid*4]=e0;terr[tid*4+1]=e1;terr[tid*4+2]=e2;terr[tid*4+3]=fmin(e0,fmin(e1,e2));
      this.pushRef(tid,tvertex);
    }
  }
  updateMesh(iteration){
    const nv=this.nv;
    if(iteration>0){
      const {tv,terr,tdel,tdirty,tn}=this;let dst=0;
      for(let i=0;i<this.nt;i++)if(!tdel[i]){
        if(dst!==i){
          tv[dst*3]=tv[i*3];tv[dst*3+1]=tv[i*3+1];tv[dst*3+2]=tv[i*3+2];
          for(let k=0;k<4;k++)terr[dst*4+k]=terr[i*4+k];
          tdel[dst]=tdel[i];tdirty[dst]=tdirty[i];
          tn[dst*3]=tn[i*3];tn[dst*3+1]=tn[i*3+1];tn[dst*3+2]=tn[i*3+2];
        }
        dst++;
      }
      this.nt=dst;
    }
    const {tv,p,q,tn,terr}=this,nt=this.nt;
    if(iteration===0){
      q.fill(0);this.border.fill(0);
      for(let i=0;i<nt;i++){
        const a=tv[i*3],b=tv[i*3+1],c=tv[i*3+2];
        const p0x=p[a*3],p0y=p[a*3+1],p0z=p[a*3+2];
        const ux=p[b*3]-p0x,uy=p[b*3+1]-p0y,uz=p[b*3+2]-p0z,vx=p[c*3]-p0x,vy=p[c*3+1]-p0y,vz=p[c*3+2]-p0z;
        let nx=fma(uy,vz,-(uz*vy)),ny=fma(uz,vx,-(ux*vz)),nz=fma(ux,vy,-(uy*vx));
        const sq=Math.sqrt(norm2(nx,ny,nz));nx/=sq;ny/=sq;nz/=sq;
        tn[i*3]=nx;tn[i*3+1]=ny;tn[i*3+2]=nz;
        const d=-fma(p0z,nz,fma(p0x,nx,p0y*ny));
        const plane=[nx*nx,nx*ny,nx*nz,nx*d,ny*ny,ny*nz,ny*d,nz*nz,nz*d,d*d];
        for(const v of [a,b,c])for(let k=0;k<10;k++)q[v*10+k]=q[v*10+k]+plane[k];
      }
      const scratch=this.scratch;
      for(let i=0;i<nt;i++){
        for(let j=0;j<3;j++)terr[i*4+j]=this.calculateError(tv[i*3+j],tv[i*3+(j+1)%3],scratch);
        terr[i*4+3]=fmin(terr[i*4],fmin(terr[i*4+1],terr[i*4+2]));
      }
    }
    const {tstart,tcount}=this;
    tstart.fill(0);tcount.fill(0);
    for(let i=0;i<nt*3;i++)tcount[tv[i]]++;
    let ts=0;for(let i=0;i<nv;i++){tstart[i]=ts;ts+=tcount[i];tcount[i]=0;}
    this.rtid=growInt32(this.rtid,nt*3);this.rtv=growInt32(this.rtv,nt*3);this.nrefs=nt*3;
    for(let i=0;i<nt;i++)for(let j=0;j<3;j++){
      const v=tv[i*3+j],slot=tstart[v]+tcount[v];this.rtid[slot]=i;this.rtv[slot]=j;tcount[v]++;
    }
    if(iteration===0){
      const border=this.border;border.fill(0);
      const vcount=[],vids=[];
      for(let i=0;i<nv;i++){
        vcount.length=0;vids.length=0;
        for(let j=0;j<tcount[i];j++){
          const k=this.rtid[tstart[i]+j];
          for(let c=0;c<3;c++){
            const id=tv[k*3+c];let ofs=0;
            while(ofs<vcount.length){if(vids[ofs]===id)break;ofs++;}
            if(ofs===vcount.length){vcount.push(1);vids.push(id);}else vcount[ofs]++;
          }
        }
        for(let j=0;j<vcount.length;j++)if(vcount[j]===1)border[vids[j]]=1;
      }
    }
  }
  compactMesh(){
    const {tv,tdel,tcount,tstart,p}=this;let dst=0;
    tcount.fill(0);
    for(let i=0;i<this.nt;i++)if(!tdel[i]){
      tv[dst*3]=tv[i*3];tv[dst*3+1]=tv[i*3+1];tv[dst*3+2]=tv[i*3+2];tdel[dst]=0;dst++;
      tcount[tv[i*3]]=1;tcount[tv[i*3+1]]=1;tcount[tv[i*3+2]]=1;
    }
    this.nt=dst;dst=0;
    for(let i=0;i<this.nv;i++)if(tcount[i]){
      tstart[i]=dst;p[dst*3]=p[i*3];p[dst*3+1]=p[i*3+1];p[dst*3+2]=p[i*3+2];dst++;
    }
    for(let i=0;i<this.nt*3;i++)tv[i]=tstart[tv[i]];
    this.nv=dst;
  }
  simplify(targetCount,aggressiveness=7,preserveBorder=false,onIteration){
    this.scratch=new Float64Array(3);
    const {tdel,tdirty,terr,tv}=this;
    for(let i=0;i<this.nt;i++)tdel[i]=0;
    const state={deleted:0},triangleCount=this.nt,pt=new Float64Array(3);
    let deleted0=new Uint8Array(16),deleted1=new Uint8Array(16);
    for(let iteration=0;iteration<100;iteration++){
      if(triangleCount-state.deleted<=targetCount)break;
      onIteration?.(iteration,triangleCount-state.deleted);
      if(iteration%5===0)this.updateMesh(iteration);
      for(let i=0;i<this.nt;i++)tdirty[i]=0;
      const threshold=0.000000001*Math.pow(iteration+3,aggressiveness);
      for(let i=0,n=this.nt;i<n;i++){
        if(terr[i*4+3]>threshold)continue;
        if(tdel[i])continue;
        if(tdirty[i])continue;
        for(let j=0;j<3;j++)if(terr[i*4+j]<threshold){
          const i0=tv[i*3+j],i1=tv[i*3+(j+1)%3],border=this.border;
          if(preserveBorder){if(border[i0]||border[i1])continue;}
          else if(border[i0]!==border[i1])continue;
          this.calculateError(i0,i1,pt);
          const px=pt[0],py=pt[1],pz=pt[2];
          // std::vector::resize keeps existing entries; only read entries are rewritten first.
          if(deleted0.length<this.tcount[i0]){const d=new Uint8Array(this.tcount[i0]*2);d.set(deleted0);deleted0=d;}
          if(deleted1.length<this.tcount[i1]){const d=new Uint8Array(this.tcount[i1]*2);d.set(deleted1);deleted1=d;}
          if(this.flipped(px,py,pz,i0,i1,i0,deleted0))continue;
          if(this.flipped(px,py,pz,i1,i0,i1,deleted1))continue;
          const P=this.p,Q=this.q;
          P[i0*3]=px;P[i0*3+1]=py;P[i0*3+2]=pz;
          for(let k=0;k<10;k++)Q[i0*10+k]=Q[i1*10+k]+Q[i0*10+k];
          const tstart=this.nrefs;
          this.updateTriangles(i0,i0,deleted0,state);
          this.updateTriangles(i0,i1,deleted1,state);
          const tcount=this.nrefs-tstart;
          if(tcount<=this.tcount[i0]){
            if(tcount){this.rtid.copyWithin(this.tstart[i0],tstart,tstart+tcount);this.rtv.copyWithin(this.tstart[i0],tstart,tstart+tcount);}
          }else this.tstart[i0]=tstart;
          this.tcount[i0]=tcount;
          break;
        }
        if(triangleCount-state.deleted<=targetCount)break;
      }
    }
    this.compactMesh();
  }
}

function admitSurface(points,triangles){
  if(!(points instanceof Float64Array||points instanceof Float32Array)||points.length%3)throw TypeError('flat F32/F64 xyz points required');
  if(!(triangles instanceof Int32Array||triangles instanceof Uint32Array)||triangles.length%3)throw TypeError('flat I32/U32 triangle indices required');
  const nv=points.length/3;
  for(let i=0;i<triangles.length;i++)if(triangles[i]>=nv||triangles[i]<0)throw RangeError('triangle index outside points');
}

// fast_simplification.simplify(points,triangles,target_reduction|target_count,
// agg=7,preserve_border=False). Points are widened to F64 and U32 indices are
// read as I32, matching the wrapper. Returns F64 points and I32 triangles.
// engine, when given (wasm-simplify.js), runs the same simplify_mesh in place of this port.
export function simplifyMesh(points,triangles,{targetReduction,targetCount,aggressiveness=7,preserveBorder=false,onIteration,engine}={}){
  admitSurface(points,triangles);
  const nFaces=triangles.length/3;
  if(targetReduction&&targetCount)throw Error('specify targetReduction or targetCount, not both');
  if(targetReduction==null&&targetCount==null)throw Error('targetReduction or targetCount required');
  let count=targetCount;
  if(targetReduction!=null){
    if(targetReduction>1||targetReduction<0)throw RangeError('targetReduction must be between 0 and 1');
    count=(1-targetReduction)*nFaces;
  }
  if(count<0)throw RangeError('targetCount must be positive');
  if(count>nFaces)throw RangeError('targetCount must not exceed the face count');
  count=Math.trunc(count);
  if(engine)return engine(points,triangles,count,aggressiveness,preserveBorder,onIteration);
  const s=new FastQuadricSimplifier(points,triangles instanceof Int32Array?triangles:new Int32Array(triangles.buffer,triangles.byteOffset,triangles.length));
  s.simplify(count,aggressiveness,preserveBorder,onIteration);
  return {points:s.p.slice(0,s.nv*3),triangles:s.tv.slice(0,s.nt*3)};
}
