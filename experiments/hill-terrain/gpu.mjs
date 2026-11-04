import {BufferGeometry,BufferAttribute,Box3,Vector3,Sphere} from '../../lib/three.core.js';
import {StorageBufferAttribute} from '../../lib/three.webgpu.js';
import {storage,Fn,wgslFn,instanceIndex,uint,float,uniform,mix,attribute as tslAttribute,positionLocal,normalLocal} from '../../lib/three.tsl.js';
import {terrainConfig,makeRidges,ROUTE} from './model.mjs';

const init=wgslFn(`fn hill_initial(v:u32,n:u32,width:f32,length:f32,soil:f32,ridges:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let x=v%n;let z=v/n;let p=(vec2<f32>(f32(x),f32(z))/f32(n-1u)-vec2<f32>(.5))*vec2<f32>(width,length);var ridge=0.;
 for(var k=0u;k<arrayLength(ridges);k+=2u){let a=(*ridges)[k];let b=(*ridges)[k+1u];let d=b.xy-a.xy;let t=clamp(dot(p-a.xy,d)/dot(d,d),0.,1.);let r=p-a.xy-t*d;let w=mix(a.w,b.w,t);ridge=max(ridge,mix(a.z,b.z,t)*exp(-dot(r,r)/(2.*w*w)));}
 let grain=.5+.5*sin(p.x*2.1+.7*sin(p.y*1.4))*sin(p.y*1.8+p.x*.4);let edge=f32(min(min(x,z),min(n-1u-x,n-1u-z)))/f32(n-1u);let coast=min(1.,edge/.10);
 return vec4<f32>(.09+coast*(ridge*.78+.025*grain),coast*(.055+soil*(.3+.7*ridge/1.8)),0.,0.);
}`);
const flux=wgslFn(`fn hill_flux(v:u32,n:u32,dx:f32,dz:f32,talus:f32,fraction:f32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let x=v%n;let z=v/n;let s=(*state)[v];let h=s.x+s.y;var e=vec4<f32>(0.);
 if(x>0u){let a=(*state)[v-1u];e.x=max(0.,h-a.x-a.y-talus*dx);}if(x+1u<n){let a=(*state)[v+1u];e.y=max(0.,h-a.x-a.y-talus*dx);}
 if(z>0u){let a=(*state)[v-n];e.z=max(0.,h-a.x-a.y-talus*dz);}if(z+1u<n){let a=(*state)[v+n];e.w=max(0.,h-a.x-a.y-talus*dz);}
 let sum=e.x+e.y+e.z+e.w;if(sum<=0.){return vec4<f32>(0.);}return e*(min(s.y,sum*.25)*fraction/sum);
}`);
const move=wgslFn(`fn hill_move(v:u32,n:u32,width:f32,length:f32,dt:f32,uplift:f32,state:ptr<storage,array<vec4<f32>>,read_write>,flow:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let x=v%n;let z=v/n;let s=(*state)[v];let f=(*flow)[v];var incoming=0.;
 if(x>0u){incoming+=(*flow)[v-1u].y;}if(x+1u<n){incoming+=(*flow)[v+1u].x;}if(z>0u){incoming+=(*flow)[v-n].w;}if(z+1u<n){incoming+=(*flow)[v+n].z;}
 let p=(vec2<f32>(f32(x),f32(z))/f32(n-1u)-vec2<f32>(.5))*vec2<f32>(width,length);
 let bed=s.x+uplift*dt*exp(-((p.x+.4)*(p.x+.4))/3.-((p.y+1.5)*(p.y+1.5))/.5);
 let soil=max(0.,s.y+incoming-f.x-f.y-f.z-f.w);return vec4<f32>(bed,soil,(bed+soil-s.x-s.y)/dt,s.w);
}`);
const geologyBankFlux=wgslFn(`fn hill_geo_bank(v:u32,n:u32,width:f32,length:f32,dx:f32,dz:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,hardness:f32,seed:f32,stepStyle:f32,meso:f32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%n;let zi=v/n;let s=(*state)[v];
 let u=f32(xi)/f32(n-1u);let w=f32(zi)/f32(n-1u);let x=(u-.5)*width;let z=(w-.5)*length;
 let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
 let dipScale=1.-.88*clamp(stepStyle,0.,1.);
 let warp=.28*sin(rx*.55+rz*.35+seed*.03)+.16*cos(rz*.85-rx*.45);
 let phase=(s.x-dipScale*tilt*rx-dipScale*fold*(sin(rz*.7+rx*.2)+warp)+seed*.017)/thickness;
 let frac=phase-floor(phase);let sineBand=max(0.,.5+.5*sin(phase*6.2831853));
 let benchCap=smoothstep(.22,.42,frac)*(1.-.35*smoothstep(.92,1.,frac));
 let band=clamp(mix(sineBand,benchCap,.65*clamp(stepStyle,0.,1.)),0.,1.);
 let strength=1.+hardness*(band*band*band*band);
 let bankLim=1.376*(1.+1.6*clamp(stepStyle,0.,1.));
 let rate=(.14*(1.-.55*clamp(stepStyle,0.,1.)))/strength;
 var b=vec4<f32>(0.);
 if(xi>0u){let a=(*state)[v-1u];b.x=min(max(0.,.48-a.y)*.22,max(0.,s.x-a.x-a.y-bankLim*dx)*rate);}
 if(xi+1u<n){let a=(*state)[v+1u];b.y=min(max(0.,.48-a.y)*.22,max(0.,s.x-a.x-a.y-bankLim*dx)*rate);}
 if(zi>0u){let a=(*state)[v-n];b.z=min(max(0.,.48-a.y)*.22,max(0.,s.x-a.x-a.y-bankLim*dz)*rate);}
 if(zi+1u<n){let a=(*state)[v+n];b.w=min(max(0.,.48-a.y)*.22,max(0.,s.x-a.x-a.y-bankLim*dz)*rate);}
 return b;
}`);
const geologyMove=wgslFn(`fn hill_geo_move(v:u32,n:u32,width:f32,length:f32,dx:f32,dz:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,hardness:f32,weathering:f32,incision:f32,seed:f32,stepStyle:f32,meso:f32,state:ptr<storage,array<vec4<f32>>,read_write>,flow:ptr<storage,array<vec4<f32>>,read_write>,bank:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%n;let zi=v/n;let s=(*state)[v];let f=(*flow)[v];let bk=(*bank)[v];
 var inSoil=0.;var inBank=0.;
 if(xi>0u){inSoil+=(*flow)[v-1u].y;inBank+=(*bank)[v-1u].y;}
 if(xi+1u<n){inSoil+=(*flow)[v+1u].x;inBank+=(*bank)[v+1u].x;}
 if(zi>0u){inSoil+=(*flow)[v-n].w;inBank+=(*bank)[v-n].w;}
 if(zi+1u<n){inSoil+=(*flow)[v+n].z;inBank+=(*bank)[v+n].z;}
 let l=(*state)[v-select(0u,1u,xi>0u)];let r=(*state)[v+select(0u,1u,xi+1u<n)];
 let b=(*state)[v-select(0u,n,zi>0u)];let fr=(*state)[v+select(0u,n,zi+1u<n)];
 let gx=(r.x+r.y-l.x-l.y)/(2.*dx);let gz=(fr.x+fr.y-b.x-b.y)/(2.*dz);
 let slope=sqrt(gx*gx+gz*gz);
 let u=f32(xi)/f32(n-1u);let w=f32(zi)/f32(n-1u);let x=(u-.5)*width;let z=(w-.5)*length;
 let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
 let dipScale=1.-.88*clamp(stepStyle,0.,1.);
 let warp=.28*sin(rx*.55+rz*.35+seed*.03)+.16*cos(rz*.85-rx*.45);
 let phase=(s.x-dipScale*tilt*rx-dipScale*fold*(sin(rz*.7+rx*.2)+warp)+seed*.017)/thickness;
 let frac=phase-floor(phase);let sineBand=max(0.,.5+.5*sin(phase*6.2831853));
 let benchCap=smoothstep(.22,.42,frac)*(1.-.35*smoothstep(.92,1.,frac));
 let band=clamp(mix(sineBand,benchCap,.65*clamp(stepStyle,0.,1.)),0.,1.);
 let strength=1.+hardness*(band*band*band*band);
 let insul=max(0.,1.-s.y/.062);
 let hump=(.18+.82*min(1.,s.y/.018))*(insul*insul);
 let weath=weathering*hump/strength;
 let lap=(l.x+l.y+r.x+r.y+b.x+b.y+fr.x+fr.y)-4.*(s.x+s.y);
 let concav=max(0.,lap/dx);
 let chuteCut=incision*.018*concav*smoothstep(.15,.85,slope)*clamp((s.x-.14)/.5,0.,1.)/strength;
 let bankLoss=bk.x+bk.y+bk.z+bk.w;
 let nextBed=max(.08,s.x-weath-chuteCut-bankLoss);
 let nextSoil=max(0.,s.y+weath+inBank+inSoil-f.x-f.y-f.z-f.w);
 return vec4<f32>(nextBed,nextSoil,0.,0.);
}`);
const normal=wgslFn(`fn hill_normal(v:u32,n:u32,dx:f32,dz:f32,x:f32,z:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,useFormed:f32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%n;let zi=v/n;let l=(*state)[v-select(0u,1u,xi>0u)];let r=(*state)[v+select(0u,1u,xi+1u<n)];let b=(*state)[v-select(0u,n,zi>0u)];let f=(*state)[v+select(0u,n,zi+1u<n)];
 var gx=(r.x+r.y-l.x-l.y)/(dx*select(1.,2.,xi>0u&&xi+1u<n));var gz=(f.x+f.y-b.x-b.y)/(dz*select(1.,2.,zi>0u&&zi+1u<n));
 if(useFormed>.5&&meso>0.){
  let s=(*state)[v];let exposed=exp(-s.y/.045);let rawSlope=sqrt(gx*gx+gz*gz);
  let cliffMask=smoothstep(.28,1.15,rawSlope);
  let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
  let dipScale=1.-.88*clamp(stepStyle,0.,1.);
  let warp=.28*sin(rx*.55+rz*.35+seed*.03)+.16*cos(rz*.85-rx*.45);
  let phase=(s.x-dipScale*tilt*rx-dipScale*fold*(sin(rz*.7+rx*.2)+warp)+seed*.017)/thickness;
  let ledgeStep=cos(phase*6.2831853)+.48*cos(phase*18.849556);
  let jointX=cos(rx*7.5+rz*2.8+warp*2.+seed*.17);
  let jointZ=sin(rz*7.5-rx*2.8-warp*2.+seed*.31);
  let cliffAmp=meso*exposed*cliffMask*.28;
  let rillRipple=cos(x*10.+.5*sin(z*6.+seed*.2));
  let rillAmp=meso*(1.-exposed)*(1.-cliffMask)*.025;
  gx+=cliffAmp*(.45*jointX+.55*ledgeStep*ca)+rillAmp*rillRipple;
  gz+=cliffAmp*(.45*jointZ+.55*ledgeStep*sa);
 }
 return vec4<f32>(normalize(vec3<f32>(-gx,1.,-gz)),0.);
}`);

const formedColor=wgslFn(`fn hill_geological_color(x:f32,z:f32,bed:f32,soil:f32,nx:f32,ny:f32,nz:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32)->vec4<f32>{
 let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
 let dipScale=1.-.88*clamp(stepStyle,0.,1.);
 let warp=.28*sin(rx*.55+rz*.35+seed*.03)+.16*cos(rz*.85-rx*.45);
 let phase=(bed-dipScale*tilt*rx-dipScale*fold*(sin(rz*.7+rx*.2)+warp)+seed*.017)/thickness;
 let band=.5+.5*sin(phase*6.28318530718);
 let subBand=.5+.5*sin(phase*25.1327412+.5*sin(rx*4.2-rz*3.6));
 let microLamina=.5+.5*cos(phase*62.831853+rx*8.5);
 let ledge=smoothstep(.22,.76,band);
 let stratMix=clamp(mix(band,ledge,.58*clamp(stepStyle,0.,1.))+meso*(.18*(subBand-.5)+.09*(microLamina-.5)),0.,1.);
 let steep=clamp(1.-ny,0.,1.);
 let cliffWall=smoothstep(.10,.36,steep);
 let jointPlane=abs(sin(rx*6.8+rz*2.6+warp*1.8+.35*sin(phase*3.14159)));
 let crevice=meso*smoothstep(.12,.01,jointPlane)*cliffWall;
 let undercut=meso*(1.-ledge)*cliffWall*.34;
 let shale=vec3<f32>(.108,.080,.056);
 let ochre=vec3<f32>(.35,.27,.172);
 let capSand=vec3<f32>(.46,.375,.255);
 var rock=mix(shale,mix(ochre,capSand,smoothstep(.55,.92,stratMix)),stratMix);
 rock=rock*(1.-.42*crevice-.28*undercut);
 let screeZone=clamp(smoothstep(.005,.022,soil)*(1.-smoothstep(.032,.075,soil))*smoothstep(.06,.24,steep),0.,1.);
 let screeColor=vec3<f32>(.27,.23,.17);
 let uFan=x/(.70+.50*(z/9.+.5))+.12*sin(z*1.6+seed*.2);
 let rillTrace=.5+.5*sin(uFan*9.);
 let meadow=vec3<f32>(.115,.168,.064);
 let rillSand=vec3<f32>(.205,.215,.118);
 let earth=mix(meadow,rillSand,meso*.32*smoothstep(.62,.92,rillTrace)*(1.-cliffWall));
 let ground=mix(earth,screeColor,meso*.72*screeZone);
 let exposed=exp(-soil/.045);
 return vec4<f32>(mix(ground,rock,exposed),1.);
}`);

// Multi-octave world-space fragment relief & rock/scree articulation down to millimeter zoom:
// Synthesizes 3D triplanar sandstone bedding steps, blocky vertical joint clefts,
// discrete angular talus cobbles/pebbles, and directional micro-normal self-shadowing per pixel.
const fragFormedColor=wgslFn(`fn hill_frag_color(vColor:vec4<f32>,x:f32,y:f32,z:f32,nx:f32,ny:f32,nz:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,useFormed:f32)->vec4<f32>{
 if(useFormed<.5||meso<=0.){return vec4<f32>(vColor.xyz,1.);}
 let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
 let dipScale=1.-.88*clamp(stepStyle,0.,1.);
 let warp=.28*sin(rx*.55+rz*.35+seed*.03)+.16*cos(rz*.85-rx*.45);
 let phase=(y-dipScale*tilt*rx-dipScale*fold*(sin(rz*.7+rx*.2)+warp)+seed*.017)/thickness;
 let steep=clamp(1.-ny,0.,1.);
 let cliffWall=smoothstep(.08,.30,steep);
 let talusBand=smoothstep(.04,.22,steep)*(1.-smoothstep(.28,.52,steep));
 // Multi-octave 3D rock bedding steps & vertical joint blocks on cliffs and bench rims
 let subPhase=phase*4.-floor(phase*4.);
 let stepRiser=smoothstep(.08,.24,subPhase)*(1.-smoothstep(.82,.96,subPhase));
 let fineBand=sin(phase*37.699112+.4*sin(rx*5.2-rz*4.4));
 let microLamina=cos(phase*113.0973+rx*14.5-rz*9.2);
 let ultraLamina=sin(phase*280.+rx*38.-rz*27.);
 let joint0=abs(sin(rx*11.5+rz*4.2+warp*2.4+.3*sin(phase*6.2831853)));
 let joint1=abs(sin(rx*32.-rz*13.+.45*cos(phase*18.849556)));
 let joint2=abs(cos(rx*86.+rz*37.+.35*sin(phase*50.26548)));
 let crevice=(smoothstep(.11,.012,joint0)+.65*smoothstep(.09,.01,joint1)+.40*smoothstep(.08,.008,joint2))*cliffWall;
 let overhangOcc=smoothstep(.22,.02,subPhase)*cliffWall*.32;
 // Per-pixel 3D normal perturbation for crisp close-up rock facets & talus cobbles
 let dPhaseDy=cos(phase*25.1327)+.6*cos(phase*75.3982)+.35*cos(phase*220.);
 let dJointDx=cos(rx*11.5+rz*4.2)+.65*cos(rx*32.-rz*13.)+.4*sin(rx*86.+rz*37.);
 let dJointDz=sin(rz*11.5-rx*4.2)+.65*sin(rz*32.+rx*13.)+.4*cos(rz*86.-rx*37.);
 // Multi-scale talus cobbles & scree boulders on toe slopes
 let cob0=sin(x*18.+sin(z*15.+seed))*cos(z*17.-sin(x*14.));
 let cob1=sin(x*52.+cos(z*47.+seed*1.7))*cos(z*49.-sin(x*43.));
 let cob2=sin(x*148.+sin(z*132.))*cos(z*140.-cos(x*124.));
 let cobbleDome=max(0.,cob0-.25)+.55*max(0.,cob1-.28)+.30*max(0.,cob2-.30);
 let cobbleEdge=smoothstep(.20,.28,cob0)*smoothstep(.36,.28,cob0)+.6*smoothstep(.22,.30,cob1)*smoothstep(.38,.30,cob1);
 let dCobX=cos(x*18.+sin(z*15.+seed))*18.+.5*cos(x*52.+cos(z*47.))*52.;
 let dCobZ=-sin(z*17.-sin(x*14.))*17.-.5*sin(z*49.-sin(x*43.))*49.;
 let pnx=nx+meso*(cliffWall*(.38*dJointDx+.32*dPhaseDy*ca)+talusBand*.028*dCobX+(1.-cliffWall)*.012*dCobX);
 let pny=ny+meso*(cliffWall*.42*stepRiser-cliffWall*.32*overhangOcc+talusBand*.28*cobbleDome);
 let pnz=nz+meso*(cliffWall*(.38*dJointDz+.32*dPhaseDy*sa)+talusBand*.028*dCobZ+(1.-cliffWall)*.012*dCobZ);
 let pNorm=normalize(vec3<f32>(pnx,max(.05,pny),pnz));
 let baseNorm=normalize(vec3<f32>(nx,max(.05,ny),nz));
 let sunDir=normalize(vec3<f32>(.52,.68,.51));
 let microShade=clamp(1.+(dot(pNorm,sunDir)-dot(baseNorm,sunDir))*1.75,0.42,1.55);
 let rockWarm=vec3<f32>(.40,.31,.21);
 let screeTint=mix(vColor.xyz,rockWarm,meso*talusBand*clamp(cobbleDome*1.1,0.,.78));
 let laminaGain=1.+meso*cliffWall*(.18*(stepRiser-.4)+.14*fineBand+.09*microLamina+.06*ultraLamina-.42*crevice-.32*overhangOcc);
 let grit=sin(x*165.+z*130.)*cos(z*155.-x*140.);
 let groundGain=1.+meso*(1.-cliffWall)*(.08*cob0+.06*cob1+.04*grit-.18*talusBand*cobbleEdge);
 return vec4<f32>(clamp(screeTint*laminaGain*groundGain*microShade,vec3<f32>(0.),vec3<f32>(1.)),1.);
}`);

// Camera-centered arbitrary-zoom 3D surface synthesis:
// Smooth 16-tap Catmull-Rom bicubic surface + positive 3D overhanging rock ledges,
// stepped sandstone fracture blocks, and 3D talus boulders inside the camera's focal zone,
// while smoothly tucking underneath the base mesh at the outer perimeter (zero seam).
const zoomSurfaceKernel=wgslFn(`fn hill_zoom_surface(v:u32,zn:u32,n:u32,width:f32,length:f32,fx:f32,fz:f32,fr:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,useFormed:f32,mode:u32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%zn;let zi=v/zn;
 let u=(f32(xi)/f32(zn-1u))*2.-1.;
 let w=(f32(zi)/f32(zn-1u))*2.-1.;
 let wx=clamp(fx+u*fr,-width*.5,width*.5);
 let wz=clamp(fz+w*fr,-length*.5,length*.5);
 let fn1=f32(n-1u);
 let gx=clamp((wx/width+.5)*fn1,0.,fn1-.0001);
 let gz=clamp((wz/length+.5)*fn1,0.,fn1-.0001);
 let ix=u32(gx);let iz=u32(gz);
 let tx=gx-f32(ix);let tz=gz-f32(iz);
 let s00=(*state)[iz*n+ix];
 let s10=(*state)[iz*n+min(n-1u,ix+1u)];
 let s01=(*state)[min(n-1u,iz+1u)*n+ix];
 let s11=(*state)[min(n-1u,iz+1u)*n+min(n-1u,ix+1u)];
 var bedTri=0.;var soilTri=0.;
 if(tx+tz<=1.){
  bedTri=s00.x+tx*(s10.x-s00.x)+tz*(s01.x-s00.x);
  soilTri=s00.y+tx*(s10.y-s00.y)+tz*(s01.y-s00.y);
 }else{
  bedTri=s11.x+(1.-tx)*(s01.x-s11.x)+(1.-tz)*(s10.x-s11.x);
  soilTri=s11.y+(1.-tx)*(s01.y-s11.y)+(1.-tz)*(s10.y-s11.y);
 }
 let wx0=tx*(-.5+tx*(1.-.5*tx));let wx1=1.+tx*tx*(-2.5+1.5*tx);let wx2=tx*(.5+tx*(2.-1.5*tx));let wx3=tx*tx*(-.5+.5*tx);
 let wz0=tz*(-.5+tz*(1.-.5*tz));let wz1=1.+tz*tz*(-2.5+1.5*tz);let wz2=tz*(.5+tz*(2.-1.5*tz));let wz3=tz*tz*(-.5+.5*tz);
 let ix0=select(0u,ix-1u,ix>0u);let ix1=ix;let ix2=min(n-1u,ix+1u);let ix3=min(n-1u,ix+2u);
 let iz0=select(0u,iz-1u,iz>0u);let iz1=iz;let iz2=min(n-1u,iz+1u);let iz3=min(n-1u,iz+2u);
 let r0=wx0*(*state)[iz0*n+ix0].xy+wx1*(*state)[iz0*n+ix1].xy+wx2*(*state)[iz0*n+ix2].xy+wx3*(*state)[iz0*n+ix3].xy;
 let r1=wx0*(*state)[iz1*n+ix0].xy+wx1*(*state)[iz1*n+ix1].xy+wx2*(*state)[iz1*n+ix2].xy+wx3*(*state)[iz1*n+ix3].xy;
 let r2=wx0*(*state)[iz2*n+ix0].xy+wx1*(*state)[iz2*n+ix1].xy+wx2*(*state)[iz2*n+ix2].xy+wx3*(*state)[iz2*n+ix3].xy;
 let r3=wx0*(*state)[iz3*n+ix0].xy+wx1*(*state)[iz3*n+ix1].xy+wx2*(*state)[iz3*n+ix2].xy+wx3*(*state)[iz3*n+ix3].xy;
 let cub=wz0*r0+wz1*r1+wz2*r2+wz3*r3;
 let dxGrid=width/fn1;let dzGrid=length/fn1;
 let hL=(r1.x+r1.y);let hR=(r2.x+r2.y);
 let dhdx=(((*state)[iz1*n+ix2].x+(*state)[iz1*n+ix2].y)-((*state)[iz1*n+ix0].x+(*state)[iz1*n+ix0].y))/(2.*dxGrid);
 let dhdz=(((*state)[iz2*n+ix1].x+(*state)[iz2*n+ix1].y)-((*state)[iz0*n+ix1].x+(*state)[iz0*n+ix1].y))/(2.*dzGrid);
 let edge=max(abs(u),abs(w));
 let border=smoothstep(.495,.45,max(abs(wx/width),abs(wz/length)));
 let wPatch=(1.-smoothstep(.65,.90,edge))*border;
 let rimTuck=-smoothstep(.84,.98,edge)*.006;
 let bed=mix(bedTri,max(bedTri-.002,cub.x),wPatch);
 let soil=max(0.,mix(soilTri,max(soilTri-.001,cub.y),wPatch));
 var px=wx;var py=bed+soil+rimTuck;var pz=wz;var cobbleOut=0.;
 let rawSlope=sqrt(dhdx*dhdx+dhdz*dhdz);
 if(useFormed>.5&&meso>0.&&wPatch>0.){
  let ds=(2.*fr)/f32(zn-1u);
  let oct0=smoothstep(ds*3.0,ds*1.4,.36);
  let oct1=smoothstep(ds*3.2,ds*1.4,.12);
  let oct2=smoothstep(ds*3.2,ds*1.4,.038);
  let oct3=smoothstep(ds*3.2,ds*1.4,.012);
  let exposed=exp(-soil/.055);
  let cliffMask=smoothstep(.18,.75,rawSlope)*exposed;
  let invSlope=1./max(.18,rawSlope);
  let outX=-dhdx*invSlope;let outZ=-dhdz*invSlope;
  let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=wx*ca+wz*sa;let rz=-wx*sa+wz*ca;
  let dipScale=1.-.88*clamp(stepStyle,0.,1.);
  let warp=.28*sin(rx*.55+rz*.35+seed*.03)+.16*cos(rz*.85-rx*.45);
  let phase=(bed-dipScale*tilt*rx-dipScale*fold*(sin(rz*.7+rx*.2)+warp)+seed*.017)/thickness;
  let pFrac=phase-floor(phase);
  let shelf0=smoothstep(.12,.30,pFrac)*(1.-.60*smoothstep(.80,.96,pFrac));
  let subFrac=phase*3.-floor(phase*3.);
  let shelf1=smoothstep(.10,.32,subFrac)*(1.-.55*smoothstep(.78,.96,subFrac));
  let fineFrac=phase*9.-floor(phase*9.);
  let shelf2=smoothstep(.12,.36,fineFrac)*(1.-.50*smoothstep(.78,.96,fineFrac));
  let lam3=.5+.5*sin(phase*113.097+.4*cos(rx*18.+rz*14.));
  let block0=max(0.,sin(rx*6.5+.4*sin(phase*6.283))*cos(rz*5.5-.3*cos(phase*6.283))+.3);
  let block1=max(0.,sin(rx*22.+rz*8.+warp*3.)*cos(rz*19.-rx*7.)+.25);
  let block2=max(0.,sin(rx*64.-rz*24.)*cos(rz*58.+rx*21.)+.25);
  let notch0=1.-.72*smoothstep(.15,.01,abs(sin(rx*6.8+rz*2.6+warp*1.8)));
  let notch1=1.-.62*smoothstep(.13,.01,abs(sin(rx*24.-rz*9.5+.4*sin(phase*12.566))));
  let ledgeOut=meso*wPatch*cliffMask*notch0*notch1*(oct0*(.095*shelf0+.045*shelf1+.034*block0)+oct1*(.034*shelf1+.024*shelf2+.022*block1)+oct2*(.014*lam3+.012*block2)+oct3*.005*(.5+.5*sin(rx*165.+phase*240.)));
  let ledgeUp=meso*wPatch*cliffMask*notch0*(oct0*(.052*shelf0+.026*shelf1)+oct1*(.018*shelf2+.014*block1)+oct2*.008*lam3);
  let screeZone=smoothstep(.003,.018,soil)*smoothstep(.05,.48,rawSlope)*(1.-.45*cliffMask);
  let bCell0=max(0.,sin(wx*16.+sin(wz*13.+seed))*cos(wz*15.-sin(wx*12.))-.18);
  let bCell1=max(0.,sin(wx*44.+cos(wz*38.+seed*2.))*cos(wz*41.-sin(wx*35.))-.22);
  let bCell2=max(0.,sin(wx*115.+sin(wz*102.))*cos(wz*108.-cos(wx*96.))-.24);
  let cobbleH=meso*wPatch*screeZone*(oct0*.055*bCell0+oct1*.028*bCell1+oct2*.012*bCell2);
  cobbleOut=cobbleH;
  let benchOutcrop=meso*wPatch*exposed*(1.-cliffMask)*smoothstep(.25,1.0,bed)*(oct1*.014*block1+oct2*.006*block2);
  let washChannel=meso*wPatch*(1.-exposed)*(1.-screeZone)*(oct1*.005*(.5+.5*sin(wx*16.+sin(wz*8.)))+oct2*.0025*(.5+.5*cos(wx*48.-wz*22.)));
  px=wx+ledgeOut*outX;
  py=py+.006*wPatch+ledgeUp+cobbleH+benchOutcrop+washChannel;
  pz=wz+ledgeOut*outZ;
 }
 if(mode==1u){return vec4<f32>(bed,max(0.,soil-cobbleOut*1.8),wPatch,rawSlope);}
 return vec4<f32>(px,py,pz,1.);
}`);

const zoomNormKernel=wgslFn(`fn hill_zoom_norm(v:u32,zn:u32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,useFormed:f32,posBuf:ptr<storage,array<vec4<f32>>,read_write>,metaBuf:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%zn;let zi=v/zn;
 let p=(*posBuf)[v];let m=(*metaBuf)[v];
 let l=(*posBuf)[v-select(0u,1u,xi>0u)].xyz;let r=(*posBuf)[v+select(0u,1u,xi+1u<zn)].xyz;
 let u=(*posBuf)[v-select(0u,zn,zi>0u)].xyz;let d=(*posBuf)[v+select(0u,zn,zi+1u<zn)].xyz;
 var nVec=normalize(cross(d-u,r-l));
 if(useFormed>.5&&meso>0.){
  let exposed=exp(-m.y/.045);let cliffMask=smoothstep(.25,1.0,m.w)*exposed;
  let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=p.x*ca+p.z*sa;let rz=-p.x*sa+p.z*ca;
  let dipScale=1.-.88*clamp(stepStyle,0.,1.);
  let warp=.28*sin(rx*.55+rz*.35+seed*.03)+.16*cos(rz*.85-rx*.45);
  let phase=(m.x-dipScale*tilt*rx-dipScale*fold*(sin(rz*.7+rx*.2)+warp)+seed*.017)/thickness;
  let ledgeStep=cos(phase*6.2831853)+.55*cos(phase*18.849556);
  let jointX=cos(rx*7.5+rz*2.8+warp*2.+seed*.17);
  let jointZ=sin(rz*7.5-rx*2.8-warp*2.+seed*.31);
  let amp=meso*cliffMask*.26;
  nVec=normalize(vec3<f32>(nVec.x-amp*(.45*jointX+.55*ledgeStep*ca),nVec.y,nVec.z-amp*(.45*jointZ+.55*ledgeStep*sa)));
 }
 return vec4<f32>(nVec,0.);
}`);

export function createTerrainGPU(geometry,input={}){
 let config=terrainConfig(input),ridges=makeRidges(config);const n=config.resolution,count=n*n,attributes=[],nodes=[];
 const attribute=(array,size,label)=>{const a=new StorageBufferAttribute(array,size);a.name='hill-'+label;attributes.push(a);return a;};
 const stateAttributes=[0,1].map(i=>attribute(new Float32Array(count*4),4,'state-'+i)),states=stateAttributes.map(a=>storage(a,'vec4',count));
 const flowAttribute=attribute(new Float32Array(count*4),4,'transport'),flows=storage(flowAttribute,'vec4',count);
 const bankAttribute=attribute(new Float32Array(count*4),4,'bank-collapse'),banks=storage(bankAttribute,'vec4',count);
 const ridgeAttribute=attribute(Float32Array.from(ridges.flatMap(e=>[...e.a,...e.b])),4,'initial-ridges'),ridgeNode=storage(ridgeAttribute,'vec4',ridges.length*2);
 const positions=attribute(new Float32Array(count*4),4,'positions'),normals=attribute(new Float32Array(count*4),4,'normals'),colors=attribute(new Float32Array(count*4),4,'colors');
 geometry.setAttribute('position',positions);geometry.setAttribute('normal',normals);geometry.setAttribute('color',colors);
 const displayAttribute=attribute(new Float32Array(count*4),4,'display-state'),displayState=storage(displayAttribute,'vec4',count),alpha=uniform(1);
 const interpolators=states.map((state,i)=>Fn(()=>{displayState.element(instanceIndex).assign(mix(states[1-i].element(instanceIndex),state.element(instanceIndex),alpha));})().compute(count));
 const positionNode=storage(positions,'vec4',count),normalNode=storage(normals,'vec4',count),colorNode=storage(colors,'vec4',count);
 const formedAttribute=attribute(new Float32Array(count*4),4,'formed-source'),formedNode=storage(formedAttribute,'vec4',count),useFormed=uniform(0);
 const geoTilt=uniform(.14),geoStrike=uniform(16),geoFold=uniform(.14),geoThickness=uniform(.34),geoHardness=uniform(9.2),geoWeathering=uniform(.00065),geoIncision=uniform(.068),geoSeed=uniform(47),geoStepStyle=uniform(.85),geoMeso=uniform(.78);
 const dt=uniform(.05),drive=uniform(config.uplift),talus=uniform(Math.tan(config.repose*Math.PI/180)),fraction=uniform(0),soil=uniform(config.soil);

 // Camera-centered arbitrary-zoom 3D detail patch (129x129 = 32,768 triangles)
 const zoomN=129,zoomCount=zoomN*zoomN,zoomIndices=new Uint32Array((zoomN-1)**2*6);
 let zk=0;for(let z=0;z<zoomN-1;z++)for(let x=0;x<zoomN-1;x++){const a=z*zoomN+x;zoomIndices[zk++]=a;zoomIndices[zk++]=a+zoomN;zoomIndices[zk++]=a+1;zoomIndices[zk++]=a+1;zoomIndices[zk++]=a+zoomN;zoomIndices[zk++]=a+zoomN+1;}
 const zoomGeometry=new BufferGeometry();zoomGeometry.setIndex(new BufferAttribute(zoomIndices,1));
 zoomGeometry.boundingBox=new Box3(new Vector3(-config.width/2,-2,-config.length/2),new Vector3(config.width/2,8,config.length/2));
 zoomGeometry.boundingSphere=zoomGeometry.boundingBox.getBoundingSphere(new Sphere());
 const zoomPositions=attribute(new Float32Array(zoomCount*4),4,'zoom-positions'),zoomNormals=attribute(new Float32Array(zoomCount*4),4,'zoom-normals'),zoomColors=attribute(new Float32Array(zoomCount*4),4,'zoom-colors'),zoomMetaAttr=attribute(new Float32Array(zoomCount*4),4,'zoom-meta');
 zoomGeometry.setAttribute('position',zoomPositions);zoomGeometry.setAttribute('normal',zoomNormals);zoomGeometry.setAttribute('color',zoomColors);
 const zoomPosNode=storage(zoomPositions,'vec4',zoomCount),zoomNormNode=storage(zoomNormals,'vec4',zoomCount),zoomColNode=storage(zoomColors,'vec4',zoomCount),zoomMetaNode=storage(zoomMetaAttr,'vec4',zoomCount);
 const focusX=uniform(0),focusZ=uniform(0),focusRadius=uniform(3.2),zoomEnabled=uniform(1);

 const initializers=states.map(state=>Fn(()=>{state.element(instanceIndex).assign(mix(init({v:instanceIndex,n:uint(n),width:float(config.width),length:float(config.length),soil,ridges:ridgeNode}),formedNode.element(instanceIndex),useFormed));})().compute(count));
 const solvers=states.map((state,i)=>[
  Fn(()=>{flows.element(instanceIndex).assign(flux({v:instanceIndex,n:uint(n),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),talus,fraction,state}));})().compute(count),
  Fn(()=>{states[1-i].element(instanceIndex).assign(move({v:instanceIndex,n:uint(n),width:float(config.width),length:float(config.length),dt,uplift:drive,state,flow:flows}));})().compute(count)
 ]);
 const geologySolvers=states.map((state,i)=>[
  Fn(()=>{flows.element(instanceIndex).assign(flux({v:instanceIndex,n:uint(n),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),talus,fraction,state}));})().compute(count),
  Fn(()=>{banks.element(instanceIndex).assign(geologyBankFlux({v:instanceIndex,n:uint(n),width:float(config.width),length:float(config.length),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,hardness:geoHardness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,state}));})().compute(count),
  Fn(()=>{states[1-i].element(instanceIndex).assign(geologyMove({v:instanceIndex,n:uint(n),width:float(config.width),length:float(config.length),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,hardness:geoHardness,weathering:geoWeathering,incision:geoIncision,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,state,flow:flows,bank:banks}));})().compute(count)
 ]);
 const publishers=states.map(()=>Fn(()=>{
  const state=displayState;
  const v=instanceIndex,s=state.element(v),x=v.mod(uint(n)).toFloat().div(n-1).sub(.5).mul(config.width),z=v.div(uint(n)).toFloat().floor().div(n-1).sub(.5).mul(config.length);
  positionNode.element(v).assign(initPosition(x,s.x.add(s.y),z));
  const norm=normal({v,n:uint(n),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),x,z,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,useFormed,state});
  normalNode.element(v).assign(norm);
  const cover=s.y.mul(4).clamp(0,1),steep=float(1).sub(norm.y).mul(1.3).clamp(0,1),exposed=steep.mul(float(1).sub(cover.mul(.4)));
  const legacyColor=initPosition(float(.30).add(exposed.mul(.12)).add(cover.mul(.05)),float(.36).sub(exposed.mul(.04)).add(cover.mul(.10)),float(.20).add(exposed.mul(.08)));
  colorNode.element(v).assign(mix(legacyColor,formedColor({x,z,bed:s.x,soil:s.y,nx:norm.x,ny:norm.y,nz:norm.z,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso}),useFormed));
 })().compute(count));
 const zoomPosPublisher=Fn(()=>{
  const v=instanceIndex;
  zoomPosNode.element(v).assign(zoomSurfaceKernel({v,zn:uint(zoomN),n:uint(n),width:float(config.width),length:float(config.length),fx:focusX,fz:focusZ,fr:focusRadius,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,useFormed,mode:uint(0),state:displayState}));
  zoomMetaNode.element(v).assign(zoomSurfaceKernel({v,zn:uint(zoomN),n:uint(n),width:float(config.width),length:float(config.length),fx:focusX,fz:focusZ,fr:focusRadius,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,useFormed,mode:uint(1),state:displayState}));
 })().compute(zoomCount);
 const zoomNormPublisher=Fn(()=>{
  const v=instanceIndex,norm=zoomNormKernel({v,zn:uint(zoomN),tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,useFormed,posBuf:zoomPosNode,metaBuf:zoomMetaNode}),p=zoomPosNode.element(v),m=zoomMetaNode.element(v);
  zoomNormNode.element(v).assign(norm);
  zoomColNode.element(v).assign(formedColor({x:p.x,z:p.z,bed:m.x,soil:m.y,nx:norm.x,ny:norm.y,nz:norm.z,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso}));
 })().compute(zoomCount);
 nodes.push(...initializers,...solvers.flat(),...geologySolvers.flat(),...interpolators,...publishers,zoomPosPublisher,zoomNormPublisher);

 let renderer=null,initialized=false,index=0,steps=0,preparationSteps=0,seconds=0,disposed=false,pendingPresentation=true,pendingZoom=true,generation=0,error=null,formationProvenance=null;
 const gpuError=e=>{error=e.error?.message??String(e);};
 function bind(r){
  if(disposed)throw Error('Hill simulator disposed');
  if(!r?.backend?.isWebGPUBackend||!r.backend.device)throw Error('Hill requires the actual host WebGPU renderer; no CPU fallback');
  if(renderer&&renderer!==r)throw Error('Hill renderer changed');if(!renderer){renderer=r;renderer.backend.device.addEventListener('uncapturederror',gpuError);renderer.backend.device.lost.then(info=>{if(!disposed)error=info.message||'Hill GPU device lost';});}
  const bytes=count*16,limits=r.backend.device.limits;if(bytes>limits.maxStorageBufferBindingSize||bytes>limits.maxBufferSize||Math.ceil(count/64)>limits.maxComputeWorkgroupsPerDimension)throw Error('Hill grid exceeds effective GPU limits');
  if(!initialized){renderer.compute(initializers);index=0;initialized=true;pendingPresentation=true;pendingZoom=true;}
 }
 function flush(r){
  bind(r);if(error)throw Error(error);
  const runMain=pendingPresentation,runZoom=(pendingPresentation||pendingZoom)&&useFormed.value>.5&&zoomEnabled.value>.5;
  if(runMain){renderer.compute([interpolators[index],publishers[index]]);pendingPresentation=false;}
  if(runZoom){renderer.compute([zoomPosPublisher,zoomNormPublisher]);pendingZoom=false;}
 }
 function advance(countSteps=1,{preparation=false}={}){
  if(!renderer||!initialized||disposed)throw Error('Hill GPU must be mounted before stepping');if(error)throw Error(error);
  if(!Number.isSafeInteger(countSteps)||countSteps<1)throw Error('Positive whole step count required');
  dt.value=.05;drive.value=preparation?0:config.uplift;talus.value=Math.tan(config.repose*Math.PI/180);fraction.value=1-Math.exp(-config.transport*dt.value);
  for(let j=0;j<countSteps;j++){renderer.compute(solvers[index]);index=1-index;if(preparation)preparationSteps++;else{steps++;seconds+=dt.value;}}
  pendingPresentation=true;pendingZoom=true;return read();
 }
 function stepGeology(countSteps=20){
  if(!renderer||!initialized||disposed)throw Error('Hill GPU must be mounted before stepping');if(error)throw Error(error);
  if(!Number.isSafeInteger(countSteps)||countSteps<1)throw Error('Positive whole step count required');
  talus.value=Math.tan(config.repose*Math.PI/180);fraction.value=.22;
  for(let j=0;j<countSteps;j++){renderer.compute(geologySolvers[index]);index=1-index;preparationSteps++;}
  if(formationProvenance)formationProvenance={...formationProvenance,preparationSteps:(formationProvenance.preparationSteps??0)+countSteps};
  pendingPresentation=true;pendingZoom=true;flush(renderer);return read();
 }
 function setCameraFocus({target=[0,1.2,0],position=null,distance=null,enabled=true}={}){
  const en=enabled?1:0;
  const tx=Number.isFinite(target?.[0])?target[0]:0,ty=Number.isFinite(target?.[1])?target[1]:1.2,tz=Number.isFinite(target?.[2])?target[2]:0;
  const dist=Number.isFinite(distance)&&distance>0?distance:(Array.isArray(position)&&position.length>=3?Math.hypot(position[0]-tx,position[1]-ty,position[2]-tz):10);
  const rawR=Math.max(.22,Math.min(3.4,dist*.44));
  const qR=Math.pow(2,Math.round(Math.log2(rawR)*4)/4),r=Math.max(.22,Math.min(3.4,qR));
  const step=(2*r)/(zoomN-1);
  const maxX=Math.max(.2,config.width*.5-.25),maxZ=Math.max(.2,config.length*.5-.25);
  const cx=Math.max(-maxX,Math.min(maxX,Math.round(tx/step)*step));
  const cz=Math.max(-maxZ,Math.min(maxZ,Math.round(tz/step)*step));
  if(zoomEnabled.value!==en||Math.abs(focusX.value-cx)>1e-5||Math.abs(focusZ.value-cz)>1e-5||Math.abs(focusRadius.value-r)>1e-5){
   zoomEnabled.value=en;focusX.value=cx;focusZ.value=cz;focusRadius.value=r;pendingZoom=true;
  }
  return read();
 }
 function configure(patch){
  const next=terrainConfig({...config,...patch});for(const key of ['resolution','width','length'])if(next[key]!==config[key])throw Error('Grid changes require a new simulator instance');
  if(next.seed!==config.seed||next.layout!==config.layout||next.soil!==config.soil)throw Error('Initial conditions require regenerate');config=next;return read();
 }
 function regenerate(patch={}){const next=terrainConfig({...config,...patch});for(const key of ['resolution','width','length'])if(next[key]!==config[key])throw Error('Grid changes require a new simulator instance');config=next;formationProvenance=null;useFormed.value=0;ridges=makeRidges(config);ridgeAttribute.array.set(ridges.flatMap(e=>[...e.a,...e.b]));ridgeAttribute.needsUpdate=true;soil.value=config.soil;initialized=false;steps=0;preparationSteps=0;seconds=0;generation++;if(renderer)flush(renderer);return read();}
 function read(){
  const spacing=(2*focusRadius.value)/(zoomN-1);
  return{route:ROUTE,backend:renderer?'webgpu':'unbound',initialized,config:{...config},generation,steps,preparationSteps,seconds,stateIndex:index,readbackInRuntime:false,error,representation:{kind:'height-material-grid',samples:count,triangles:(n-1)**2*2,bytes:attributes.reduce((s,a)=>s+a.array.byteLength,0),fields:['substrate_height','loose_depth','vertical_velocity','actor_memory']},zoomDetail:{enabled:Boolean(zoomEnabled.value>.5),resolution:zoomN,samples:zoomCount,triangles:(zoomN-1)**2*2,focusX:focusX.value,focusZ:focusZ.value,focusRadius:focusRadius.value,vertexSpacing:spacing},capabilities:{initialConditions:true,prepare:true,advance:true,gpuGeology:true,arbitraryZoom3D:true,gpuSurface:true,actorHistoryIngress:false,fluidCoupling:false,cpuSurfaceQueries:false},provenance:formationProvenance??{seed:config.seed,layout:config.layout},clock:{dt:.05,displayAlpha:alpha.value,authority:'submitted_gpu_steps'},surfaceSelection:'scene-object-row; exact surface picking unavailable'};
 }
 const applyFragShader=material=>{
  material.colorNode=fragFormedColor({vColor:tslAttribute('color','vec4'),x:positionLocal.x,y:positionLocal.y,z:positionLocal.z,nx:normalLocal.x,ny:normalLocal.y,nz:normalLocal.z,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,useFormed});
  return material;
 };
 return{bind,flush,advance,stepGeology,setCameraFocus,configure,regenerate,read,zoomGeometry,
  decorateMaterial:applyFragShader,
  decorateZoomMaterial:applyFragShader,
  loadFormation(result){
   if(result.config.resolution!==n||result.config.width!==config.width||result.config.length!==config.length)throw Error('Formation grid does not match GPU terrain');
   if(!(result.state instanceof Float32Array)||result.state.length!==count*4||!result.state.every(Number.isFinite))throw Error('Complete finite formed state required');
   geoTilt.value=result.config.tilt;geoStrike.value=result.config.strike??0;geoFold.value=result.config.fold;geoThickness.value=result.config.bedThickness;geoHardness.value=result.config.hardness??9.2;geoWeathering.value=result.config.weathering??.00065;geoIncision.value=result.config.incision??.068;geoSeed.value=result.config.seed;geoStepStyle.value=Math.min(1,Math.max(0,.65*(result.config.mesa??0)+.65*(result.config.terrace??0)));geoMeso.value=result.config.meso??.78;
   formationProvenance={kind:'formed-landscape',version:result.version,recipe:{...result.config},preparationSteps:result.steps};
   formedAttribute.array.set(result.state);formedAttribute.needsUpdate=true;useFormed.value=1;initialized=false;steps=0;preparationSteps=0;seconds=0;generation++;alpha.value=1;pendingZoom=true;if(renderer)flush(renderer);return read();
  },
  present(value){if(!Number.isFinite(value)||value<0||value>1)throw Error("Terrain interpolation must be in [0,1]");if(alpha.value!==value){alpha.value=value;pendingPresentation=true;pendingZoom=true;}},
  surface:()=>{if(!renderer)throw Error('Hill GPU not mounted');flush(renderer);return{device:renderer.backend.device,state:renderer.backend.get(displayAttribute).buffer,currentState:renderer.backend.get(stateAttributes[index]).buffer,previousState:renderer.backend.get(stateAttributes[1-index]).buffer,alpha:alpha.value,positions:renderer.backend.get(positions).buffer,normals:renderer.backend.get(normals).buffer,zoomPositions:renderer.backend.get(zoomPositions).buffer,zoomNormals:renderer.backend.get(zoomNormals).buffer,resolution:n,width:config.width,length:config.length,generation,steps};},
  async snapshot({presentation=false}={}){if(!renderer||disposed)throw Error('Hill GPU not mounted');flush(renderer);const identity=read(),values=new Float32Array(await renderer.getArrayBufferAsync(stateAttributes[index]));if(values.length!==count*4||!values.every(Number.isFinite))throw Error('Invalid Hill GPU snapshot');const result={identity,values};if(presentation){result.display=new Float32Array(await renderer.getArrayBufferAsync(displayAttribute));result.positions=new Float32Array(await renderer.getArrayBufferAsync(positions));}return result;},
  dispose(){if(disposed)return;disposed=true;for(const node of nodes)node.dispose();zoomGeometry.dispose();if(renderer){renderer.backend.device.removeEventListener('uncapturederror',gpuError);for(const a of attributes)if(![positions,normals,colors,zoomPositions,zoomNormals,zoomColors].includes(a))renderer._attributes.delete(a);}}
 };
}
const initPosition=wgslFn('fn hill_vec4(x:f32,y:f32,z:f32)->vec4<f32>{return vec4<f32>(x,y,z,1.);}');
