import{BufferAttribute as ot,Vector3 as S,Vector2 as J,Plane as zn,Line3 as G,Triangle as K,Sphere as Cn,Matrix4 as j,Box3 as q,REVISION as En,BackSide as Zn,DoubleSide as Kn,FrontSide as Je,Object3D as Jn,Mesh as je,BufferGeometry as qt,Group as Qn,LineBasicMaterial as Gn,MeshBasicMaterial as ti,Ray as ei,BatchedMesh as ni,RGBAFormat as he,RGFormat as ii,RedFormat as si,RGBAIntegerFormat as Se,RGIntegerFormat as Nn,RedIntegerFormat as oi,DataTexture as De,NearestFilter as vt,IntType as fe,UnsignedIntType as Ht,FloatType as Wt,UnsignedByteType as Qe,UnsignedShortType as ri,ByteType as Ge,ShortType as ci,Vector4 as Ye,Matrix3 as ai}from"./three.core.js";var Un=0,li=1,ui=2,Ts=0,Bs=1,tn=2,de=1.25,Fe=1,st=32,ye=65535,fi=Math.pow(2,-24),be=Symbol("SKIP_GENERATION");function Rn(n){return n.index?n.index.count:n.attributes.position.count}function Bt(n){return Rn(n)/3}function Ln(n,t=ArrayBuffer){return n>65535?new Uint32Array(new t(4*n)):new Uint16Array(new t(2*n))}function di(n,t){if(!n.index){let e=n.attributes.position.count,i=t.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,s=Ln(e,i);n.setIndex(new ot(s,1));for(let c=0;c<e;c++)s[c]=c}}function kn(n,t){let e=Bt(n),i=t||n.drawRange,s=i.start/3,c=(i.start+i.count)/3,o=Math.max(0,s),a=Math.min(e,c)-o;return[{offset:Math.floor(o),count:Math.floor(a)}]}function Vn(n,t){if(!n.groups||!n.groups.length)return kn(n,t);let e=[],i=new Set,s=t||n.drawRange,c=s.start/3,o=(s.start+s.count)/3;for(let r of n.groups){let d=r.start/3,u=(r.start+r.count)/3;i.add(Math.max(c,d)),i.add(Math.min(o,u))}let a=Array.from(i.values()).sort((r,d)=>r-d);for(let r=0;r<a.length-1;r++){let d=a[r],u=a[r+1];e.push({offset:Math.floor(d),count:Math.floor(u-d)})}return e}function pi(n,t){let e=Bt(n),i=Vn(n,t).sort((o,a)=>o.offset-a.offset),s=i[i.length-1];s.count=Math.min(e-s.offset,s.count);let c=0;return i.forEach(({count:o})=>c+=o),e!==c}function ge(n,t,e,i,s){let c=1/0,o=1/0,a=1/0,r=-1/0,d=-1/0,u=-1/0,f=1/0,l=1/0,p=1/0,b=-1/0,g=-1/0,x=-1/0;for(let m=t*6,h=(t+e)*6;m<h;m+=6){let y=n[m+0],v=n[m+1],w=y-v,A=y+v;w<c&&(c=w),A>r&&(r=A),y<f&&(f=y),y>b&&(b=y);let T=n[m+2],_=n[m+3],B=T-_,P=T+_;B<o&&(o=B),P>d&&(d=P),T<l&&(l=T),T>g&&(g=T);let I=n[m+4],M=n[m+5],D=I-M,F=I+M;D<a&&(a=D),F>u&&(u=F),I<p&&(p=I),I>x&&(x=I)}i[0]=c,i[1]=o,i[2]=a,i[3]=r,i[4]=d,i[5]=u,s[0]=f,s[1]=l,s[2]=p,s[3]=b,s[4]=g,s[5]=x}function hi(n,t=null,e=null,i=null){let s=n.attributes.position,c=n.index?n.index.array:null,o=Bt(n),a=s.normalized,r;t===null?(r=new Float32Array(o*6),e=0,i=o):(r=t,e=e||0,i=i||o);let d=s.array,u=s.offset||0,f=3;s.isInterleavedBufferAttribute&&(f=s.data.stride);let l=["getX","getY","getZ"];for(let p=e;p<e+i;p++){let b=p*3,g=p*6,x=b+0,m=b+1,h=b+2;c&&(x=c[x],m=c[m],h=c[h]),a||(x=x*f+u,m=m*f+u,h=h*f+u);for(let y=0;y<3;y++){let v,w,A;a?(v=s[l[y]](x),w=s[l[y]](m),A=s[l[y]](h)):(v=d[x+y],w=d[m+y],A=d[h+y]);let T=v;w<T&&(T=w),A<T&&(T=A);let _=v;w>_&&(_=w),A>_&&(_=A);let B=(_-T)/2,P=y*2;r[g+P+0]=T+B,r[g+P+1]=B+(Math.abs(T)+B)*fi}}return r}function C(n,t,e){return e.min.x=t[n],e.min.y=t[n+1],e.min.z=t[n+2],e.max.x=t[n+3],e.max.y=t[n+4],e.max.z=t[n+5],e}function en(n){let t=-1,e=-1/0;for(let i=0;i<3;i++){let s=n[i+3]-n[i];s>e&&(e=s,t=i)}return t}function nn(n,t){t.set(n)}function sn(n,t,e){let i,s;for(let c=0;c<3;c++){let o=c+3;i=n[c],s=t[c],e[c]=i<s?i:s,i=n[o],s=t[o],e[o]=i>s?i:s}}function Yt(n,t,e){for(let i=0;i<3;i++){let s=t[n+2*i],c=t[n+2*i+1],o=s-c,a=s+c;o<e[i]&&(e[i]=o),a>e[i+3]&&(e[i+3]=a)}}function Pt(n){let t=n[3]-n[0],e=n[4]-n[1],i=n[5]-n[2];return 2*(t*e+e*i+i*t)}var Q=32,mi=(n,t)=>n.candidate-t.candidate,et=new Array(Q).fill().map(()=>({count:0,bounds:new Float32Array(6),rightCacheBounds:new Float32Array(6),leftCacheBounds:new Float32Array(6),candidate:0})),Zt=new Float32Array(6);function yi(n,t,e,i,s,c){let o=-1,a=0;if(c===Un)o=en(t),o!==-1&&(a=(t[o]+t[o+3])/2);else if(c===li)o=en(n),o!==-1&&(a=xi(e,i,s,o));else if(c===ui){let r=Pt(n),d=de*s,u=i*6,f=(i+s)*6;for(let l=0;l<3;l++){let p=t[l],x=(t[l+3]-p)/Q;if(s<Q/4){let m=[...et];m.length=s;let h=0;for(let v=u;v<f;v+=6,h++){let w=m[h];w.candidate=e[v+2*l],w.count=0;let{bounds:A,leftCacheBounds:T,rightCacheBounds:_}=w;for(let B=0;B<3;B++)_[B]=1/0,_[B+3]=-1/0,T[B]=1/0,T[B+3]=-1/0,A[B]=1/0,A[B+3]=-1/0;Yt(v,e,A)}m.sort(mi);let y=s;for(let v=0;v<y;v++){let w=m[v];for(;v+1<y&&m[v+1].candidate===w.candidate;)m.splice(v+1,1),y--}for(let v=u;v<f;v+=6){let w=e[v+2*l];for(let A=0;A<y;A++){let T=m[A];w>=T.candidate?Yt(v,e,T.rightCacheBounds):(Yt(v,e,T.leftCacheBounds),T.count++)}}for(let v=0;v<y;v++){let w=m[v],A=w.count,T=s-w.count,_=w.leftCacheBounds,B=w.rightCacheBounds,P=0;A!==0&&(P=Pt(_)/r);let I=0;T!==0&&(I=Pt(B)/r);let M=Fe+de*(P*A+I*T);M<d&&(o=l,d=M,a=w.candidate)}}else{for(let y=0;y<Q;y++){let v=et[y];v.count=0,v.candidate=p+x+y*x;let w=v.bounds;for(let A=0;A<3;A++)w[A]=1/0,w[A+3]=-1/0}for(let y=u;y<f;y+=6){let A=~~((e[y+2*l]-p)/x);A>=Q&&(A=Q-1);let T=et[A];T.count++,Yt(y,e,T.bounds)}let m=et[Q-1];nn(m.bounds,m.rightCacheBounds);for(let y=Q-2;y>=0;y--){let v=et[y],w=et[y+1];sn(v.bounds,w.rightCacheBounds,v.rightCacheBounds)}let h=0;for(let y=0;y<Q-1;y++){let v=et[y],w=v.count,A=v.bounds,_=et[y+1].rightCacheBounds;w!==0&&(h===0?nn(A,Zt):sn(A,Zt,Zt)),h+=w;let B=0,P=0;h!==0&&(B=Pt(Zt)/r);let I=s-h;I!==0&&(P=Pt(_)/r);let M=Fe+de*(B*h+P*I);M<d&&(o=l,d=M,a=v.candidate)}}}}else console.warn(`MeshBVH: Invalid build strategy value ${c} used.`);return{axis:o,pos:a}}function xi(n,t,e,i){let s=0;for(let c=t,o=t+e;c<o;c++)s+=n[c*6+i*2];return s/e}var Xt=class{constructor(){this.boundingData=new Float32Array(6)}};function bi(n,t,e,i,s,c){let o=i,a=i+s-1,r=c.pos,d=c.axis*2;for(;;){for(;o<=a&&e[o*6+d]<r;)o++;for(;o<=a&&e[a*6+d]>=r;)a--;if(o<a){for(let u=0;u<3;u++){let f=t[o*3+u];t[o*3+u]=t[a*3+u],t[a*3+u]=f}for(let u=0;u<6;u++){let f=e[o*6+u];e[o*6+u]=e[a*6+u],e[a*6+u]=f}o++,a--}else return o}}function gi(n,t,e,i,s,c){let o=i,a=i+s-1,r=c.pos,d=c.axis*2;for(;;){for(;o<=a&&e[o*6+d]<r;)o++;for(;o<=a&&e[a*6+d]>=r;)a--;if(o<a){let u=n[o];n[o]=n[a],n[a]=u;for(let f=0;f<6;f++){let l=e[o*6+f];e[o*6+f]=e[a*6+f],e[a*6+f]=l}o++,a--}else return o}}function k(n,t){return t[n+15]===65535}function V(n,t){return t[n+6]}function H(n,t){return t[n+14]}function O(n){return n+8}function W(n,t){return t[n+6]}function Ze(n,t){return t[n+7]}var qn,kt,pe,Hn,wi=Math.pow(2,32);function ze(n){return"count"in n?1:1+ze(n.left)+ze(n.right)}function vi(n,t,e){return qn=new Float32Array(e),kt=new Uint32Array(e),pe=new Uint16Array(e),Hn=new Uint8Array(e),Ce(n,t)}function Ce(n,t){let e=n/4,i=n/2,s="count"in t,c=t.boundingData;for(let o=0;o<6;o++)qn[e+o]=c[o];if(s)if(t.buffer){let o=t.buffer;Hn.set(new Uint8Array(o),n);for(let a=n,r=n+o.byteLength;a<r;a+=st){let d=a/2;k(d,pe)||(kt[a/4+6]+=e)}return n+o.byteLength}else{let o=t.offset,a=t.count;return kt[e+6]=o,pe[i+14]=a,pe[i+15]=ye,n+st}else{let o=t.left,a=t.right,r=t.splitAxis,d;if(d=Ce(n+st,o),d/4>wi)throw new Error("MeshBVH: Cannot store child pointer greater than 32 bits.");return kt[e+6]=d/4,d=Ce(d,a),kt[e+7]=r,d}}function Ai(n,t){let e=(n.index?n.index.count:n.attributes.position.count)/3,i=e>2**16,s=i?4:2,c=t?new SharedArrayBuffer(e*s):new ArrayBuffer(e*s),o=i?new Uint32Array(c):new Uint16Array(c);for(let a=0,r=o.length;a<r;a++)o[a]=a;return o}function Ti(n,t,e,i,s){let{maxDepth:c,verbose:o,maxLeafTris:a,strategy:r,onProgress:d,indirect:u}=s,f=n._indirectBuffer,l=n.geometry,p=l.index?l.index.array:null,b=u?gi:bi,g=Bt(l),x=new Float32Array(6),m=!1,h=new Xt;return ge(t,e,i,h.boundingData,x),v(h,e,i,x),h;function y(w){d&&d(w/g)}function v(w,A,T,_=null,B=0){if(!m&&B>=c&&(m=!0,o&&(console.warn(`MeshBVH: Max depth of ${c} reached when generating BVH. Consider increasing maxDepth.`),console.warn(l))),T<=a||B>=c)return y(A+T),w.offset=A,w.count=T,w;let P=yi(w.boundingData,_,t,A,T,r);if(P.axis===-1)return y(A+T),w.offset=A,w.count=T,w;let I=b(f,p,t,A,T,P);if(I===A||I===A+T)y(A+T),w.offset=A,w.count=T;else{w.splitAxis=P.axis;let M=new Xt,D=A,F=I-A;w.left=M,ge(t,D,F,M.boundingData,x),v(M,D,F,x,B+1);let z=new Xt,N=I,tt=T-F;w.right=z,ge(t,N,tt,z.boundingData,x),v(z,N,tt,x,B+1)}return w}}function Bi(n,t){let e=n.geometry;t.indirect&&(n._indirectBuffer=Ai(e,t.useSharedArrayBuffer),pi(e,t.range)&&!t.verbose&&console.warn('MeshBVH: Provided geometry contains groups or a range that do not fully span the vertex contents while using the "indirect" option. BVH may incorrectly report intersections on unrendered portions of the geometry.')),n._indirectBuffer||di(e,t);let i=t.useSharedArrayBuffer?SharedArrayBuffer:ArrayBuffer,s=hi(e),c=t.indirect?kn(e,t.range):Vn(e,t.range);n._roots=c.map(o=>{let a=Ti(n,s,o.offset,o.count,t),r=ze(a),d=new i(st*r);return vi(0,a,d),d})}var Y=class{constructor(){this.min=1/0,this.max=-1/0}setFromPointsField(t,e){let i=1/0,s=-1/0;for(let c=0,o=t.length;c<o;c++){let r=t[c][e];i=r<i?r:i,s=r>s?r:s}this.min=i,this.max=s}setFromPoints(t,e){let i=1/0,s=-1/0;for(let c=0,o=e.length;c<o;c++){let a=e[c],r=t.dot(a);i=r<i?r:i,s=r>s?r:s}this.min=i,this.max=s}isSeparated(t){return this.min>t.max||t.min>this.max}};Y.prototype.setFromBox=(function(){let n=new S;return function(e,i){let s=i.min,c=i.max,o=1/0,a=-1/0;for(let r=0;r<=1;r++)for(let d=0;d<=1;d++)for(let u=0;u<=1;u++){n.x=s.x*r+c.x*(1-r),n.y=s.y*d+c.y*(1-d),n.z=s.z*u+c.z*(1-u);let f=e.dot(n);o=Math.min(f,o),a=Math.max(f,a)}this.min=o,this.max=a}})();var _s=(function(){let n=new Y;return function(e,i){let s=e.points,c=e.satAxes,o=e.satBounds,a=i.points,r=i.satAxes,d=i.satBounds;for(let u=0;u<3;u++){let f=o[u],l=c[u];if(n.setFromPoints(l,a),f.isSeparated(n))return!1}for(let u=0;u<3;u++){let f=d[u],l=r[u];if(n.setFromPoints(l,s),f.isSeparated(n))return!1}}})(),_i=(function(){let n=new S,t=new S,e=new S;return function(s,c,o){let a=s.start,r=n,d=c.start,u=t;e.subVectors(a,d),n.subVectors(s.end,s.start),t.subVectors(c.end,c.start);let f=e.dot(u),l=u.dot(r),p=u.dot(u),b=e.dot(r),x=r.dot(r)*p-l*l,m,h;x!==0?m=(f*l-b*p)/x:m=0,h=(f+m*l)/p,o.x=m,o.y=h}})(),Ke=(function(){let n=new J,t=new S,e=new S;return function(s,c,o,a){_i(s,c,n);let r=n.x,d=n.y;if(r>=0&&r<=1&&d>=0&&d<=1){s.at(r,o),c.at(d,a);return}else if(r>=0&&r<=1){d<0?c.at(0,a):c.at(1,a),s.closestPointToPoint(a,!0,o);return}else if(d>=0&&d<=1){r<0?s.at(0,o):s.at(1,o),c.closestPointToPoint(o,!0,a);return}else{let u;r<0?u=s.start:u=s.end;let f;d<0?f=c.start:f=c.end;let l=t,p=e;if(s.closestPointToPoint(f,!0,t),c.closestPointToPoint(u,!0,e),l.distanceToSquared(f)<=p.distanceToSquared(u)){o.copy(l),a.copy(f);return}else{o.copy(u),a.copy(p);return}}}})(),Mi=(function(){let n=new S,t=new S,e=new zn,i=new G;return function(c,o){let{radius:a,center:r}=c,{a:d,b:u,c:f}=o;if(i.start=d,i.end=u,i.closestPointToPoint(r,!0,n).distanceTo(r)<=a||(i.start=d,i.end=f,i.closestPointToPoint(r,!0,n).distanceTo(r)<=a)||(i.start=u,i.end=f,i.closestPointToPoint(r,!0,n).distanceTo(r)<=a))return!0;let g=o.getPlane(e);if(Math.abs(g.distanceToPoint(r))<=a){let m=g.projectPoint(r,t);if(o.containsPoint(m))return!0}return!1}})(),Pi=1e-15;function we(n){return Math.abs(n)<Pi}var X=class extends K{constructor(...t){super(...t),this.isExtendedTriangle=!0,this.satAxes=new Array(4).fill().map(()=>new S),this.satBounds=new Array(4).fill().map(()=>new Y),this.points=[this.a,this.b,this.c],this.sphere=new Cn,this.plane=new zn,this.needsUpdate=!0}intersectsSphere(t){return Mi(t,this)}update(){let t=this.a,e=this.b,i=this.c,s=this.points,c=this.satAxes,o=this.satBounds,a=c[0],r=o[0];this.getNormal(a),r.setFromPoints(a,s);let d=c[1],u=o[1];d.subVectors(t,e),u.setFromPoints(d,s);let f=c[2],l=o[2];f.subVectors(e,i),l.setFromPoints(f,s);let p=c[3],b=o[3];p.subVectors(i,t),b.setFromPoints(p,s),this.sphere.setFromPoints(this.points),this.plane.setFromNormalAndCoplanarPoint(a,t),this.needsUpdate=!1}};X.prototype.closestPointToSegment=(function(){let n=new S,t=new S,e=new G;return function(s,c=null,o=null){let{start:a,end:r}=s,d=this.points,u,f=1/0;for(let l=0;l<3;l++){let p=(l+1)%3;e.start.copy(d[l]),e.end.copy(d[p]),Ke(e,s,n,t),u=n.distanceToSquared(t),u<f&&(f=u,c&&c.copy(n),o&&o.copy(t))}return this.closestPointToPoint(a,n),u=a.distanceToSquared(n),u<f&&(f=u,c&&c.copy(n),o&&o.copy(a)),this.closestPointToPoint(r,n),u=r.distanceToSquared(n),u<f&&(f=u,c&&c.copy(n),o&&o.copy(r)),Math.sqrt(f)}})();X.prototype.intersectsTriangle=(function(){let n=new X,t=new Array(3),e=new Array(3),i=new Y,s=new Y,c=new S,o=new S,a=new S,r=new S,d=new S,u=new G,f=new G,l=new G,p=new S;function b(g,x,m){let h=g.points,y=0,v=-1;for(let w=0;w<3;w++){let{start:A,end:T}=u;A.copy(h[w]),T.copy(h[(w+1)%3]),u.delta(o);let _=we(x.distanceToPoint(A));if(we(x.normal.dot(o))&&_){m.copy(u),y=2;break}let B=x.intersectLine(u,p);if(!B&&_&&p.copy(A),(B||_)&&!we(p.distanceTo(T))){if(y<=1)(y===1?m.start:m.end).copy(p),_&&(v=y);else if(y>=2){(v===1?m.start:m.end).copy(p),y=2;break}if(y++,y===2&&v===-1)break}}return y}return function(x,m=null,h=!1){this.needsUpdate&&this.update(),x.isExtendedTriangle?x.needsUpdate&&x.update():(n.copy(x),n.update(),x=n);let y=this.plane,v=x.plane;if(Math.abs(y.normal.dot(v.normal))>1-1e-10){let w=this.satBounds,A=this.satAxes;e[0]=x.a,e[1]=x.b,e[2]=x.c;for(let B=0;B<4;B++){let P=w[B],I=A[B];if(i.setFromPoints(I,e),P.isSeparated(i))return!1}let T=x.satBounds,_=x.satAxes;t[0]=this.a,t[1]=this.b,t[2]=this.c;for(let B=0;B<4;B++){let P=T[B],I=_[B];if(i.setFromPoints(I,t),P.isSeparated(i))return!1}for(let B=0;B<4;B++){let P=A[B];for(let I=0;I<4;I++){let M=_[I];if(c.crossVectors(P,M),i.setFromPoints(c,t),s.setFromPoints(c,e),i.isSeparated(s))return!1}}return m&&(h||console.warn("ExtendedTriangle.intersectsTriangle: Triangles are coplanar which does not support an output edge. Setting edge to 0, 0, 0."),m.start.set(0,0,0),m.end.set(0,0,0)),!0}else{let w=b(this,v,f);if(w===1&&x.containsPoint(f.end))return m&&(m.start.copy(f.end),m.end.copy(f.end)),!0;if(w!==2)return!1;let A=b(x,y,l);if(A===1&&this.containsPoint(l.end))return m&&(m.start.copy(l.end),m.end.copy(l.end)),!0;if(A!==2)return!1;if(f.delta(a),l.delta(r),a.dot(r)<0){let D=l.start;l.start=l.end,l.end=D}let T=f.start.dot(a),_=f.end.dot(a),B=l.start.dot(a),P=l.end.dot(a),I=_<B,M=T<P;return T!==P&&B!==_&&I===M?!1:(m&&(d.subVectors(f.start,l.start),d.dot(a)>0?m.start.copy(f.start):m.start.copy(l.start),d.subVectors(f.end,l.end),d.dot(a)<0?m.end.copy(f.end):m.end.copy(l.end)),!0)}}})();X.prototype.distanceToPoint=(function(){let n=new S;return function(e){return this.closestPointToPoint(e,n),e.distanceTo(n)}})();X.prototype.distanceToTriangle=(function(){let n=new S,t=new S,e=["a","b","c"],i=new G,s=new G;return function(o,a=null,r=null){let d=a||r?i:null;if(this.intersectsTriangle(o,d))return(a||r)&&(a&&d.getCenter(a),r&&d.getCenter(r)),0;let u=1/0;for(let f=0;f<3;f++){let l,p=e[f],b=o[p];this.closestPointToPoint(b,n),l=b.distanceToSquared(n),l<u&&(u=l,a&&a.copy(n),r&&r.copy(b));let g=this[p];o.closestPointToPoint(g,n),l=g.distanceToSquared(n),l<u&&(u=l,a&&a.copy(g),r&&r.copy(n))}for(let f=0;f<3;f++){let l=e[f],p=e[(f+1)%3];i.set(this[l],this[p]);for(let b=0;b<3;b++){let g=e[b],x=e[(b+1)%3];s.set(o[g],o[x]),Ke(i,s,n,t);let m=n.distanceToSquared(t);m<u&&(u=m,a&&a.copy(n),r&&r.copy(t))}}return Math.sqrt(u)}})();var L=class{constructor(t,e,i){this.isOrientedBox=!0,this.min=new S,this.max=new S,this.matrix=new j,this.invMatrix=new j,this.points=new Array(8).fill().map(()=>new S),this.satAxes=new Array(3).fill().map(()=>new S),this.satBounds=new Array(3).fill().map(()=>new Y),this.alignedSatBounds=new Array(3).fill().map(()=>new Y),this.needsUpdate=!1,t&&this.min.copy(t),e&&this.max.copy(e),i&&this.matrix.copy(i)}set(t,e,i){this.min.copy(t),this.max.copy(e),this.matrix.copy(i),this.needsUpdate=!0}copy(t){this.min.copy(t.min),this.max.copy(t.max),this.matrix.copy(t.matrix),this.needsUpdate=!0}};L.prototype.update=(function(){return function(){let t=this.matrix,e=this.min,i=this.max,s=this.points;for(let d=0;d<=1;d++)for(let u=0;u<=1;u++)for(let f=0;f<=1;f++){let l=1*d|2*u|4*f,p=s[l];p.x=d?i.x:e.x,p.y=u?i.y:e.y,p.z=f?i.z:e.z,p.applyMatrix4(t)}let c=this.satBounds,o=this.satAxes,a=s[0];for(let d=0;d<3;d++){let u=o[d],f=c[d],l=1<<d,p=s[l];u.subVectors(a,p),f.setFromPoints(u,s)}let r=this.alignedSatBounds;r[0].setFromPointsField(s,"x"),r[1].setFromPointsField(s,"y"),r[2].setFromPointsField(s,"z"),this.invMatrix.copy(this.matrix).invert(),this.needsUpdate=!1}})();L.prototype.intersectsBox=(function(){let n=new Y;return function(e){this.needsUpdate&&this.update();let i=e.min,s=e.max,c=this.satBounds,o=this.satAxes,a=this.alignedSatBounds;if(n.min=i.x,n.max=s.x,a[0].isSeparated(n)||(n.min=i.y,n.max=s.y,a[1].isSeparated(n))||(n.min=i.z,n.max=s.z,a[2].isSeparated(n)))return!1;for(let r=0;r<3;r++){let d=o[r],u=c[r];if(n.setFromBox(d,e),u.isSeparated(n))return!1}return!0}})();L.prototype.intersectsTriangle=(function(){let n=new X,t=new Array(3),e=new Y,i=new Y,s=new S;return function(o){this.needsUpdate&&this.update(),o.isExtendedTriangle?o.needsUpdate&&o.update():(n.copy(o),n.update(),o=n);let a=this.satBounds,r=this.satAxes;t[0]=o.a,t[1]=o.b,t[2]=o.c;for(let l=0;l<3;l++){let p=a[l],b=r[l];if(e.setFromPoints(b,t),p.isSeparated(e))return!1}let d=o.satBounds,u=o.satAxes,f=this.points;for(let l=0;l<3;l++){let p=d[l],b=u[l];if(e.setFromPoints(b,f),p.isSeparated(e))return!1}for(let l=0;l<3;l++){let p=r[l];for(let b=0;b<4;b++){let g=u[b];if(s.crossVectors(p,g),e.setFromPoints(s,t),i.setFromPoints(s,f),e.isSeparated(i))return!1}}return!0}})();L.prototype.closestPointToPoint=(function(){return function(t,e){return this.needsUpdate&&this.update(),e.copy(t).applyMatrix4(this.invMatrix).clamp(this.min,this.max).applyMatrix4(this.matrix),e}})();L.prototype.distanceToPoint=(function(){let n=new S;return function(e){return this.closestPointToPoint(e,n),e.distanceTo(n)}})();L.prototype.distanceToBox=(function(){let n=["x","y","z"],t=new Array(12).fill().map(()=>new G),e=new Array(12).fill().map(()=>new G),i=new S,s=new S;return function(o,a=0,r=null,d=null){if(this.needsUpdate&&this.update(),this.intersectsBox(o))return(r||d)&&(o.getCenter(s),this.closestPointToPoint(s,i),o.closestPointToPoint(i,s),r&&r.copy(i),d&&d.copy(s)),0;let u=a*a,f=o.min,l=o.max,p=this.points,b=1/0;for(let x=0;x<8;x++){let m=p[x];s.copy(m).clamp(f,l);let h=m.distanceToSquared(s);if(h<b&&(b=h,r&&r.copy(m),d&&d.copy(s),h<u))return Math.sqrt(h)}let g=0;for(let x=0;x<3;x++)for(let m=0;m<=1;m++)for(let h=0;h<=1;h++){let y=(x+1)%3,v=(x+2)%3,w=m<<y|h<<v,A=1<<x|m<<y|h<<v,T=p[w],_=p[A];t[g].set(T,_);let P=n[x],I=n[y],M=n[v],D=e[g],F=D.start,z=D.end;F[P]=f[P],F[I]=m?f[I]:l[I],F[M]=h?f[M]:l[I],z[P]=l[P],z[I]=m?f[I]:l[I],z[M]=h?f[M]:l[I],g++}for(let x=0;x<=1;x++)for(let m=0;m<=1;m++)for(let h=0;h<=1;h++){s.x=x?l.x:f.x,s.y=m?l.y:f.y,s.z=h?l.z:f.z,this.closestPointToPoint(s,i);let y=s.distanceToSquared(i);if(y<b&&(b=y,r&&r.copy(i),d&&d.copy(s),y<u))return Math.sqrt(y)}for(let x=0;x<12;x++){let m=t[x];for(let h=0;h<12;h++){let y=e[h];Ke(m,y,i,s);let v=i.distanceToSquared(s);if(v<b&&(b=v,r&&r.copy(i),d&&d.copy(s),v<u))return Math.sqrt(v)}}return Math.sqrt(b)}})();var $t=class{constructor(t){this._getNewPrimitive=t,this._primitives=[]}getPrimitive(){let t=this._primitives;return t.length===0?this._getNewPrimitive():t.pop()}releasePrimitive(t){this._primitives.push(t)}},Ee=class extends $t{constructor(){super(()=>new X)}},$=new Ee,Ne=class{constructor(){this.float32Array=null,this.uint16Array=null,this.uint32Array=null;let t=[],e=null;this.setBuffer=i=>{e&&t.push(e),e=i,this.float32Array=new Float32Array(i),this.uint16Array=new Uint16Array(i),this.uint32Array=new Uint32Array(i)},this.clearBuffer=()=>{e=null,this.float32Array=null,this.uint16Array=null,this.uint32Array=null,t.length!==0&&this.setBuffer(t.pop())}}},E=new Ne,it,At,pt=[],Kt=new $t(()=>new q);function Ii(n,t,e,i,s,c){it=Kt.getPrimitive(),At=Kt.getPrimitive(),pt.push(it,At),E.setBuffer(n._roots[t]);let o=Ue(0,n.geometry,e,i,s,c);E.clearBuffer(),Kt.releasePrimitive(it),Kt.releasePrimitive(At),pt.pop(),pt.pop();let a=pt.length;return a>0&&(At=pt[a-1],it=pt[a-2]),o}function Ue(n,t,e,i,s=null,c=0,o=0){let{float32Array:a,uint16Array:r,uint32Array:d}=E,u=n*2;if(k(u,r)){let l=V(n,d),p=H(u,r);return C(n,a,it),i(l,p,!1,o,c+n,it)}else{let P=function(M){let{uint16Array:D,uint32Array:F}=E,z=M*2;for(;!k(z,D);)M=O(M),z=M*2;return V(M,F)},I=function(M){let{uint16Array:D,uint32Array:F}=E,z=M*2;for(;!k(z,D);)M=W(M,F),z=M*2;return V(M,F)+H(z,D)},l=O(n),p=W(n,d),b=l,g=p,x,m,h,y;if(s&&(h=it,y=At,C(b,a,h),C(g,a,y),x=s(h),m=s(y),m<x)){b=p,g=l;let M=x;x=m,m=M,h=y}h||(h=it,C(b,a,h));let v=k(b*2,r),w=e(h,v,x,o+1,c+b),A;if(w===tn){let M=P(b),F=I(b)-M;A=i(M,F,!0,o+1,c+b,h)}else A=w&&Ue(b,t,e,i,s,c,o+1);if(A)return!0;y=At,C(g,a,y);let T=k(g*2,r),_=e(y,T,m,o+1,c+g),B;if(_===tn){let M=P(g),F=I(g)-M;B=i(M,F,!0,o+1,c+g,y)}else B=_&&Ue(g,t,e,i,s,c,o+1);return!!B}}var It=new S,ve=new S;function Si(n,t,e={},i=0,s=1/0){let c=i*i,o=s*s,a=1/0,r=null;if(n.shapecast({boundsTraverseOrder:u=>(It.copy(t).clamp(u.min,u.max),It.distanceToSquared(t)),intersectsBounds:(u,f,l)=>l<a&&l<o,intersectsTriangle:(u,f)=>{u.closestPointToPoint(t,It);let l=t.distanceToSquared(It);return l<a&&(ve.copy(It),a=l,r=f),l<c}}),a===1/0)return null;let d=Math.sqrt(a);return e.point?e.point.copy(ve):e.point=ve.clone(),e.distance=d,e.faceIndex=r,e}var Di=parseInt(En)>=169,ct=new S,at=new S,lt=new S,Jt=new J,Qt=new J,Gt=new J,on=new S,rn=new S,cn=new S,St=new S;function Fi(n,t,e,i,s,c,o,a){let r;if(c===Zn?r=n.intersectTriangle(i,e,t,!0,s):r=n.intersectTriangle(t,e,i,c!==Kn,s),r===null)return null;let d=n.origin.distanceTo(s);return d<o||d>a?null:{distance:d,point:s.clone()}}function zi(n,t,e,i,s,c,o,a,r,d,u){ct.fromBufferAttribute(t,c),at.fromBufferAttribute(t,o),lt.fromBufferAttribute(t,a);let f=Fi(n,ct,at,lt,St,r,d,u);if(f){let l=new S;K.getBarycoord(St,ct,at,lt,l),i&&(Jt.fromBufferAttribute(i,c),Qt.fromBufferAttribute(i,o),Gt.fromBufferAttribute(i,a),f.uv=K.getInterpolation(St,ct,at,lt,Jt,Qt,Gt,new J)),s&&(Jt.fromBufferAttribute(s,c),Qt.fromBufferAttribute(s,o),Gt.fromBufferAttribute(s,a),f.uv1=K.getInterpolation(St,ct,at,lt,Jt,Qt,Gt,new J)),e&&(on.fromBufferAttribute(e,c),rn.fromBufferAttribute(e,o),cn.fromBufferAttribute(e,a),f.normal=K.getInterpolation(St,ct,at,lt,on,rn,cn,new S),f.normal.dot(n.direction)>0&&f.normal.multiplyScalar(-1));let p={a:c,b:o,c:a,normal:new S,materialIndex:0};K.getNormal(ct,at,lt,p.normal),f.face=p,f.faceIndex=c,Di&&(f.barycoord=l)}return f}function xe(n,t,e,i,s,c,o){let a=i*3,r=a+0,d=a+1,u=a+2,f=n.index;n.index&&(r=f.getX(r),d=f.getX(d),u=f.getX(u));let{position:l,normal:p,uv:b,uv1:g}=n.attributes,x=zi(e,l,p,b,g,r,d,u,t,c,o);return x?(x.faceIndex=i,s&&s.push(x),x):null}function U(n,t,e,i){let s=n.a,c=n.b,o=n.c,a=t,r=t+1,d=t+2;e&&(a=e.getX(a),r=e.getX(r),d=e.getX(d)),s.x=i.getX(a),s.y=i.getY(a),s.z=i.getZ(a),c.x=i.getX(r),c.y=i.getY(r),c.z=i.getZ(r),o.x=i.getX(d),o.y=i.getY(d),o.z=i.getZ(d)}var Dt=new S,Ft=new S,zt=new S,an=new J,ln=new J,un=new J;function Ms(n,t,e,i){let s=t.getIndex().array,c=t.getAttribute("position"),o=t.getAttribute("uv"),a=s[e*3],r=s[e*3+1],d=s[e*3+2];Dt.fromBufferAttribute(c,a),Ft.fromBufferAttribute(c,r),zt.fromBufferAttribute(c,d);let u=0,f=t.groups,l=e*3;for(let g=0,x=f.length;g<x;g++){let m=f[g],{start:h,count:y}=m;if(l>=h&&l<h+y){u=m.materialIndex;break}}let p=i&&i.barycoord?i.barycoord:new S;K.getBarycoord(n,Dt,Ft,zt,p);let b=null;return o&&(an.fromBufferAttribute(o,a),ln.fromBufferAttribute(o,r),un.fromBufferAttribute(o,d),i&&i.uv?b=i.uv:b=new J,K.getInterpolation(n,Dt,Ft,zt,an,ln,un,b)),i?(i.face||(i.face={}),i.face.a=a,i.face.b=r,i.face.c=d,i.face.materialIndex=u,i.face.normal||(i.face.normal=new S),K.getNormal(Dt,Ft,zt,i.face.normal),b&&(i.uv=b),i.barycoord=p,i):{face:{a,b:r,c:d,materialIndex:u,normal:K.getNormal(Dt,Ft,zt,new S)},uv:b,barycoord:p}}function Ci(n,t,e,i,s,c,o,a){let{geometry:r,_indirectBuffer:d}=n;for(let u=i,f=i+s;u<f;u++)xe(r,t,e,u,c,o,a)}function Ei(n,t,e,i,s,c,o){let{geometry:a,_indirectBuffer:r}=n,d=1/0,u=null;for(let f=i,l=i+s;f<l;f++){let p;p=xe(a,t,e,f,null,c,o),p&&p.distance<d&&(u=p,d=p.distance)}return u}function Ni(n,t,e,i,s,c,o){let{geometry:a}=e,{index:r}=a,d=a.attributes.position;for(let u=n,f=t+n;u<f;u++){let l;if(l=u,U(o,l*3,r,d),o.needsUpdate=!0,i(o,l,s,c))return!0}return!1}function Ui(n,t=null){t&&Array.isArray(t)&&(t=new Set(t));let e=n.geometry,i=e.index?e.index.array:null,s=e.attributes.position,c,o,a,r,d=0,u=n._roots;for(let l=0,p=u.length;l<p;l++)c=u[l],o=new Uint32Array(c),a=new Uint16Array(c),r=new Float32Array(c),f(0,d),d+=c.byteLength;function f(l,p,b=!1){let g=l*2;if(a[g+15]===ye){let m=o[l+6],h=a[g+14],y=1/0,v=1/0,w=1/0,A=-1/0,T=-1/0,_=-1/0;for(let B=3*m,P=3*(m+h);B<P;B++){let I=i[B],M=s.getX(I),D=s.getY(I),F=s.getZ(I);M<y&&(y=M),M>A&&(A=M),D<v&&(v=D),D>T&&(T=D),F<w&&(w=F),F>_&&(_=F)}return r[l+0]!==y||r[l+1]!==v||r[l+2]!==w||r[l+3]!==A||r[l+4]!==T||r[l+5]!==_?(r[l+0]=y,r[l+1]=v,r[l+2]=w,r[l+3]=A,r[l+4]=T,r[l+5]=_,!0):!1}else{let m=l+8,h=o[l+6],y=m+p,v=h+p,w=b,A=!1,T=!1;t?w||(A=t.has(y),T=t.has(v),w=!A&&!T):(A=!0,T=!0);let _=w||A,B=w||T,P=!1;_&&(P=f(m,p,w));let I=!1;B&&(I=f(h,p,w));let M=P||I;if(M)for(let D=0;D<3;D++){let F=m+D,z=h+D,N=r[F],tt=r[F+3],_t=r[z],Mt=r[z+3];r[l+D]=N<_t?N:_t,r[l+D+3]=tt>Mt?tt:Mt}return M}}}function rt(n,t,e,i,s){let c,o,a,r,d,u,f=1/e.direction.x,l=1/e.direction.y,p=1/e.direction.z,b=e.origin.x,g=e.origin.y,x=e.origin.z,m=t[n],h=t[n+3],y=t[n+1],v=t[n+3+1],w=t[n+2],A=t[n+3+2];return f>=0?(c=(m-b)*f,o=(h-b)*f):(c=(h-b)*f,o=(m-b)*f),l>=0?(a=(y-g)*l,r=(v-g)*l):(a=(v-g)*l,r=(y-g)*l),c>r||a>o||((a>c||isNaN(c))&&(c=a),(r<o||isNaN(o))&&(o=r),p>=0?(d=(w-x)*p,u=(A-x)*p):(d=(A-x)*p,u=(w-x)*p),c>u||d>o)?!1:((d>c||c!==c)&&(c=d),(u<o||o!==o)&&(o=u),c<=s&&o>=i)}function Ri(n,t,e,i,s,c,o,a){let{geometry:r,_indirectBuffer:d}=n;for(let u=i,f=i+s;u<f;u++){let l=d?d[u]:u;xe(r,t,e,l,c,o,a)}}function Li(n,t,e,i,s,c,o){let{geometry:a,_indirectBuffer:r}=n,d=1/0,u=null;for(let f=i,l=i+s;f<l;f++){let p;p=xe(a,t,e,r?r[f]:f,null,c,o),p&&p.distance<d&&(u=p,d=p.distance)}return u}function ki(n,t,e,i,s,c,o){let{geometry:a}=e,{index:r}=a,d=a.attributes.position;for(let u=n,f=t+n;u<f;u++){let l;if(l=e.resolveTriangleIndex(u),U(o,l*3,r,d),o.needsUpdate=!0,i(o,l,s,c))return!0}return!1}function Vi(n,t,e,i,s,c,o){E.setBuffer(n._roots[t]),Re(0,n,e,i,s,c,o),E.clearBuffer()}function Re(n,t,e,i,s,c,o){let{float32Array:a,uint16Array:r,uint32Array:d}=E,u=n*2;if(k(u,r)){let l=V(n,d),p=H(u,r);Ci(t,e,i,l,p,s,c,o)}else{let l=O(n);rt(l,a,i,c,o)&&Re(l,t,e,i,s,c,o);let p=W(n,d);rt(p,a,i,c,o)&&Re(p,t,e,i,s,c,o)}}var qi=["x","y","z"];function Hi(n,t,e,i,s,c){E.setBuffer(n._roots[t]);let o=Le(0,n,e,i,s,c);return E.clearBuffer(),o}function Le(n,t,e,i,s,c){let{float32Array:o,uint16Array:a,uint32Array:r}=E,d=n*2;if(k(d,a)){let f=V(n,r),l=H(d,a);return Ei(t,e,i,f,l,s,c)}else{let f=Ze(n,r),l=qi[f],b=i.direction[l]>=0,g,x;b?(g=O(n),x=W(n,r)):(g=W(n,r),x=O(n));let h=rt(g,o,i,s,c)?Le(g,t,e,i,s,c):null;if(h){let w=h.point[l];if(b?w<=o[x+f]:w>=o[x+f+3])return h}let v=rt(x,o,i,s,c)?Le(x,t,e,i,s,c):null;return h&&v?h.distance<=v.distance?h:v:h||v||null}}var te=new q,ht=new X,mt=new X,Ct=new j,fn=new L,ee=new L;function Wi(n,t,e,i){E.setBuffer(n._roots[t]);let s=ke(0,n,e,i);return E.clearBuffer(),s}function ke(n,t,e,i,s=null){let{float32Array:c,uint16Array:o,uint32Array:a}=E,r=n*2;if(s===null&&(e.boundingBox||e.computeBoundingBox(),fn.set(e.boundingBox.min,e.boundingBox.max,i),s=fn),k(r,o)){let u=t.geometry,f=u.index,l=u.attributes.position,p=e.index,b=e.attributes.position,g=V(n,a),x=H(r,o);if(Ct.copy(i).invert(),e.boundsTree)return C(n,c,ee),ee.matrix.copy(Ct),ee.needsUpdate=!0,e.boundsTree.shapecast({intersectsBounds:h=>ee.intersectsBox(h),intersectsTriangle:h=>{h.a.applyMatrix4(i),h.b.applyMatrix4(i),h.c.applyMatrix4(i),h.needsUpdate=!0;for(let y=g*3,v=(x+g)*3;y<v;y+=3)if(U(mt,y,f,l),mt.needsUpdate=!0,h.intersectsTriangle(mt))return!0;return!1}});for(let m=g*3,h=(x+g)*3;m<h;m+=3){U(ht,m,f,l),ht.a.applyMatrix4(Ct),ht.b.applyMatrix4(Ct),ht.c.applyMatrix4(Ct),ht.needsUpdate=!0;for(let y=0,v=p.count;y<v;y+=3)if(U(mt,y,p,b),mt.needsUpdate=!0,ht.intersectsTriangle(mt))return!0}}else{let u=n+8,f=a[n+6];return C(u,c,te),!!(s.intersectsBox(te)&&ke(u,t,e,i,s)||(C(f,c,te),s.intersectsBox(te)&&ke(f,t,e,i,s)))}}var ne=new j,Ae=new L,Et=new L,Xi=new S,Oi=new S,$i=new S,ji=new S;function Yi(n,t,e,i={},s={},c=0,o=1/0){t.boundingBox||t.computeBoundingBox(),Ae.set(t.boundingBox.min,t.boundingBox.max,e),Ae.needsUpdate=!0;let a=n.geometry,r=a.attributes.position,d=a.index,u=t.attributes.position,f=t.index,l=$.getPrimitive(),p=$.getPrimitive(),b=Xi,g=Oi,x=null,m=null;s&&(x=$i,m=ji);let h=1/0,y=null,v=null;return ne.copy(e).invert(),Et.matrix.copy(ne),n.shapecast({boundsTraverseOrder:w=>Ae.distanceToBox(w),intersectsBounds:(w,A,T)=>T<h&&T<o?(A&&(Et.min.copy(w.min),Et.max.copy(w.max),Et.needsUpdate=!0),!0):!1,intersectsRange:(w,A)=>{if(t.boundsTree)return t.boundsTree.shapecast({boundsTraverseOrder:_=>Et.distanceToBox(_),intersectsBounds:(_,B,P)=>P<h&&P<o,intersectsRange:(_,B)=>{for(let P=_,I=_+B;P<I;P++){U(p,3*P,f,u),p.a.applyMatrix4(e),p.b.applyMatrix4(e),p.c.applyMatrix4(e),p.needsUpdate=!0;for(let M=w,D=w+A;M<D;M++){U(l,3*M,d,r),l.needsUpdate=!0;let F=l.distanceToTriangle(p,b,x);if(F<h&&(g.copy(b),m&&m.copy(x),h=F,y=M,v=P),F<c)return!0}}}});{let T=Bt(t);for(let _=0,B=T;_<B;_++){U(p,3*_,f,u),p.a.applyMatrix4(e),p.b.applyMatrix4(e),p.c.applyMatrix4(e),p.needsUpdate=!0;for(let P=w,I=w+A;P<I;P++){U(l,3*P,d,r),l.needsUpdate=!0;let M=l.distanceToTriangle(p,b,x);if(M<h&&(g.copy(b),m&&m.copy(x),h=M,y=P,v=_),M<c)return!0}}}}}),$.releasePrimitive(l),$.releasePrimitive(p),h===1/0?null:(i.point?i.point.copy(g):i.point=g.clone(),i.distance=h,i.faceIndex=y,s&&(s.point?s.point.copy(m):s.point=m.clone(),s.point.applyMatrix4(ne),g.applyMatrix4(ne),s.distance=g.sub(s.point).length(),s.faceIndex=v),i)}function Zi(n,t=null){t&&Array.isArray(t)&&(t=new Set(t));let e=n.geometry,i=e.index?e.index.array:null,s=e.attributes.position,c,o,a,r,d=0,u=n._roots;for(let l=0,p=u.length;l<p;l++)c=u[l],o=new Uint32Array(c),a=new Uint16Array(c),r=new Float32Array(c),f(0,d),d+=c.byteLength;function f(l,p,b=!1){let g=l*2;if(a[g+15]===ye){let m=o[l+6],h=a[g+14],y=1/0,v=1/0,w=1/0,A=-1/0,T=-1/0,_=-1/0;for(let B=m,P=m+h;B<P;B++){let I=3*n.resolveTriangleIndex(B);for(let M=0;M<3;M++){let D=I+M;D=i?i[D]:D;let F=s.getX(D),z=s.getY(D),N=s.getZ(D);F<y&&(y=F),F>A&&(A=F),z<v&&(v=z),z>T&&(T=z),N<w&&(w=N),N>_&&(_=N)}}return r[l+0]!==y||r[l+1]!==v||r[l+2]!==w||r[l+3]!==A||r[l+4]!==T||r[l+5]!==_?(r[l+0]=y,r[l+1]=v,r[l+2]=w,r[l+3]=A,r[l+4]=T,r[l+5]=_,!0):!1}else{let m=l+8,h=o[l+6],y=m+p,v=h+p,w=b,A=!1,T=!1;t?w||(A=t.has(y),T=t.has(v),w=!A&&!T):(A=!0,T=!0);let _=w||A,B=w||T,P=!1;_&&(P=f(m,p,w));let I=!1;B&&(I=f(h,p,w));let M=P||I;if(M)for(let D=0;D<3;D++){let F=m+D,z=h+D,N=r[F],tt=r[F+3],_t=r[z],Mt=r[z+3];r[l+D]=N<_t?N:_t,r[l+D+3]=tt>Mt?tt:Mt}return M}}}function Ki(n,t,e,i,s,c,o){E.setBuffer(n._roots[t]),Ve(0,n,e,i,s,c,o),E.clearBuffer()}function Ve(n,t,e,i,s,c,o){let{float32Array:a,uint16Array:r,uint32Array:d}=E,u=n*2;if(k(u,r)){let l=V(n,d),p=H(u,r);Ri(t,e,i,l,p,s,c,o)}else{let l=O(n);rt(l,a,i,c,o)&&Ve(l,t,e,i,s,c,o);let p=W(n,d);rt(p,a,i,c,o)&&Ve(p,t,e,i,s,c,o)}}var Ji=["x","y","z"];function Qi(n,t,e,i,s,c){E.setBuffer(n._roots[t]);let o=qe(0,n,e,i,s,c);return E.clearBuffer(),o}function qe(n,t,e,i,s,c){let{float32Array:o,uint16Array:a,uint32Array:r}=E,d=n*2;if(k(d,a)){let f=V(n,r),l=H(d,a);return Li(t,e,i,f,l,s,c)}else{let f=Ze(n,r),l=Ji[f],b=i.direction[l]>=0,g,x;b?(g=O(n),x=W(n,r)):(g=W(n,r),x=O(n));let h=rt(g,o,i,s,c)?qe(g,t,e,i,s,c):null;if(h){let w=h.point[l];if(b?w<=o[x+f]:w>=o[x+f+3])return h}let v=rt(x,o,i,s,c)?qe(x,t,e,i,s,c):null;return h&&v?h.distance<=v.distance?h:v:h||v||null}}var ie=new q,yt=new X,xt=new X,Nt=new j,dn=new L,se=new L;function Gi(n,t,e,i){E.setBuffer(n._roots[t]);let s=He(0,n,e,i);return E.clearBuffer(),s}function He(n,t,e,i,s=null){let{float32Array:c,uint16Array:o,uint32Array:a}=E,r=n*2;if(s===null&&(e.boundingBox||e.computeBoundingBox(),dn.set(e.boundingBox.min,e.boundingBox.max,i),s=dn),k(r,o)){let u=t.geometry,f=u.index,l=u.attributes.position,p=e.index,b=e.attributes.position,g=V(n,a),x=H(r,o);if(Nt.copy(i).invert(),e.boundsTree)return C(n,c,se),se.matrix.copy(Nt),se.needsUpdate=!0,e.boundsTree.shapecast({intersectsBounds:h=>se.intersectsBox(h),intersectsTriangle:h=>{h.a.applyMatrix4(i),h.b.applyMatrix4(i),h.c.applyMatrix4(i),h.needsUpdate=!0;for(let y=g,v=x+g;y<v;y++)if(U(xt,3*t.resolveTriangleIndex(y),f,l),xt.needsUpdate=!0,h.intersectsTriangle(xt))return!0;return!1}});for(let m=g,h=x+g;m<h;m++){let y=t.resolveTriangleIndex(m);U(yt,3*y,f,l),yt.a.applyMatrix4(Nt),yt.b.applyMatrix4(Nt),yt.c.applyMatrix4(Nt),yt.needsUpdate=!0;for(let v=0,w=p.count;v<w;v+=3)if(U(xt,v,p,b),xt.needsUpdate=!0,yt.intersectsTriangle(xt))return!0}}else{let u=n+8,f=a[n+6];return C(u,c,ie),!!(s.intersectsBox(ie)&&He(u,t,e,i,s)||(C(f,c,ie),s.intersectsBox(ie)&&He(f,t,e,i,s)))}}var oe=new j,Te=new L,Ut=new L,ts=new S,es=new S,ns=new S,is=new S;function ss(n,t,e,i={},s={},c=0,o=1/0){t.boundingBox||t.computeBoundingBox(),Te.set(t.boundingBox.min,t.boundingBox.max,e),Te.needsUpdate=!0;let a=n.geometry,r=a.attributes.position,d=a.index,u=t.attributes.position,f=t.index,l=$.getPrimitive(),p=$.getPrimitive(),b=ts,g=es,x=null,m=null;s&&(x=ns,m=is);let h=1/0,y=null,v=null;return oe.copy(e).invert(),Ut.matrix.copy(oe),n.shapecast({boundsTraverseOrder:w=>Te.distanceToBox(w),intersectsBounds:(w,A,T)=>T<h&&T<o?(A&&(Ut.min.copy(w.min),Ut.max.copy(w.max),Ut.needsUpdate=!0),!0):!1,intersectsRange:(w,A)=>{if(t.boundsTree){let T=t.boundsTree;return T.shapecast({boundsTraverseOrder:_=>Ut.distanceToBox(_),intersectsBounds:(_,B,P)=>P<h&&P<o,intersectsRange:(_,B)=>{for(let P=_,I=_+B;P<I;P++){let M=T.resolveTriangleIndex(P);U(p,3*M,f,u),p.a.applyMatrix4(e),p.b.applyMatrix4(e),p.c.applyMatrix4(e),p.needsUpdate=!0;for(let D=w,F=w+A;D<F;D++){let z=n.resolveTriangleIndex(D);U(l,3*z,d,r),l.needsUpdate=!0;let N=l.distanceToTriangle(p,b,x);if(N<h&&(g.copy(b),m&&m.copy(x),h=N,y=D,v=P),N<c)return!0}}}})}else{let T=Bt(t);for(let _=0,B=T;_<B;_++){U(p,3*_,f,u),p.a.applyMatrix4(e),p.b.applyMatrix4(e),p.c.applyMatrix4(e),p.needsUpdate=!0;for(let P=w,I=w+A;P<I;P++){let M=n.resolveTriangleIndex(P);U(l,3*M,d,r),l.needsUpdate=!0;let D=l.distanceToTriangle(p,b,x);if(D<h&&(g.copy(b),m&&m.copy(x),h=D,y=P,v=_),D<c)return!0}}}}}),$.releasePrimitive(l),$.releasePrimitive(p),h===1/0?null:(i.point?i.point.copy(g):i.point=g.clone(),i.distance=h,i.faceIndex=y,s&&(s.point?s.point.copy(m):s.point=m.clone(),s.point.applyMatrix4(oe),g.applyMatrix4(oe),s.distance=g.sub(s.point).length(),s.faceIndex=v),i)}function Wn(){return typeof SharedArrayBuffer<"u"}var Ot=new E.constructor,me=new E.constructor,nt=new $t(()=>new q),bt=new q,gt=new q,Be=new q,_e=new q,Me=!1;function os(n,t,e,i){if(Me)throw new Error("MeshBVH: Recursive calls to bvhcast not supported.");Me=!0;let s=n._roots,c=t._roots,o,a=0,r=0,d=new j().copy(e).invert();for(let u=0,f=s.length;u<f;u++){Ot.setBuffer(s[u]),r=0;let l=nt.getPrimitive();C(0,Ot.float32Array,l),l.applyMatrix4(d);for(let p=0,b=c.length;p<b&&(me.setBuffer(c[p]),o=Z(0,0,e,d,i,a,r,0,0,l),me.clearBuffer(),r+=c[p].length,!o);p++);if(nt.releasePrimitive(l),Ot.clearBuffer(),a+=s[u].length,o)break}return Me=!1,o}function Z(n,t,e,i,s,c=0,o=0,a=0,r=0,d=null,u=!1){let f,l;u?(f=me,l=Ot):(f=Ot,l=me);let p=f.float32Array,b=f.uint32Array,g=f.uint16Array,x=l.float32Array,m=l.uint32Array,h=l.uint16Array,y=n*2,v=t*2,w=k(y,g),A=k(v,h),T=!1;if(A&&w)u?T=s(V(t,m),H(t*2,h),V(n,b),H(n*2,g),r,o+t,a,c+n):T=s(V(n,b),H(n*2,g),V(t,m),H(t*2,h),a,c+n,r,o+t);else if(A){let _=nt.getPrimitive();C(t,x,_),_.applyMatrix4(e);let B=O(n),P=W(n,b);C(B,p,bt),C(P,p,gt);let I=_.intersectsBox(bt),M=_.intersectsBox(gt);T=I&&Z(t,B,i,e,s,o,c,r,a+1,_,!u)||M&&Z(t,P,i,e,s,o,c,r,a+1,_,!u),nt.releasePrimitive(_)}else{let _=O(t),B=W(t,m);C(_,x,Be),C(B,x,_e);let P=d.intersectsBox(Be),I=d.intersectsBox(_e);if(P&&I)T=Z(n,_,e,i,s,c,o,a,r+1,d,u)||Z(n,B,e,i,s,c,o,a,r+1,d,u);else if(P)if(w)T=Z(n,_,e,i,s,c,o,a,r+1,d,u);else{let M=nt.getPrimitive();M.copy(Be).applyMatrix4(e);let D=O(n),F=W(n,b);C(D,p,bt),C(F,p,gt);let z=M.intersectsBox(bt),N=M.intersectsBox(gt);T=z&&Z(_,D,i,e,s,o,c,r,a+1,M,!u)||N&&Z(_,F,i,e,s,o,c,r,a+1,M,!u),nt.releasePrimitive(M)}else if(I)if(w)T=Z(n,B,e,i,s,c,o,a,r+1,d,u);else{let M=nt.getPrimitive();M.copy(_e).applyMatrix4(e);let D=O(n),F=W(n,b);C(D,p,bt),C(F,p,gt);let z=M.intersectsBox(bt),N=M.intersectsBox(gt);T=z&&Z(B,D,i,e,s,o,c,r,a+1,M,!u)||N&&Z(B,F,i,e,s,o,c,r,a+1,M,!u),nt.releasePrimitive(M)}}return T}var re=new L,pn=new q,rs={strategy:Un,maxDepth:40,maxLeafTris:10,useSharedArrayBuffer:!1,setBoundingBox:!0,onProgress:null,indirect:!1,verbose:!0,range:null},Tt=class n{static serialize(t,e={}){e={cloneBuffers:!0,...e};let i=t.geometry,s=t._roots,c=t._indirectBuffer,o=i.getIndex(),a;return e.cloneBuffers?a={roots:s.map(r=>r.slice()),index:o?o.array.slice():null,indirectBuffer:c?c.slice():null}:a={roots:s,index:o?o.array:null,indirectBuffer:c},a}static deserialize(t,e,i={}){i={setIndex:!0,indirect:!!t.indirectBuffer,...i};let{index:s,roots:c,indirectBuffer:o}=t,a=new n(e,{...i,[be]:!0});if(a._roots=c,a._indirectBuffer=o||null,i.setIndex){let r=e.getIndex();if(r===null){let d=new ot(t.index,1,!1);e.setIndex(d)}else r.array!==s&&(r.array.set(s),r.needsUpdate=!0)}return a}get indirect(){return!!this._indirectBuffer}constructor(t,e={}){if(t.isBufferGeometry){if(t.index&&t.index.isInterleavedBufferAttribute)throw new Error("MeshBVH: InterleavedBufferAttribute is not supported for the index attribute.")}else throw new Error("MeshBVH: Only BufferGeometries are supported.");if(e=Object.assign({...rs,[be]:!1},e),e.useSharedArrayBuffer&&!Wn())throw new Error("MeshBVH: SharedArrayBuffer is not available.");this.geometry=t,this._roots=null,this._indirectBuffer=null,e[be]||(Bi(this,e),!t.boundingBox&&e.setBoundingBox&&(t.boundingBox=this.getBoundingBox(new q))),this.resolveTriangleIndex=e.indirect?i=>this._indirectBuffer[i]:i=>i}refit(t=null){return(this.indirect?Zi:Ui)(this,t)}traverse(t,e=0){let i=this._roots[e],s=new Uint32Array(i),c=new Uint16Array(i);o(0);function o(a,r=0){let d=a*2,u=c[d+15]===ye;if(u){let f=s[a+6],l=c[d+14];t(r,u,new Float32Array(i,a*4,6),f,l)}else{let f=a+st/4,l=s[a+6],p=s[a+7];t(r,u,new Float32Array(i,a*4,6),p)||(o(f,r+1),o(l,r+1))}}}raycast(t,e=Je,i=0,s=1/0){let c=this._roots,o=this.geometry,a=[],r=e.isMaterial,d=Array.isArray(e),u=o.groups,f=r?e.side:e,l=this.indirect?Ki:Vi;for(let p=0,b=c.length;p<b;p++){let g=d?e[u[p].materialIndex].side:f,x=a.length;if(l(this,p,g,t,a,i,s),d){let m=u[p].materialIndex;for(let h=x,y=a.length;h<y;h++)a[h].face.materialIndex=m}}return a}raycastFirst(t,e=Je,i=0,s=1/0){let c=this._roots,o=this.geometry,a=e.isMaterial,r=Array.isArray(e),d=null,u=o.groups,f=a?e.side:e,l=this.indirect?Qi:Hi;for(let p=0,b=c.length;p<b;p++){let g=r?e[u[p].materialIndex].side:f,x=l(this,p,g,t,i,s);x!=null&&(d==null||x.distance<d.distance)&&(d=x,r&&(x.face.materialIndex=u[p].materialIndex))}return d}intersectsGeometry(t,e){let i=!1,s=this._roots,c=this.indirect?Gi:Wi;for(let o=0,a=s.length;o<a&&(i=c(this,o,t,e),!i);o++);return i}shapecast(t){let e=$.getPrimitive(),i=this.indirect?ki:Ni,{boundsTraverseOrder:s,intersectsBounds:c,intersectsRange:o,intersectsTriangle:a}=t;if(o&&a){let f=o;o=(l,p,b,g,x)=>f(l,p,b,g,x)?!0:i(l,p,this,a,b,g,e)}else o||(a?o=(f,l,p,b)=>i(f,l,this,a,p,b,e):o=(f,l,p)=>p);let r=!1,d=0,u=this._roots;for(let f=0,l=u.length;f<l;f++){let p=u[f];if(r=Ii(this,f,c,o,s,d),r)break;d+=p.byteLength}return $.releasePrimitive(e),r}bvhcast(t,e,i){let{intersectsRanges:s,intersectsTriangles:c}=i,o=$.getPrimitive(),a=this.geometry.index,r=this.geometry.attributes.position,d=this.indirect?b=>{let g=this.resolveTriangleIndex(b);U(o,g*3,a,r)}:b=>{U(o,b*3,a,r)},u=$.getPrimitive(),f=t.geometry.index,l=t.geometry.attributes.position,p=t.indirect?b=>{let g=t.resolveTriangleIndex(b);U(u,g*3,f,l)}:b=>{U(u,b*3,f,l)};if(c){let b=(g,x,m,h,y,v,w,A)=>{for(let T=m,_=m+h;T<_;T++){p(T),u.a.applyMatrix4(e),u.b.applyMatrix4(e),u.c.applyMatrix4(e),u.needsUpdate=!0;for(let B=g,P=g+x;B<P;B++)if(d(B),o.needsUpdate=!0,c(o,u,B,T,y,v,w,A))return!0}return!1};if(s){let g=s;s=function(x,m,h,y,v,w,A,T){return g(x,m,h,y,v,w,A,T)?!0:b(x,m,h,y,v,w,A,T)}}else s=b}return os(this,t,e,s)}intersectsBox(t,e){return re.set(t.min,t.max,e),re.needsUpdate=!0,this.shapecast({intersectsBounds:i=>re.intersectsBox(i),intersectsTriangle:i=>re.intersectsTriangle(i)})}intersectsSphere(t){return this.shapecast({intersectsBounds:e=>t.intersectsBox(e),intersectsTriangle:e=>e.intersectsSphere(t)})}closestPointToGeometry(t,e,i={},s={},c=0,o=1/0){return(this.indirect?ss:Yi)(this,t,e,i,s,c,o)}closestPointToPoint(t,e={},i=0,s=1/0){return Si(this,t,e,i,s)}getBoundingBox(t){return t.makeEmpty(),this._roots.forEach(i=>{C(0,new Float32Array(i),pn),t.union(pn)}),t}},hn=new q,mn=new j,We=class extends Jn{get isMesh(){return!this.displayEdges}get isLineSegments(){return this.displayEdges}get isLine(){return this.displayEdges}getVertexPosition(...t){return je.prototype.getVertexPosition.call(this,...t)}constructor(t,e,i=10,s=0){super(),this.material=e,this.geometry=new qt,this.name="MeshBVHRootHelper",this.depth=i,this.displayParents=!1,this.bvh=t,this.displayEdges=!0,this._group=s}raycast(){}update(){let t=this.geometry,e=this.bvh,i=this._group;if(t.dispose(),this.visible=!1,e){let s=this.depth-1,c=this.displayParents,o=0;e.traverse((l,p)=>{if(l>=s||p)return o++,!0;c&&o++},i);let a=0,r=new Float32Array(24*o);e.traverse((l,p,b)=>{let g=l>=s||p;if(g||c){C(0,b,hn);let{min:x,max:m}=hn;for(let h=-1;h<=1;h+=2){let y=h<0?x.x:m.x;for(let v=-1;v<=1;v+=2){let w=v<0?x.y:m.y;for(let A=-1;A<=1;A+=2){let T=A<0?x.z:m.z;r[a+0]=y,r[a+1]=w,r[a+2]=T,a+=3}}}return g}},i);let d,u;this.displayEdges?u=new Uint8Array([0,4,1,5,2,6,3,7,0,2,1,3,4,6,5,7,0,1,2,3,4,5,6,7]):u=new Uint8Array([0,1,2,2,1,3,4,6,5,6,7,5,1,4,5,0,4,1,2,3,6,3,7,6,0,2,4,2,6,4,1,5,3,3,5,7]),r.length>65535?d=new Uint32Array(u.length*o):d=new Uint16Array(u.length*o);let f=u.length;for(let l=0;l<o;l++){let p=l*8,b=l*f;for(let g=0;g<f;g++)d[b+g]=p+u[g]}t.setIndex(new ot(d,1,!1)),t.setAttribute("position",new ot(r,3,!1)),this.visible=!0}}},yn=class n extends Qn{get color(){return this.edgeMaterial.color}get opacity(){return this.edgeMaterial.opacity}set opacity(t){this.edgeMaterial.opacity=t,this.meshMaterial.opacity=t}constructor(t=null,e=null,i=10){t instanceof Tt&&(i=e||10,e=t,t=null),typeof e=="number"&&(i=e,e=null),super(),this.name="MeshBVHHelper",this.depth=i,this.mesh=t,this.bvh=e,this.displayParents=!1,this.displayEdges=!0,this.objectIndex=0,this._roots=[];let s=new Gn({color:65416,transparent:!0,opacity:.3,depthWrite:!1}),c=new ti({color:65416,transparent:!0,opacity:.3,depthWrite:!1});c.color=s.color,this.edgeMaterial=s,this.meshMaterial=c,this.update()}update(){let t=this.mesh,e=this.bvh||t.geometry.boundsTree||null;if(t.isBatchedMesh&&t.boundsTrees&&!e){let s=t._drawInfo[this.objectIndex];s&&(e=t.boundsTrees[s.geometryIndex]||e)}let i=e?e._roots.length:0;for(;this._roots.length>i;){let s=this._roots.pop();s.geometry.dispose(),this.remove(s)}for(let s=0;s<i;s++){let{depth:c,edgeMaterial:o,meshMaterial:a,displayParents:r,displayEdges:d}=this;if(s>=this._roots.length){let f=new We(e,o,c,s);this.add(f),this._roots.push(f)}let u=this._roots[s];u.bvh=e,u.depth=c,u.displayParents=r,u.displayEdges=d,u.material=d?o:a,u.update()}}updateMatrixWorld(...t){let e=this.mesh,i=this.parent;e!==null&&(e.updateWorldMatrix(!0,!1),i?this.matrix.copy(i.matrixWorld).invert().multiply(e.matrixWorld):this.matrix.copy(e.matrixWorld),(e.isInstancedMesh||e.isBatchedMesh)&&(e.getMatrixAt(this.objectIndex,mn),this.matrix.multiply(mn)),this.matrix.decompose(this.position,this.quaternion,this.scale)),super.updateMatrixWorld(...t)}copy(t){this.depth=t.depth,this.mesh=t.mesh,this.bvh=t.bvh,this.opacity=t.opacity,this.color.copy(t.color)}clone(){return new n(this.mesh,this.bvh,this.depth)}dispose(){this.edgeMaterial.dispose(),this.meshMaterial.dispose();let t=this.children;for(let e=0,i=t.length;e<i;e++)t[e].geometry.dispose()}};var Rt=new q,xn=new q,wt=new S;function bn(n){switch(typeof n){case"number":return 8;case"string":return n.length*2;case"boolean":return 4;default:return 0}}function cs(n){return/(Uint|Int|Float)(8|16|32)Array/.test(n.constructor.name)}function as(n,t){let e={nodeCount:0,leafNodeCount:0,depth:{min:1/0,max:-1/0},tris:{min:1/0,max:-1/0},splits:[0,0,0],surfaceAreaScore:0};return n.traverse((i,s,c,o,a)=>{let r=c[3]-c[0],d=c[4]-c[1],u=c[5]-c[2],f=2*(r*d+d*u+u*r);e.nodeCount++,s?(e.leafNodeCount++,e.depth.min=Math.min(i,e.depth.min),e.depth.max=Math.max(i,e.depth.max),e.tris.min=Math.min(a,e.tris.min),e.tris.max=Math.max(a,e.tris.max),e.surfaceAreaScore+=f*de*a):(e.splits[o]++,e.surfaceAreaScore+=f*Fe)},t),e.tris.min===1/0&&(e.tris.min=0,e.tris.max=0),e.depth.min===1/0&&(e.depth.min=0,e.depth.max=0),e}function Ps(n){return n._roots.map((t,e)=>as(n,e))}function Is(n){let t=new Set,e=[n],i=0;for(;e.length;){let s=e.pop();if(!t.has(s)){t.add(s);for(let c in s){if(!Object.hasOwn(s,c))continue;i+=bn(c);let o=s[c];o&&(typeof o=="object"||typeof o=="function")?cs(o)||Wn()&&o instanceof SharedArrayBuffer||o instanceof ArrayBuffer?i+=o.byteLength:e.push(o):i+=bn(o)}}}return i}function Ss(n){let t=n.geometry,e=[],i=t.index,s=t.getAttribute("position"),c=!0;return n.traverse((o,a,r,d,u)=>{let f={depth:o,isLeaf:a,boundingData:r,offset:d,count:u};e[o]=f,C(0,r,Rt);let l=e[o-1];if(a)for(let p=d,b=d+u;p<b;p++){let g=n.resolveTriangleIndex(p),x=3*g,m=3*g+1,h=3*g+2;i&&(x=i.getX(x),m=i.getX(m),h=i.getX(h));let y;wt.fromBufferAttribute(s,x),y=Rt.containsPoint(wt),wt.fromBufferAttribute(s,m),y=y&&Rt.containsPoint(wt),wt.fromBufferAttribute(s,h),y=y&&Rt.containsPoint(wt),console.assert(y,"Leaf bounds does not fully contain triangle."),c=c&&y}if(l){C(0,r,xn);let p=xn.containsBox(Rt);console.assert(p,"Parent bounds does not fully contain child."),c=c&&p}}),c}function Ds(n){let t=[];return n.traverse((e,i,s,c,o)=>{let a={bounds:C(0,s,new q)};i?(a.count=o,a.offset=c):(a.left=null,a.right=null),t[e]=a;let r=t[e-1];r&&(r.left===null?r.left=a:r.right=a)}),t[0]}function gn(n,t,e){return n===null?null:(n.point.applyMatrix4(t.matrixWorld),n.distance=n.point.distanceTo(e.ray.origin),n.object=t,n)}var ls=parseInt(En)>=166,ce=new ei,wn=new S,vn=new j,us=je.prototype.raycast,fs=ni.prototype.raycast,An=new S,R=new je,ae=[];function Fs(n,t){this.isBatchedMesh?ds.call(this,n,t):ps.call(this,n,t)}function ds(n,t){if(this.boundsTrees){let e=this.boundsTrees,i=this._drawInfo||this._instanceInfo,s=this._drawRanges||this._geometryInfo,c=this.matrixWorld;R.material=this.material,R.geometry=this.geometry;let o=R.geometry.boundsTree,a=R.geometry.drawRange;R.geometry.boundingSphere===null&&(R.geometry.boundingSphere=new Cn);for(let r=0,d=i.length;r<d;r++){if(!this.getVisibleAt(r))continue;let u=i[r].geometryIndex;if(R.geometry.boundsTree=e[u],this.getMatrixAt(r,R.matrixWorld).premultiply(c),!R.geometry.boundsTree){this.getBoundingBoxAt(u,R.geometry.boundingBox),this.getBoundingSphereAt(u,R.geometry.boundingSphere);let f=s[u];R.geometry.setDrawRange(f.start,f.count)}R.raycast(n,ae);for(let f=0,l=ae.length;f<l;f++){let p=ae[f];p.object=this,p.batchId=r,t.push(p)}ae.length=0}R.geometry.boundsTree=o,R.geometry.drawRange=a,R.material=null,R.geometry=null}else fs.call(this,n,t)}function ps(n,t){if(this.geometry.boundsTree){if(this.material===void 0)return;vn.copy(this.matrixWorld).invert(),ce.copy(n.ray).applyMatrix4(vn),An.setFromMatrixScale(this.matrixWorld),wn.copy(ce.direction).multiply(An);let e=wn.length(),i=n.near/e,s=n.far/e,c=this.geometry.boundsTree;if(n.firstHitOnly===!0){let o=gn(c.raycastFirst(ce,this.material,i,s),this,n);o&&t.push(o)}else{let o=c.raycast(ce,this.material,i,s);for(let a=0,r=o.length;a<r;a++){let d=gn(o[a],this,n);d&&t.push(d)}}}else us.call(this,n,t)}function zs(n={}){return this.boundsTree=new Tt(this,n),this.boundsTree}function Cs(){this.boundsTree=null}function Es(n=-1,t={}){if(!ls)throw new Error("BatchedMesh: Three r166+ is required to compute bounds trees.");t.indirect&&console.warn('"Indirect" is set to false because it is not supported for BatchedMesh.'),t={...t,indirect:!1,range:null};let e=this._drawRanges||this._geometryInfo,i=this._geometryCount;this.boundsTrees||(this.boundsTrees=new Array(i).fill(null));let s=this.boundsTrees;for(;s.length<i;)s.push(null);if(n<0){for(let c=0;c<i;c++)t.range=e[c],s[c]=new Tt(this.geometry,t);return s}else return n<e.length&&(t.range=e[n],s[n]=new Tt(this.geometry,t)),s[n]||null}function Ns(n=-1){n<0?this.boundsTrees.fill(null):n<this.boundsTree.length&&(this.boundsTrees[n]=null)}function hs(n){switch(n){case 1:return"R";case 2:return"RG";case 3:return"RGBA";case 4:return"RGBA"}throw new Error}function ms(n){switch(n){case 1:return si;case 2:return ii;case 3:return he;case 4:return he}}function Tn(n){switch(n){case 1:return oi;case 2:return Nn;case 3:return Se;case 4:return Se}}var jt=class extends De{constructor(){super(),this.minFilter=vt,this.magFilter=vt,this.generateMipmaps=!1,this.overrideItemSize=null,this._forcedType=null}updateFrom(t){let e=this.overrideItemSize,i=t.itemSize,s=t.count;if(e!==null){if(i*s%e!==0)throw new Error("VertexAttributeTexture: overrideItemSize must divide evenly into buffer length.");t.itemSize=e,t.count=s*i/e}let c=t.itemSize,o=t.count,a=t.normalized,r=t.array.constructor,d=r.BYTES_PER_ELEMENT,u=this._forcedType,f=c;if(u===null)switch(r){case Float32Array:u=Wt;break;case Uint8Array:case Uint16Array:case Uint32Array:u=Ht;break;case Int8Array:case Int16Array:case Int32Array:u=fe;break}let l,p,b,g,x=hs(c);switch(u){case Wt:b=1,p=ms(c),a&&d===1?(g=r,x+="8",r===Uint8Array?l=Qe:(l=Ge,x+="_SNORM")):(g=Float32Array,x+="32F",l=Wt);break;case fe:x+=d*8+"I",b=a?Math.pow(2,r.BYTES_PER_ELEMENT*8-1):1,p=Tn(c),d===1?(g=Int8Array,l=Ge):d===2?(g=Int16Array,l=ci):(g=Int32Array,l=fe);break;case Ht:x+=d*8+"UI",b=a?Math.pow(2,r.BYTES_PER_ELEMENT*8-1):1,p=Tn(c),d===1?(g=Uint8Array,l=Qe):d===2?(g=Uint16Array,l=ri):(g=Uint32Array,l=Ht);break}f===3&&(p===he||p===Se)&&(f=4);let m=Math.ceil(Math.sqrt(o))||1,h=f*m*m,y=new g(h),v=t.normalized;t.normalized=!1;for(let w=0;w<o;w++){let A=f*w;y[A]=t.getX(w)/b,c>=2&&(y[A+1]=t.getY(w)/b),c>=3&&(y[A+2]=t.getZ(w)/b,f===4&&(y[A+3]=1)),c>=4&&(y[A+3]=t.getW(w)/b)}t.normalized=v,this.internalFormat=x,this.format=p,this.type=l,this.image.width=m,this.image.height=m,this.image.data=y,this.needsUpdate=!0,this.dispose(),t.itemSize=i,t.count=s}},Xe=class extends jt{constructor(){super(),this._forcedType=Ht}},Bn=class extends jt{constructor(){super(),this._forcedType=fe}},Oe=class extends jt{constructor(){super(),this._forcedType=Wt}},_n=class{constructor(){this.index=new Xe,this.position=new Oe,this.bvhBounds=new De,this.bvhContents=new De,this._cachedIndexAttr=null,this.index.overrideItemSize=3}updateFrom(t){let{geometry:e}=t;if(xs(t,this.bvhBounds,this.bvhContents),this.position.updateFrom(e.attributes.position),t.indirect){let i=t._indirectBuffer;if(this._cachedIndexAttr===null||this._cachedIndexAttr.count!==i.length)if(e.index)this._cachedIndexAttr=e.index.clone();else{let s=Ln(Rn(e));this._cachedIndexAttr=new ot(s,1,!1)}ys(e,i,this._cachedIndexAttr),this.index.updateFrom(this._cachedIndexAttr)}else this.index.updateFrom(e.index)}dispose(){let{index:t,position:e,bvhBounds:i,bvhContents:s}=this;t&&t.dispose(),e&&e.dispose(),i&&i.dispose(),s&&s.dispose()}};function ys(n,t,e){let i=e.array,s=n.index?n.index.array:null;for(let c=0,o=t.length;c<o;c++){let a=3*c,r=3*t[c];for(let d=0;d<3;d++)i[a+d]=s?s[r+d]:r+d}}function xs(n,t,e){let i=n._roots;if(i.length!==1)throw new Error("MeshBVHUniformStruct: Multi-root BVHs not supported.");let s=i[0],c=new Uint16Array(s),o=new Uint32Array(s),a=new Float32Array(s),r=s.byteLength/st,d=2*Math.ceil(Math.sqrt(r/2)),u=new Float32Array(4*d*d),f=Math.ceil(Math.sqrt(r)),l=new Uint32Array(2*f*f);for(let p=0;p<r;p++){let b=p*st/4,g=b*2,x=b;for(let m=0;m<3;m++)u[8*p+0+m]=a[x+0+m],u[8*p+4+m]=a[x+3+m];if(k(g,c)){let m=H(g,c),h=V(b,o),y=4294901760|m;l[p*2+0]=y,l[p*2+1]=h}else{let m=4*W(b,o)/st,h=Ze(b,o);l[p*2+0]=h,l[p*2+1]=m}}t.image.data=u,t.image.width=d,t.image.height=d,t.format=he,t.type=Wt,t.internalFormat="RGBA32F",t.minFilter=vt,t.magFilter=vt,t.generateMipmaps=!1,t.needsUpdate=!0,t.dispose(),e.image.data=l,e.image.width=f,e.image.height=f,e.format=Nn,e.type=Ht,e.internalFormat="RG32UI",e.minFilter=vt,e.magFilter=vt,e.generateMipmaps=!1,e.needsUpdate=!0,e.dispose()}var ut=new S,ft=new S,dt=new S,Mn=new Ye,le=new S,Pe=new S,Pn=new Ye,In=new Ye,ue=new j,Sn=new j;function Lt(n,t){if(!n&&!t)return;let e=n.count===t.count,i=n.normalized===t.normalized,s=n.array.constructor===t.array.constructor,c=n.itemSize===t.itemSize;if(!e||!i||!s||!c)throw new Error}function Vt(n,t=null){let e=n.array.constructor,i=n.normalized,s=n.itemSize,c=t===null?n.count:t;return new ot(new e(s*c),s,i)}function Xn(n,t,e=0){if(n.isInterleavedBufferAttribute){let i=n.itemSize;for(let s=0,c=n.count;s<c;s++){let o=s+e;t.setX(o,n.getX(s)),i>=2&&t.setY(o,n.getY(s)),i>=3&&t.setZ(o,n.getZ(s)),i>=4&&t.setW(o,n.getW(s))}}else{let i=t.array,s=i.constructor,c=i.BYTES_PER_ELEMENT*n.itemSize*e;new s(i.buffer,c,n.array.length).set(n.array)}}function bs(n,t,e){let i=n.elements,s=t.elements;for(let c=0,o=s.length;c<o;c++)i[c]+=s[c]*e}function Dn(n,t,e){let i=n.skeleton,s=n.geometry,c=i.bones,o=i.boneInverses;Pn.fromBufferAttribute(s.attributes.skinIndex,t),In.fromBufferAttribute(s.attributes.skinWeight,t),ue.elements.fill(0);for(let a=0;a<4;a++){let r=In.getComponent(a);if(r!==0){let d=Pn.getComponent(a);Sn.multiplyMatrices(c[d].matrixWorld,o[d]),bs(ue,Sn,r)}}return ue.multiply(n.bindMatrix).premultiply(n.bindMatrixInverse),e.transformDirection(ue),e}function Ie(n,t,e,i,s){le.set(0,0,0);for(let c=0,o=n.length;c<o;c++){let a=t[c],r=n[c];a!==0&&(Pe.fromBufferAttribute(r,i),e?le.addScaledVector(Pe,a):le.addScaledVector(Pe.sub(s),a))}s.add(le)}function gs(n,t={useGroups:!1,updateIndex:!1,skipAttributes:[]},e=new qt){let i=n[0].index!==null,{useGroups:s=!1,updateIndex:c=!1,skipAttributes:o=[]}=t,a=new Set(Object.keys(n[0].attributes)),r={},d=0;e.clearGroups();for(let u=0;u<n.length;++u){let f=n[u],l=0;if(i!==(f.index!==null))throw new Error("StaticGeometryGenerator: All geometries must have compatible attributes; make sure index attribute exists among all geometries, or in none of them.");for(let p in f.attributes){if(!a.has(p))throw new Error('StaticGeometryGenerator: All geometries must have compatible attributes; make sure "'+p+'" attribute exists among all geometries, or in none of them.');r[p]===void 0&&(r[p]=[]),r[p].push(f.attributes[p]),l++}if(l!==a.size)throw new Error("StaticGeometryGenerator: Make sure all geometries have the same number of attributes.");if(s){let p;if(i)p=f.index.count;else if(f.attributes.position!==void 0)p=f.attributes.position.count;else throw new Error("StaticGeometryGenerator: The geometry must have either an index or a position attribute");e.addGroup(d,p,u),d+=p}}if(i){let u=!1;if(!e.index){let f=0;for(let l=0;l<n.length;++l)f+=n[l].index.count;e.setIndex(new ot(new Uint32Array(f),1,!1)),u=!0}if(c||u){let f=e.index,l=0,p=0;for(let b=0;b<n.length;++b){let g=n[b],x=g.index;if(o[b]!==!0)for(let m=0;m<x.count;++m)f.setX(l,x.getX(m)+p),l++;p+=g.attributes.position.count}}}for(let u in r){let f=r[u];if(!(u in e.attributes)){let b=0;for(let g in f)b+=f[g].count;e.setAttribute(u,Vt(r[u][0],b))}let l=e.attributes[u],p=0;for(let b=0,g=f.length;b<g;b++){let x=f[b];o[b]!==!0&&Xn(x,l,p),p+=x.count}}return e}function ws(n,t){if(n===null||t===null)return n===t;if(n.length!==t.length)return!1;for(let e=0,i=n.length;e<i;e++)if(n[e]!==t[e])return!1;return!0}function vs(n){let{index:t,attributes:e}=n;if(t)for(let i=0,s=t.count;i<s;i+=3){let c=t.getX(i),o=t.getX(i+2);t.setX(i,o),t.setX(i+2,c)}else for(let i in e){let s=e[i],c=s.itemSize;for(let o=0,a=s.count;o<a;o+=3)for(let r=0;r<c;r++){let d=s.getComponent(o,r),u=s.getComponent(o+2,r);s.setComponent(o,r,u),s.setComponent(o+2,r,d)}}return n}var $e=class{constructor(t){this.matrixWorld=new j,this.geometryHash=null,this.boneMatrices=null,this.primitiveCount=-1,this.mesh=t,this.update()}update(){let t=this.mesh,e=t.geometry,i=t.skeleton,s=(e.index?e.index.count:e.attributes.position.count)/3;if(this.matrixWorld.copy(t.matrixWorld),this.geometryHash=e.attributes.position.version,this.primitiveCount=s,i){i.boneTexture||i.computeBoneTexture(),i.update();let c=i.boneMatrices;!this.boneMatrices||this.boneMatrices.length!==c.length?this.boneMatrices=c.slice():this.boneMatrices.set(c)}else this.boneMatrices=null}didChange(){let t=this.mesh,e=t.geometry,i=(e.index?e.index.count:e.attributes.position.count)/3;return!(this.matrixWorld.equals(t.matrixWorld)&&this.geometryHash===e.attributes.position.version&&ws(t.skeleton&&t.skeleton.boneMatrices||null,this.boneMatrices)&&this.primitiveCount===i)}},Fn=class{constructor(t){Array.isArray(t)||(t=[t]);let e=[];t.forEach(i=>{i.traverseVisible(s=>{s.isMesh&&e.push(s)})}),this.meshes=e,this.useGroups=!0,this.applyWorldTransforms=!0,this.attributes=["position","normal","color","tangent","uv","uv2"],this._intermediateGeometry=new Array(e.length).fill().map(()=>new qt),this._diffMap=new WeakMap}getMaterials(){let t=[];return this.meshes.forEach(e=>{Array.isArray(e.material)?t.push(...e.material):t.push(e.material)}),t}generate(t=new qt){let e=[],{meshes:i,useGroups:s,_intermediateGeometry:c,_diffMap:o}=this;for(let a=0,r=i.length;a<r;a++){let d=i[a],u=c[a],f=o.get(d);!f||f.didChange(d)?(this._convertToStaticGeometry(d,u),e.push(!1),f?f.update():o.set(d,new $e(d))):e.push(!0)}if(c.length===0){t.setIndex(null);let a=t.attributes;for(let r in a)t.deleteAttribute(r);for(let r in this.attributes)t.setAttribute(this.attributes[r],new ot(new Float32Array(0),4,!1))}else gs(c,{useGroups:s,skipAttributes:e},t);for(let a in t.attributes)t.attributes[a].needsUpdate=!0;return t}_convertToStaticGeometry(t,e=new qt){let i=t.geometry,s=this.applyWorldTransforms,c=this.attributes.includes("normal"),o=this.attributes.includes("tangent"),a=i.attributes,r=e.attributes;!e.index&&i.index&&(e.index=i.index.clone()),r.position||e.setAttribute("position",Vt(a.position)),c&&!r.normal&&a.normal&&e.setAttribute("normal",Vt(a.normal)),o&&!r.tangent&&a.tangent&&e.setAttribute("tangent",Vt(a.tangent)),Lt(i.index,e.index),Lt(a.position,r.position),c&&Lt(a.normal,r.normal),o&&Lt(a.tangent,r.tangent);let d=a.position,u=c?a.normal:null,f=o?a.tangent:null,l=i.morphAttributes.position,p=i.morphAttributes.normal,b=i.morphAttributes.tangent,g=i.morphTargetsRelative,x=t.morphTargetInfluences,m=new ai;m.getNormalMatrix(t.matrixWorld),i.index&&e.index.array.set(i.index.array);for(let h=0,y=a.position.count;h<y;h++)ut.fromBufferAttribute(d,h),u&&ft.fromBufferAttribute(u,h),f&&(Mn.fromBufferAttribute(f,h),dt.fromBufferAttribute(f,h)),x&&(l&&Ie(l,x,g,h,ut),p&&Ie(p,x,g,h,ft),b&&Ie(b,x,g,h,dt)),t.isSkinnedMesh&&(t.applyBoneTransform(h,ut),u&&Dn(t,h,ft),f&&Dn(t,h,dt)),s&&ut.applyMatrix4(t.matrixWorld),r.position.setXYZ(h,ut.x,ut.y,ut.z),u&&(s&&ft.applyNormalMatrix(m),r.normal.setXYZ(h,ft.x,ft.y,ft.z)),f&&(s&&dt.transformDirection(t.matrixWorld),r.tangent.setXYZW(h,dt.x,dt.y,dt.z,Mn.w));for(let h in this.attributes){let y=this.attributes[h];y==="position"||y==="tangent"||y==="normal"||!(y in a)||(r[y]||e.setAttribute(y,Vt(a[y])),Lt(a[y],r[y]),Xn(a[y],r[y]))}return t.matrixWorld.determinant()<0&&vs(e),e}},On=`

// A stack of uint32 indices can can store the indices for
// a perfectly balanced tree with a depth up to 31. Lower stack
// depth gets higher performance.
//
// However not all trees are balanced. Best value to set this to
// is the trees max depth.
#ifndef BVH_STACK_DEPTH
#define BVH_STACK_DEPTH 60
#endif

#ifndef INFINITY
#define INFINITY 1e20
#endif

// Utilities
uvec4 uTexelFetch1D( usampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

ivec4 iTexelFetch1D( isampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 texelFetch1D( sampler2D tex, uint index ) {

	uint width = uint( textureSize( tex, 0 ).x );
	uvec2 uv;
	uv.x = index % width;
	uv.y = index / width;

	return texelFetch( tex, ivec2( uv ), 0 );

}

vec4 textureSampleBarycoord( sampler2D tex, vec3 barycoord, uvec3 faceIndices ) {

	return
		barycoord.x * texelFetch1D( tex, faceIndices.x ) +
		barycoord.y * texelFetch1D( tex, faceIndices.y ) +
		barycoord.z * texelFetch1D( tex, faceIndices.z );

}

void ndcToCameraRay(
	vec2 coord, mat4 cameraWorld, mat4 invProjectionMatrix,
	out vec3 rayOrigin, out vec3 rayDirection
) {

	// get camera look direction and near plane for camera clipping
	vec4 lookDirection = cameraWorld * vec4( 0.0, 0.0, - 1.0, 0.0 );
	vec4 nearVector = invProjectionMatrix * vec4( 0.0, 0.0, - 1.0, 1.0 );
	float near = abs( nearVector.z / nearVector.w );

	// get the camera direction and position from camera matrices
	vec4 origin = cameraWorld * vec4( 0.0, 0.0, 0.0, 1.0 );
	vec4 direction = invProjectionMatrix * vec4( coord, 0.5, 1.0 );
	direction /= direction.w;
	direction = cameraWorld * direction - origin;

	// slide the origin along the ray until it sits at the near clip plane position
	origin.xyz += direction.xyz * near / dot( direction, lookDirection );

	rayOrigin = origin.xyz;
	rayDirection = direction.xyz;

}
`,$n=`

float dot2( vec3 v ) {

	return dot( v, v );

}

// https://www.shadertoy.com/view/ttfGWl
vec3 closestPointToTriangle( vec3 p, vec3 v0, vec3 v1, vec3 v2, out vec3 barycoord ) {

    vec3 v10 = v1 - v0;
    vec3 v21 = v2 - v1;
    vec3 v02 = v0 - v2;

	vec3 p0 = p - v0;
	vec3 p1 = p - v1;
	vec3 p2 = p - v2;

    vec3 nor = cross( v10, v02 );

    // method 2, in barycentric space
    vec3  q = cross( nor, p0 );
    float d = 1.0 / dot2( nor );
    float u = d * dot( q, v02 );
    float v = d * dot( q, v10 );
    float w = 1.0 - u - v;

	if( u < 0.0 ) {

		w = clamp( dot( p2, v02 ) / dot2( v02 ), 0.0, 1.0 );
		u = 0.0;
		v = 1.0 - w;

	} else if( v < 0.0 ) {

		u = clamp( dot( p0, v10 ) / dot2( v10 ), 0.0, 1.0 );
		v = 0.0;
		w = 1.0 - u;

	} else if( w < 0.0 ) {

		v = clamp( dot( p1, v21 ) / dot2( v21 ), 0.0, 1.0 );
		w = 0.0;
		u = 1.0-v;

	}

	barycoord = vec3( u, v, w );
    return u * v1 + v * v2 + w * v0;

}

float distanceToTriangles(
	// geometry info and triangle range
	sampler2D positionAttr, usampler2D indexAttr, uint offset, uint count,

	// point and cut off range
	vec3 point, float closestDistanceSquared,

	// outputs
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord, inout float side, inout vec3 outPoint
) {

	bool found = false;
	vec3 localBarycoord;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		uvec3 indices = uTexelFetch1D( indexAttr, i ).xyz;
		vec3 a = texelFetch1D( positionAttr, indices.x ).rgb;
		vec3 b = texelFetch1D( positionAttr, indices.y ).rgb;
		vec3 c = texelFetch1D( positionAttr, indices.z ).rgb;

		// get the closest point and barycoord
		vec3 closestPoint = closestPointToTriangle( point, a, b, c, localBarycoord );
		vec3 delta = point - closestPoint;
		float sqDist = dot2( delta );
		if ( sqDist < closestDistanceSquared ) {

			// set the output results
			closestDistanceSquared = sqDist;
			faceIndices = uvec4( indices.xyz, i );
			faceNormal = normalize( cross( a - b, b - c ) );
			barycoord = localBarycoord;
			outPoint = closestPoint;
			side = sign( dot( faceNormal, delta ) );

		}

	}

	return closestDistanceSquared;

}

float distanceSqToBounds( vec3 point, vec3 boundsMin, vec3 boundsMax ) {

	vec3 clampedPoint = clamp( point, boundsMin, boundsMax );
	vec3 delta = point - clampedPoint;
	return dot( delta, delta );

}

float distanceSqToBVHNodeBoundsPoint( vec3 point, sampler2D bvhBounds, uint currNodeIndex ) {

	uint cni2 = currNodeIndex * 2u;
	vec3 boundsMin = texelFetch1D( bvhBounds, cni2 ).xyz;
	vec3 boundsMax = texelFetch1D( bvhBounds, cni2 + 1u ).xyz;
	return distanceSqToBounds( point, boundsMin, boundsMax );

}

// use a macro to hide the fact that we need to expand the struct into separate fields
#define	bvhClosestPointToPoint(		bvh,		point, faceIndices, faceNormal, barycoord, side, outPoint	)	_bvhClosestPointToPoint(		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,		point, faceIndices, faceNormal, barycoord, side, outPoint	)

float _bvhClosestPointToPoint(
	// bvh info
	sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents,

	// point to check
	vec3 point,

	// output variables
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout vec3 outPoint
 ) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int ptr = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;

	float closestDistanceSquared = pow( 100000.0, 2.0 );
	bool found = false;
	while ( ptr > - 1 && ptr < BVH_STACK_DEPTH ) {

		uint currNodeIndex = stack[ ptr ];
		ptr --;

		// check if we intersect the current bounds
		float boundsHitDistance = distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, currNodeIndex );
		if ( boundsHitDistance > closestDistanceSquared ) {

			continue;

		}

		uvec2 boundsInfo = uTexelFetch1D( bvh_bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );
		if ( isLeaf ) {

			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;
			closestDistanceSquared = distanceToTriangles(
				bvh_position, bvh_index, offset, count, point, closestDistanceSquared,

				// outputs
				faceIndices, faceNormal, barycoord, side, outPoint
			);

		} else {

			uint leftIndex = currNodeIndex + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = boundsInfo.y;
			bool leftToRight = distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, leftIndex ) < distanceSqToBVHNodeBoundsPoint( point, bvh_bvhBounds, rightIndex );//rayDirection[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse. The second pointer added is the one that will be
			// traversed first
			ptr ++;
			stack[ ptr ] = c2;
			ptr ++;
			stack[ ptr ] = c1;

		}

	}

	return sqrt( closestDistanceSquared );

}
`,jn=`

#ifndef TRI_INTERSECT_EPSILON
#define TRI_INTERSECT_EPSILON 1e-5
#endif

// Raycasting
bool intersectsBounds( vec3 rayOrigin, vec3 rayDirection, vec3 boundsMin, vec3 boundsMax, out float dist ) {

	// https://www.reddit.com/r/opengl/comments/8ntzz5/fast_glsl_ray_box_intersection/
	// https://tavianator.com/2011/ray_box.html
	vec3 invDir = 1.0 / rayDirection;

	// find intersection distances for each plane
	vec3 tMinPlane = invDir * ( boundsMin - rayOrigin );
	vec3 tMaxPlane = invDir * ( boundsMax - rayOrigin );

	// get the min and max distances from each intersection
	vec3 tMinHit = min( tMaxPlane, tMinPlane );
	vec3 tMaxHit = max( tMaxPlane, tMinPlane );

	// get the furthest hit distance
	vec2 t = max( tMinHit.xx, tMinHit.yz );
	float t0 = max( t.x, t.y );

	// get the minimum hit distance
	t = min( tMaxHit.xx, tMaxHit.yz );
	float t1 = min( t.x, t.y );

	// set distance to 0.0 if the ray starts inside the box
	dist = max( t0, 0.0 );

	return t1 >= dist;

}

bool intersectsTriangle(
	vec3 rayOrigin, vec3 rayDirection, vec3 a, vec3 b, vec3 c,
	out vec3 barycoord, out vec3 norm, out float dist, out float side
) {

	// https://stackoverflow.com/questions/42740765/intersection-between-line-and-triangle-in-3d
	vec3 edge1 = b - a;
	vec3 edge2 = c - a;
	norm = cross( edge1, edge2 );

	float det = - dot( rayDirection, norm );
	float invdet = 1.0 / det;

	vec3 AO = rayOrigin - a;
	vec3 DAO = cross( AO, rayDirection );

	vec4 uvt;
	uvt.x = dot( edge2, DAO ) * invdet;
	uvt.y = - dot( edge1, DAO ) * invdet;
	uvt.z = dot( AO, norm ) * invdet;
	uvt.w = 1.0 - uvt.x - uvt.y;

	// set the hit information
	barycoord = uvt.wxy; // arranged in A, B, C order
	dist = uvt.z;
	side = sign( det );
	norm = side * normalize( norm );

	// add an epsilon to avoid misses between triangles
	uvt += vec4( TRI_INTERSECT_EPSILON );

	return all( greaterThanEqual( uvt, vec4( 0.0 ) ) );

}

bool intersectTriangles(
	// geometry info and triangle range
	sampler2D positionAttr, usampler2D indexAttr, uint offset, uint count,

	// ray
	vec3 rayOrigin, vec3 rayDirection,

	// outputs
	inout float minDistance, inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout float dist
) {

	bool found = false;
	vec3 localBarycoord, localNormal;
	float localDist, localSide;
	for ( uint i = offset, l = offset + count; i < l; i ++ ) {

		uvec3 indices = uTexelFetch1D( indexAttr, i ).xyz;
		vec3 a = texelFetch1D( positionAttr, indices.x ).rgb;
		vec3 b = texelFetch1D( positionAttr, indices.y ).rgb;
		vec3 c = texelFetch1D( positionAttr, indices.z ).rgb;

		if (
			intersectsTriangle( rayOrigin, rayDirection, a, b, c, localBarycoord, localNormal, localDist, localSide )
			&& localDist < minDistance
		) {

			found = true;
			minDistance = localDist;

			faceIndices = uvec4( indices.xyz, i );
			faceNormal = localNormal;

			side = localSide;
			barycoord = localBarycoord;
			dist = localDist;

		}

	}

	return found;

}

bool intersectsBVHNodeBounds( vec3 rayOrigin, vec3 rayDirection, sampler2D bvhBounds, uint currNodeIndex, out float dist ) {

	uint cni2 = currNodeIndex * 2u;
	vec3 boundsMin = texelFetch1D( bvhBounds, cni2 ).xyz;
	vec3 boundsMax = texelFetch1D( bvhBounds, cni2 + 1u ).xyz;
	return intersectsBounds( rayOrigin, rayDirection, boundsMin, boundsMax, dist );

}

// use a macro to hide the fact that we need to expand the struct into separate fields
#define	bvhIntersectFirstHit(		bvh,		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist	)	_bvhIntersectFirstHit(		bvh.position, bvh.index, bvh.bvhBounds, bvh.bvhContents,		rayOrigin, rayDirection, faceIndices, faceNormal, barycoord, side, dist	)

bool _bvhIntersectFirstHit(
	// bvh info
	sampler2D bvh_position, usampler2D bvh_index, sampler2D bvh_bvhBounds, usampler2D bvh_bvhContents,

	// ray
	vec3 rayOrigin, vec3 rayDirection,

	// output variables split into separate variables due to output precision
	inout uvec4 faceIndices, inout vec3 faceNormal, inout vec3 barycoord,
	inout float side, inout float dist
) {

	// stack needs to be twice as long as the deepest tree we expect because
	// we push both the left and right child onto the stack every traversal
	int ptr = 0;
	uint stack[ BVH_STACK_DEPTH ];
	stack[ 0 ] = 0u;

	float triangleDistance = INFINITY;
	bool found = false;
	while ( ptr > - 1 && ptr < BVH_STACK_DEPTH ) {

		uint currNodeIndex = stack[ ptr ];
		ptr --;

		// check if we intersect the current bounds
		float boundsHitDistance;
		if (
			! intersectsBVHNodeBounds( rayOrigin, rayDirection, bvh_bvhBounds, currNodeIndex, boundsHitDistance )
			|| boundsHitDistance > triangleDistance
		) {

			continue;

		}

		uvec2 boundsInfo = uTexelFetch1D( bvh_bvhContents, currNodeIndex ).xy;
		bool isLeaf = bool( boundsInfo.x & 0xffff0000u );

		if ( isLeaf ) {

			uint count = boundsInfo.x & 0x0000ffffu;
			uint offset = boundsInfo.y;

			found = intersectTriangles(
				bvh_position, bvh_index, offset, count,
				rayOrigin, rayDirection, triangleDistance,
				faceIndices, faceNormal, barycoord, side, dist
			) || found;

		} else {

			uint leftIndex = currNodeIndex + 1u;
			uint splitAxis = boundsInfo.x & 0x0000ffffu;
			uint rightIndex = boundsInfo.y;

			bool leftToRight = rayDirection[ splitAxis ] >= 0.0;
			uint c1 = leftToRight ? leftIndex : rightIndex;
			uint c2 = leftToRight ? rightIndex : leftIndex;

			// set c2 in the stack so we traverse it later. We need to keep track of a pointer in
			// the stack while we traverse. The second pointer added is the one that will be
			// traversed first
			ptr ++;
			stack[ ptr ] = c2;

			ptr ++;
			stack[ ptr ] = c1;

		}

	}

	return found;

}
`,Yn=`
struct BVH {

	usampler2D index;
	sampler2D position;

	sampler2D bvhBounds;
	usampler2D bvhContents;

};
`,Us=Object.freeze({__proto__:null,bvh_distance_functions:$n,bvh_ray_functions:jn,bvh_struct_definitions:Yn,common_functions:On}),Rs=Yn,Ls=$n,ks=`
	${On}
	${jn}
`;export{li as AVERAGE,Us as BVHShaderGLSL,Un as CENTER,tn as CONTAINED,X as ExtendedTriangle,Oe as FloatVertexAttributeTexture,Bs as INTERSECTED,Bn as IntVertexAttributeTexture,Tt as MeshBVH,yn as MeshBVHHelper,_n as MeshBVHUniformStruct,Ts as NOT_INTERSECTED,L as OrientedBox,ui as SAH,Fn as StaticGeometryGenerator,Xe as UIntVertexAttributeTexture,jt as VertexAttributeTexture,Fs as acceleratedRaycast,Es as computeBatchedBoundsTree,zs as computeBoundsTree,Ns as disposeBatchedBoundsTree,Cs as disposeBoundsTree,Is as estimateMemoryInBytes,Ps as getBVHExtremes,Ds as getJSONStructure,Ms as getTriangleHitPointInfo,Ls as shaderDistanceFunction,ks as shaderIntersectFunction,Rs as shaderStructs,Ss as validateBounds};
