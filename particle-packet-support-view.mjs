import {BufferGeometry,Float32BufferAttribute,LineSegments,LineBasicMaterial} from './lib/three.core.js';

export function summarizePacketInspection(snapshot){
 if(!snapshot.available)return snapshot;
 if(!snapshot.receipt||snapshot.packets?.length!==snapshot.receipt.packetCapacity*16||snapshot.kernels?.length!==snapshot.receipt.kernelCapacity*32||snapshot.stats?.length<9)throw Error('Incomplete packet observation');
 const p=snapshot.packets,diameters=[],active=[];
 for(let i=0;i<p.length/16;i++)if(p[i*16+3]>0){const at=i*16;active.push(i);diameters.push(Math.hypot(p[at+8]-p[at+4],p[at+9]-p[at+5],p[at+10]-p[at+6]));}
 diameters.sort((a,b)=>a-b);const s=snapshot.stats;
 return {available:true,identity:snapshot.identity,activePackets:s[0],emittingPackets:s[1],directedConnections:s[2],subrays:s[3],kernelBoundsTests:s[4],intersectedKernels:s[5],sliceDeposits:s[6],solidTriangleTests:s[7],counterOverflow:!!s[8],supportDiameter:{min:diameters[0]??0,median:diameters[Math.floor(diameters.length/2)]??0,max:diameters.at(-1)??0},activeIds:active,definition:'kernel-union AABB diagonal in Fine units; packet centers and receiving supports are separate'};
}
export function createPacketSupportView(parent){
 const geometry=new BufferGeometry(),material=new LineBasicMaterial({vertexColors:true,transparent:true,opacity:.7,depthTest:false}),lines=new LineSegments(geometry,material);lines.name='Measured optical packet supports';lines.userData.kaminosDocumentTransient=true;lines.renderOrder=1000;lines.visible=false;parent.add(lines);
 const boxEdges=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
 return {
  set(snapshot,mode){lines.visible=mode!=='off'&&snapshot?.available===true;if(!lines.visible)return;const positions=[],colors=[],transform=snapshot.transform??{scale:1,translate:[0,0,0]},put=(p,c)=>{positions.push(...p.map((v,i)=>v*transform.scale+transform.translate[i]));colors.push(...c);};
   if(mode==='packets'){
    const p=snapshot.packets;for(let at=0;at<p.length;at+=16){if(p[at+3]<=0)continue;const i=at/16,h=(i*.61803398875)%1,c=[.25+.7*h,.9-.5*h,.7];for(const [a,b]of boxEdges)for(const corner of [a,b])put([0,1,2].map(axis=>p[at+(corner&(1<<axis)?8:4)+axis]),c);}
   }else{
    const k=snapshot.kernels,u=new Uint32Array(k.buffer,k.byteOffset,k.length);for(let at=0;at<k.length;at+=32){if(!u[at+31]||u[at+29]!==Number(mode==='extinction'))continue;
     const a=k[at+4],b=k[at+5],c=k[at+6],d=k[at+9],e=k[at+10],f=k[at+14],det=a*(d*f-e*e)-b*(b*f-c*e)+c*(b*e-c*d);if(!(det>0))continue;
     const xx=(d*f-e*e)/det,xy=(c*e-b*f)/det,xz=(b*e-c*d)/det,yy=(a*f-c*c)/det,yz=(b*c-a*e)/det,zz=(a*d-b*b)/det;
     const l00=Math.sqrt(xx),l10=xy/l00,l20=xz/l00,l11=Math.sqrt(Math.max(0,yy-l10*l10)),l21=(yz-l20*l10)/l11,l22=Math.sqrt(Math.max(0,zz-l20*l20-l21*l21)),sigma=k[at+7],color=mode==='emission'?[1,.4,.1]:[.2,.8,1];
     const point=v=>[k[at]+sigma*l00*v[0],k[at+1]+sigma*(l10*v[0]+l11*v[1]),k[at+2]+sigma*(l20*v[0]+l21*v[1]+l22*v[2])];
     for(let plane=0;plane<3;plane++)for(let j=0;j<32;j++)for(const t of [j/32,(j+1)/32]){const v=[0,0,0];v[plane]=Math.cos(2*Math.PI*t);v[(plane+1)%3]=Math.sin(2*Math.PI*t);put(point(v),color);}
    }
   }
   geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometry.computeBoundingSphere();
  },
  dispose(){parent.remove(lines);geometry.dispose();material.dispose();},
 };
}
