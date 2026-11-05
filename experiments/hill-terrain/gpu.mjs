import {BufferGeometry,BufferAttribute,Box3,Vector3,Sphere,DataTexture,NearestFilter} from '../../lib/three.core.js';
import {StorageBufferAttribute} from '../../lib/three.webgpu.js';
import {storage,Fn,If,wgslFn,instanceIndex,uint,float,uniform,mix,attribute as tslAttribute,positionLocal,normalView,positionViewDirection} from '../../lib/three.tsl.js';
import {terrainConfig,makeRidges,ROUTE} from './model.mjs';
import {detailLattice,baseMaskTransform} from './lod.mjs';
import {mesoAuthoringConfig,VIEW_MODES} from './formation.mjs';

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
 let avail=max(0.,s.x-.08);
 let bSum=b.x+b.y+b.z+b.w;
 if(bSum>0.){b=b*(min(avail*.45,bSum)/bSum);}
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
 let availBed=max(0.,s.x-.08-bankLoss);
 let rockToSoil=min(availBed,weath+chuteCut);
 let nextBed=s.x-bankLoss-rockToSoil;
 let nextSoil=max(0.,s.y+rockToSoil+inBank+inSoil-f.x-f.y-f.z-f.w);
 return vec4<f32>(nextBed,nextSoil,0.,0.);
}`);
const normal=wgslFn(`fn hill_normal(v:u32,n:u32,dx:f32,dz:f32,x:f32,z:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,ledge:f32,crag:f32,rill:f32,viewMode:f32,useFormed:f32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%n;let zi=v/n;let l=(*state)[v-select(0u,1u,xi>0u)];let r=(*state)[v+select(0u,1u,xi+1u<n)];let b=(*state)[v-select(0u,n,zi>0u)];let f=(*state)[v+select(0u,n,zi+1u<n)];
 var gx=(r.x+r.y-l.x-l.y)/(dx*select(1.,2.,xi>0u&&xi+1u<n));var gz=(f.x+f.y-b.x-b.y)/(dz*select(1.,2.,zi>0u&&zi+1u<n));
 if(useFormed>.5&&meso>0.&&(viewMode<.5||viewMode>1.5)){
  let s=(*state)[v];let rawSlope=sqrt(gx*gx+gz*gz);
  let slopeStrip=smoothstep(.42,1.15,rawSlope)*(1.-smoothstep(.045,.26,s.y));
  let exposed=exp(-(s.y*(1.-.88*slopeStrip))/.045);
  let cliffMask=smoothstep(.28,1.15,rawSlope);
  let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
  let dipScale=1.-.88*clamp(stepStyle,0.,1.);
  let warp=.28*sin(rx*.55+rz*.35+seed*.03)+.16*cos(rz*.85-rx*.45);
  let phase=(s.x-dipScale*tilt*rx-dipScale*fold*(sin(rz*.7+rx*.2)+warp)+seed*.017)/thickness;
  let eCrag=select(crag,0.,viewMode>1.5&&viewMode<2.5);
  let eRill=select(rill,0.,viewMode>1.5&&viewMode<2.5);
  let ledgeStep=ledge*(cos(phase*6.2831853)+.48*cos(phase*18.849556));
  let jointX=eCrag*cos(rx*7.5+rz*2.8+warp*2.+seed*.17);
  let jointZ=eCrag*sin(rz*7.5-rx*2.8-warp*2.+seed*.31);
  let cliffAmp=meso*exposed*cliffMask*.28;
  let rillRipple=eRill*cos(x*10.+.5*sin(z*6.+seed*.2));
  let rillAmp=meso*(1.-exposed)*(1.-cliffMask)*.025;
  gx+=cliffAmp*(.45*jointX+.55*ledgeStep*ca)+rillAmp*rillRipple;
  gz+=cliffAmp*(.45*jointZ+.55*ledgeStep*sa);
 }
 return vec4<f32>(normalize(vec3<f32>(-gx,1.,-gz)),0.);
}`);

const geoHash3=wgslFn(`fn hill_h3(p:vec3<f32>)->f32{
 var q=fract(p*vec3<f32>(.1031,.1030,.0973));
 q+=dot(q,q.yxz+vec3<f32>(33.33));
 return fract((q.x+q.y)*q.z);
}`);
// C2-continuous quintic 3D value noise (zero lattice derivative creases)
const geoNoise3=wgslFn(`fn hill_n3(p:vec3<f32>)->f32{
 let i=floor(p);let f=fract(p);
 let u=f*f*f*(f*(f*6.-vec3<f32>(15.))+vec3<f32>(10.));
 let n00=mix(hill_h3(i),hill_h3(i+vec3<f32>(1.,0.,0.)),u.x);
 let n10=mix(hill_h3(i+vec3<f32>(0.,1.,0.)),hill_h3(i+vec3<f32>(1.,1.,0.)),u.x);
 let n01=mix(hill_h3(i+vec3<f32>(0.,0.,1.)),hill_h3(i+vec3<f32>(1.,0.,1.)),u.x);
 let n11=mix(hill_h3(i+vec3<f32>(0.,1.,1.)),hill_h3(i+vec3<f32>(1.,1.,1.)),u.x);
 return mix(mix(n00,n10,u.y),mix(n01,n11,u.y),u.z);
}`,[geoHash3]);
// Incommensurably rotated 2-octave C2 3D FBM (rotates both octaves off the X/Y/Z axes to eliminate lattice grid artifacts)
const geoFbm3=wgslFn(`fn hill_fbm3(p:vec3<f32>)->f32{
 let r1=vec3<f32>(.88*p.x+.28*p.y-.38*p.z,-.32*p.x+.93*p.y+.18*p.z,.35*p.x-.22*p.y+.91*p.z)+vec3<f32>(5.7,13.1,23.9);
 let a=hill_n3(r1);
 let q=vec3<f32>(.80*p.x-.48*p.y+.36*p.z,.48*p.x+.84*p.y+.25*p.z,-.36*p.x+.25*p.y+.90*p.z)*2.07+vec3<f32>(17.3,31.7,47.1);
 let b=hill_n3(q);
 return (a+.5*b)/1.5-.5;
}`,[geoNoise3]);
// Periodic C2 asymmetric sedimentary stratum profile:
// u = fract(phase) in [0, 1). Satisfies f(0) == f(1) == 0 and f'(0) == f'(1) == 0
// so there is zero discontinuity at integer phase boundaries, while shaping each stratum into:
// - a deep recessed shale undercut (u in 0.02..0.25),
// - a steep chiseled sandstone riser face (u in 0.22..0.44),
// - a sharp overhanging sandstone rim (u ~ 0.45), and
// - a weathered structural bench tread (u in 0.46..0.92).
// Returns vec3(protrusion, undercutDepth, riserSlope).
const geoLedgeProfile=wgslFn(`fn hill_ledge(phase:f32)->vec3<f32>{
 let a=phase*6.28318530718;
 let s1=sin(a);let c1=cos(a);
 let s2=sin(2.*a);let c2=cos(2.*a);
 let s3=sin(3.*a);
 let prof=.64*s1-.26*c2+.10*s3;
 let undercut=clamp(-.55*s1+.25*c2,0.,1.);
 let riser=clamp(.65*c1+.25*s2,-.6,1.);
 return vec3<f32>(prof,undercut,riser);
}`);

// Anisotropic 3D craggy rock buttress & staggered conjugate vertical fracture clefts (no honeycomb loops):
// Returns vec3(blockRelief, cleftDepth, facetSlopeX).
const geoRockCrag=wgslFn(`fn hill_crag(rx:f32,bed:f32,rz:f32,phase:f32,seed:f32)->vec3<f32>{
 let bedShift=.32*sin(phase*6.2831853);
 let nA=hill_fbm3(vec3<f32>(rx+bedShift,bed*.42,rz+seed*.19));
 let nB=hill_fbm3(vec3<f32>(rx*.72-rz*.68-bedShift*.7,bed*.48,rx*.68+rz*.72+seed*.31));
 let rA=1.-sqrt(nA*nA+.025)*1.85;
 let rB=1.-sqrt(nB*nB+.025)*1.85;
 let cleftA=smoothstep(.45,.72,rA);
 let cleftB=smoothstep(.48,.74,rB);
 let cleft=clamp(cleftA+.60*cleftB,0.,1.);
 let rib=clamp(.55*rA+.45*rB,-.45,.65)*(1.-.50*cleft);
 let facet=(nA*1.15-nB*.85)*(1.-.4*cleft);
 return vec3<f32>(rib,cleft,facet);
}`,[geoFbm3]);

// Beveled 2D Voronoi talus boulders & scree cobbles for loose rock slopes:
// Returns vec4(d1, edgeDist = d2-d1, beveledId, beveledTilt).
const geoVoronoi2=wgslFn(`fn hill_vor2(p:vec2<f32>,layerSeed:f32)->vec4<f32>{
 let g=floor(p);let f=fract(p);
 var d1=8.;var d2=8.;var id=0.;var tilt=0.;
 for(var j=-1;j<=1;j++){
  for(var i=-1;i<=1;i++){
   let o=vec2<f32>(f32(i),f32(j));
   let c=g+o;
   let hA=hill_h3(vec3<f32>(c.x,c.y,layerSeed));
   let hB=hill_h3(vec3<f32>(c.x+17.1,c.y+31.7,layerSeed*1.3+7.9));
   let hC=hill_h3(vec3<f32>(c.x+53.3,c.y+11.9,layerSeed*1.7+19.3));
   let r=o+vec2<f32>(.16+.68*hA,.16+.68*hB)-f;
   let d=sqrt(dot(r,r));
   if(d<d1){
    d2=d1;d1=d;id=hC;
    tilt=r.x*(hA-.5)+r.y*(hB-.5);
   }else if(d<d2){
    d2=d;
   }
  }
 }
 let edgeDist=max(0.,d2-d1);
 let bevel=smoothstep(0.,.18,edgeDist);
 return vec4<f32>(d1,edgeDist,bevel*(id-.5),bevel*tilt);
}`,[geoHash3]);

const formedColor=wgslFn(`fn hill_geological_color(x:f32,z:f32,bed:f32,soil:f32,disp:f32,nx:f32,ny:f32,nz:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,ledge:f32,crag:f32,cobble:f32,rill:f32,viewMode:f32)->vec4<f32>{
 let steep=clamp(1.-ny,0.,1.);
 let sStyle=clamp(stepStyle,0.,1.);
 let slopeStrip=smoothstep(.16+.12*(1.-sStyle),.44+.12*(1.-sStyle),steep)*(1.-smoothstep(.048,.24,soil));
 let effSoil=soil*(1.-.82*slopeStrip);
 let soilScale=mix(.014,.044,smoothstep(.04,.26,steep));
 let rawExp=exp(-effSoil/soilScale);
 let exposed=rawExp;
 if(viewMode>.5&&viewMode<1.5){
  let simEarth=vec3<f32>(.125,.192,.072);
  let simRock=vec3<f32>(.32,.255,.185);
  let simSrgb=mix(simEarth,simRock,exposed);
  return vec4<f32>(simSrgb*simSrgb*1.45,exposed);
 }
 if(viewMode>2.5){
  return vec4<f32>(exposed,clamp(soil/.10,0.,1.),clamp(disp*28.,0.,1.),exposed);
 }
 let eCrag=select(crag,0.,viewMode>1.5&&viewMode<2.5);
 let eCob=select(cobble,0.,viewMode>1.5&&viewMode<2.5);
 let eRill=select(rill,0.,viewMode>1.5&&viewMode<2.5);
 let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
 let dipScale=1.-.88*sStyle;
 let warp=.36*hill_fbm3(vec3<f32>(rx*.55,bed*.45,rz*.55+seed*.13));
 let blockShift=.28*hill_fbm3(vec3<f32>(rx*1.35+seed*.07,bed*.65,rz*1.35-seed*.11));
 let phase=(bed-dipScale*tilt*rx-dipScale*fold*warp+seed*.017)/thickness+blockShift*(1.-.55*sStyle);
 // Lateral lens pinch-out & aperiodic bed hierarchy so strata form natural discontinuous outcrops, never zebra stripes
 let lensMask=clamp(.48+.95*hill_fbm3(vec3<f32>(rx*.78-seed*.09,bed*.42,rz*.78+seed*.15)),.10,1.);
 let bedWeight=clamp(.22+.78*sStyle,.22,1.)*lensMask;
 let l0=hill_ledge(phase);
 let l1=hill_ledge(phase*1.618034+.18*blockShift);
 let aperiodicBand=.5+.34*sin(phase*6.2831853)+.16*sin(phase*3.883222+.9);
 let subBand=hill_fbm3(vec3<f32>(rx*2.4,bed*3.2,rz*2.4+seed*.23));
 let stratMix=clamp(.5+(mix(aperiodicBand-.5,.42*l0.x+.20*l1.x,.62*sStyle))*bedWeight+.24*subBand,0.,1.);
 let cliffWall=smoothstep(.10,.36,steep);
 let cragVal=hill_crag(rx*1.5,bed*1.4,rz*1.5,phase,seed);
 let crevice=clamp(meso*eCrag*cragVal.y*cliffWall,0.,.75);
 let undercut=clamp(meso*ledge*l0.y*cliffWall*bedWeight*.55,0.,.65);
 let darkRock=vec3<f32>(.205,.172,.138);
 let warmOchre=vec3<f32>(.295,.238,.176);
 let buffSand=vec3<f32>(.365,.305,.232);
 let greyCrag=vec3<f32>(.255,.242,.222);
 var rock=mix(darkRock,mix(warmOchre,buffSand,smoothstep(.48,.86,stratMix)),stratMix);
 rock=mix(rock,greyCrag,clamp((1.-sStyle)*.42+.22*cragVal.x,0.,.65));
 rock=rock*(1.+.12*eCrag*cragVal.x*cliffWall)*(1.-.32*crevice-.26*undercut);
 let screeZone=clamp(smoothstep(.005,.022,effSoil)*(1.-smoothstep(.032,.072,effSoil))*smoothstep(.08,.28,steep),0.,1.);
 let screeColor=vec3<f32>(.245,.212,.162);
 let gullyNoise=hill_fbm3(vec3<f32>(x*1.35+.35*warp,bed*.95,z*1.35-.35*warp+seed*.17));
 let valleyMeadow=vec3<f32>(.108,.182,.064);
 let hillTurf=vec3<f32>(.138,.204,.074);
 let uplandTurf=vec3<f32>(.165,.208,.086);
 let stonyWash=vec3<f32>(.210,.192,.132);
 let hillElev=smoothstep(.20,1.75,bed);
 let turfMix=mix(valleyMeadow,mix(hillTurf,uplandTurf,smoothstep(.45,.95,hillElev)),hillElev*(.55+.45*smoothstep(-.25,.28,gullyNoise)));
 let rillMask=clamp(meso*eRill*.34*smoothstep(.16,.42,gullyNoise)*smoothstep(.05,.24,steep)*(1.-cliffWall),0.,.68);
 let earth=mix(turfMix,stonyWash,rillMask);
 let ground=mix(earth,screeColor,clamp(meso*eCob*.58*screeZone*sStyle,0.,.78));
 let outExp=clamp(exposed+meso*eRill*.16*smoothstep(.18,.46,gullyNoise)*smoothstep(.10,.30,steep)*hillElev,0.,1.);
 let srgb=mix(ground,rock,outExp*.65);
 return vec4<f32>(clamp(srgb*srgb*1.42,vec3<f32>(.02),vec3<f32>(.32)),outExp);
}`,[geoFbm3,geoLedgeProfile,geoRockCrag]);

// Streamlined world-space 3D fragment lithology, discontinuous shelf undercuts,
// conjugate rock fracture clefts, constitutive mineral cleavage, and Voronoi talus clasts.
const fragFormedColor=wgslFn(`fn hill_frag_color(vColor:vec4<f32>,x:f32,y:f32,z:f32,nx:f32,ny:f32,nz:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,ledge:f32,crag:f32,cobble:f32,rill:f32,viewMode:f32,useFormed:f32)->vec4<f32>{
 if(useFormed<.5||(viewMode>.5&&viewMode<1.5)){return vec4<f32>(vColor.xyz,1.);}
 if(meso<=0.&&viewMode<2.5){return vec4<f32>(vColor.xyz,1.);}
 let eLedge=ledge;
 let eCrag=select(crag,0.,viewMode>1.5&&viewMode<2.5);
 let eCob=select(cobble,0.,viewMode>1.5&&viewMode<2.5);
 let eRill=select(rill,0.,viewMode>1.5&&viewMode<2.5);
 // Constitutive micro-cleavage and mineral grain are always active at full resolution (1.6x)
 // so lowering the Outcrop & gully rill slider never makes the surface look blurry or unresolved.
 let cGrain=select(1.6,0.,viewMode>1.5&&viewMode<2.5);
 let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=x*ca+z*sa;let rz=-x*sa+z*ca;
 let sStyle=clamp(stepStyle,0.,1.);
 let dipScale=1.-.88*sStyle;
 let warp=.36*hill_fbm3(vec3<f32>(rx*.55,y*.45,rz*.55+seed*.13));
 let nWarp=hill_fbm3(vec3<f32>(rx*2.2,y*2.6,rz*2.2+seed*.3));
 let lensMask=clamp(.45+.95*hill_fbm3(vec3<f32>(rx*.78-seed*.09,y*.42,rz*.78+seed*.15)),.08,1.);
 let bedWeight=clamp(.20+.80*sStyle,.20,1.)*lensMask;
 let phase=(y-dipScale*tilt*rx-dipScale*fold*warp+seed*.017)/thickness+.18*nWarp*(1.-.45*sStyle);
 let steep=clamp(1.-ny,0.,1.);
 let rawExp=clamp(vColor.w,0.,1.);
 let crag0=hill_crag(rx*1.8,y*1.5,rz*1.8,phase,seed);
 let crag1=hill_crag(rx*6.8,y*5.6,rz*6.8,phase*2.618,seed+17.3);
 let crag2=hill_crag(rx*24.,y*20.,rz*24.,phase*6.854,seed+41.9);
 let fragOutcrop=smoothstep(.24,.66,rawExp+.18*(1.-sStyle)*nWarp+.10*crag0.x+.08*eRill*nWarp*smoothstep(.08,.28,steep));
 let exposed=mix(rawExp,fragOutcrop,.76*(1.-sStyle));
 let cliffWall=smoothstep(.10,.34,steep)*exposed;
 let l0=hill_ledge(phase);
 let l1=hill_ledge(phase*1.618034+.14*nWarp);
 let l2=hill_ledge(phase*4.236068-.10*nWarp);
 let talusBand=clamp((1.-exposed)*smoothstep(.03,.24,steep)+smoothstep(.15,.58,l0.x*bedWeight)*smoothstep(.12,.48,steep)*(1.-smoothstep(.58,.85,steep)),0.,1.);
 // Retain close grain while filtering wavelengths smaller than a pixel.
 let pixelSpan=max(fwidth(rx),max(fwidth(y),fwidth(rz)));
 let grain0=hill_fbm3(vec3<f32>(rx*28.,y*38.,rz*28.))*cGrain*(1.-smoothstep(.35,.85,pixelSpan*38.));
 let grain1=hill_fbm3(vec3<f32>(rx*110.,y*145.,rz*110.))*cGrain*(1.-smoothstep(.35,.85,pixelSpan*145.));
 let aperiodicBand=.5+.32*sin(phase*6.2831853)+.18*sin(phase*3.883222+.9);
 let ledgeMix=clamp(.5+(.42*l0.x+.24*l1.x+.14*l2.x*cGrain)*bedWeight,0.,1.);
 let stratMix=clamp(mix(.5+(aperiodicBand-.5)*bedWeight,ledgeMix,.68*sStyle)+eCrag*(.16*crag0.x+.11*crag1.x+.07*crag2.x)+.07*grain0+.04*grain1,0.,1.);
 let darkRock=vec3<f32>(.20,.168,.134);
 let warmOchre=vec3<f32>(.29,.235,.174);
 let buffSand=vec3<f32>(.365,.305,.232);
 let greyCrag=vec3<f32>(.25,.238,.218);
 var rockSrgb=mix(darkRock,mix(warmOchre,buffSand,smoothstep(.48,.86,stratMix)),stratMix);
 rockSrgb=mix(rockSrgb,greyCrag,clamp((1.-sStyle)*.44+.22*crag0.x,0.,.68));
 let cleft=clamp(eCrag*(.52*crag0.y+.38*crag1.y+.26*crag2.y),0.,1.)*cliffWall;
 let undercut=clamp(eLedge*(.55*l0.y+.35*l1.y+.20*l2.y)*bedWeight,0.,1.)*cliffWall;
 rockSrgb=rockSrgb*(1.+eCrag*(.14*crag0.x+.10*crag1.x+.07*crag2.x)+.07*grain0+.05*grain1)*(1.-.42*cleft-.34*undercut);
 // Irregular 3D Voronoi talus boulders & cobbles on toe slopes and benches
 let c0=hill_vor2(vec2<f32>(x*4.4+.14*nWarp,z*4.4-.14*nWarp),seed+5.3);
 let c1=hill_vor2(vec2<f32>(x*16.+.06*grain0,z*16.-.06*grain0),seed+23.9);
 let dome0=clamp(1.-c0.x*c0.x*1.35,0.,1.)*smoothstep(.01,.15,c0.y)*clamp(c0.z+.38,0.,1.);
 let dome1=clamp(1.-c1.x*c1.x*1.48,0.,1.)*smoothstep(.01,.14,c1.y)*clamp(c1.z+.38,0.,1.);
 let cobbleDome=(dome0+.72*dome1)*eCob;
 // Micro-ledge & rock-facet normal perturbation
 let dFacetX=eCrag*(crag0.z*1.15+crag1.z*.90+crag2.z*.65)+grain0*.45+grain1*.32;
 let dFacetZ=eCrag*(-crag0.z*.90+crag1.z*.72-crag2.z*.52)+grain0*.38-grain1*.28;
 let dLedgeY=eLedge*(l0.z*1.05+l1.z*.75+l2.z*.45)*bedWeight-.75*undercut;
 let dCobX=eCob*(c0.w*1.55+c1.w*1.15)+grain0*.28;
 let dCobZ=eCob*(-c0.w*1.35+c1.w*.95)-grain1*.28;
 let rillCut=eRill*(1.-exposed)*smoothstep(.03,.28,steep)*nWarp*.35;
 let pnx=nx+meso*(cliffWall*(.58*dFacetX*ca-.42*dFacetZ*sa)+talusBand*.58*dCobX+(1.-cliffWall)*(.18*grain0+rillCut));
 let pny=ny+meso*(cliffWall*.62*dLedgeY+talusBand*.48*cobbleDome);
 let pnz=nz+meso*(cliffWall*(.58*dFacetX*sa+.42*dFacetZ*ca)+talusBand*.58*dCobZ+(1.-cliffWall)*(.18*grain1-rillCut));
 let pNorm=normalize(vec3<f32>(pnx,max(-.12,pny),pnz));
 let baseNorm=normalize(vec3<f32>(nx,max(.08,ny),nz));
 let sunDir=normalize(vec3<f32>(.52,.68,.51));
 let fillDir=normalize(vec3<f32>(-.48,.55,.68));
 if(viewMode>2.5){
  let simRock=clamp(vColor.x*(.38+.62*smoothstep(.04,.34,steep)),0.,1.);
  let simSoil=clamp(vColor.y*1.15,0.,1.)*(1.-.55*simRock);
  let fragProc=clamp(meso*(cliffWall*(.38*eLedge*abs(l0.x+.5*l1.x)*bedWeight+.48*cleft)+talusBand*.55*cobbleDome+(1.-cliffWall)*.22*abs(grain0)),0.,1.);
  let procAmp=clamp(vColor.z*1.5+.48*fragProc,0.,1.);
  let cRock=vec3<f32>(.40,.06,.02)*simRock*(1.-.52*procAmp);
  let cSoil=vec3<f32>(.02,.34,.06)*simSoil*(1.-.52*procAmp);
  let cProc=vec3<f32>(.02,.20,.44)*procAmp;
  let pShade=clamp(.52+.38*dot(pNorm,sunDir)+.14*dot(pNorm,fillDir),.32,1.08);
  let provLin=clamp((vec3<f32>(.012,.015,.02)+cRock+cSoil+cProc)*pShade,vec3<f32>(0.),vec3<f32>(.65));
  return vec4<f32>(provLin,1.);
 }
 let dSun=(dot(pNorm,sunDir)-dot(baseNorm,sunDir))*1.45;
 let dFill=(dot(pNorm,fillDir)-dot(baseNorm,fillDir))*.75;
 let microShade=clamp(1.+dSun+dFill,0.62,1.26);
 let rockLin=clamp(rockSrgb*rockSrgb*1.38,vec3<f32>(.025),vec3<f32>(.28));
 // Preserve the rock hierarchy and geometric clasts without painting every
 // nearest-site cell tan or outlining the cells with green substrate.
 let groundLin=vColor.xyz*(1.+.10*grain0+.07*grain1);
 let finalLin=mix(groundLin,rockLin,exposed)*microShade;
 return vec4<f32>(clamp(finalLin,vec3<f32>(.015),vec3<f32>(.34)),1.);
}`,[geoFbm3,geoLedgeProfile,geoRockCrag,geoVoronoi2]);

const zoomCellKernel=wgslFn(`fn hill_cell_xy(ix:u32,iz:u32,n:u32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec2<f32>{
 let c=(*state)[iz*n+ix].xy;
 let l=(*state)[iz*n+select(0u,ix-1u,ix>0u)].xy;
 let r=(*state)[iz*n+min(n-1u,ix+1u)].xy;
 let u=(*state)[select(0u,iz-1u,iz>0u)*n+ix].xy;
 let d=(*state)[min(n-1u,iz+1u)*n+ix].xy;
 let hc=c.x+c.y;
 let hl=l.x+l.y;let hr=r.x+r.y;let hu=u.x+u.y;let hd=d.x+d.y;
 let minN=min(min(hl,hr),min(hu,hd));
 let avgN=.25*(hl+hr+hu+hd);
 if(minN>hc+.015||(c.y>.46&&avgN>hc+.05)){return vec2<f32>(c.x,c.y+max(0.,avgN-hc));}
 return c;
}`);

const sampleTriangleField=wgslFn(`fn hill_sample_field(x:f32,z:f32,n:u32,width:f32,length:f32,field:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let gx=clamp((x/width+.5)*f32(n-1u),0.,f32(n-1u)-.0001);
 let gz=clamp((z/length+.5)*f32(n-1u),0.,f32(n-1u)-.0001);
 let ix=u32(gx);let iz=u32(gz);let u=gx-f32(ix);let v=gz-f32(iz);
 let a=(*field)[iz*n+ix];let b=(*field)[iz*n+ix+1u];
 let c=(*field)[(iz+1u)*n+ix];let d=(*field)[(iz+1u)*n+ix+1u];
 if(u+v<=1.){return a+u*(b-a)+v*(c-a);}
 return d+(1.-u)*(c-d)+(1.-v)*(b-d);
}`);

const basePosKernel=wgslFn(`fn hill_base_pos(v:u32,n:u32,x:f32,y:f32,z:f32,fx:f32,fz:f32,fr:f32,useFormed:f32,zoomOn:f32,state:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 if(useFormed<.5){return vec4<f32>(x,y,z,1.);}
 let c=hill_cell_xy(v%n,v/n,n,state);
 return vec4<f32>(x,c.x+c.y,z,1.);
}`,[zoomCellKernel]);

// Camera-centered height relief on the fixed macro triangles. Smooth source
// gradients guide material placement; they do not replace the macro geometry.
const zoomSurfaceKernel=wgslFn(`fn hill_zoom_surface(v:u32,zn:u32,n:u32,width:f32,length:f32,fx:f32,fz:f32,fr:f32,filterSpacing:f32,gridX:f32,gridZ:f32,stepX:f32,stepZ:f32,camX:f32,camY:f32,camZ:f32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,ledge:f32,crag:f32,cobble:f32,rill:f32,viewMode:f32,useFormed:f32,state:ptr<storage,array<vec4<f32>>,read_write>,macroNormals:ptr<storage,array<vec4<f32>>,read_write>,metaBuf:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%zn;let zi=v/zn;
 // Dyadic subdivision preserves every coarse triangle edge and diagonal.
 // Re-centering translates an integer number of cells; shared vertices stay put.
 let wx=clamp(gridX+(f32(xi)-f32(zn-1u)*.5)*stepX,-width*.5,width*.5);
 let wz=clamp(gridZ+(f32(zi)-f32(zn-1u)*.5)*stepZ,-length*.5,length*.5);
 let fn1=f32(n-1u);
 let gx=clamp((wx/width+.5)*fn1,0.,fn1-.0001);
 let gz=clamp((wz/length+.5)*fn1,0.,fn1-.0001);
 let ix=u32(gx);let iz=u32(gz);
 let tx=gx-f32(ix);let tz=gz-f32(iz);
 let s00=hill_cell_xy(ix,iz,n,state);let s10=hill_cell_xy(min(n-1u,ix+1u),iz,n,state);
 let s01=hill_cell_xy(ix,min(n-1u,iz+1u),n,state);let s11=hill_cell_xy(min(n-1u,ix+1u),min(n-1u,iz+1u),n,state);
 var bedTri=0.;var soilTri=0.;var dhdx=0.;var dhdz=0.;
 let dxGrid=width/fn1;let dzGrid=length/fn1;
 if(tx+tz<=1.){
  bedTri=s00.x+tx*(s10.x-s00.x)+tz*(s01.x-s00.x);
  soilTri=s00.y+tx*(s10.y-s00.y)+tz*(s01.y-s00.y);
  dhdx=(s10.x+s10.y-s00.x-s00.y)/dxGrid;dhdz=(s01.x+s01.y-s00.x-s00.y)/dzGrid;
 }else{
  bedTri=s11.x+(1.-tx)*(s01.x-s11.x)+(1.-tz)*(s10.x-s11.x);
  soilTri=s11.y+(1.-tx)*(s01.y-s11.y)+(1.-tz)*(s10.y-s11.y);
  dhdx=(s11.x+s11.y-s01.x-s01.y)/dxGrid;dhdz=(s11.x+s11.y-s10.x-s10.y)/dzGrid;
 }
 // Filter against the slope of the triangles actually being refined. A smooth
 // derivative underestimates narrow scarps and admits aliased shelf harmonics.
 let rawSlope=sqrt(dhdx*dhdx+dhdz*dhdz);
 let slopeScale=min(2.25,sqrt(1.+rawSlope*rawSlope));
 let dBox=max(abs(wx-fx),abs(wz-fz));
 let distToEdge=max(0.,fr-dBox);
 let border=1.-smoothstep(.45,.49,max(abs(wx/width),abs(wz/length)));
 let zoomActive=1.-smoothstep(2.90,3.30,fr);
 let wPatch=smoothstep(.085,.22,distToEdge)*border*zoomActive;
 let inCollar=1.-smoothstep(.12,.22,distToEdge);
 let collarLift=smoothstep(.002,.025,distToEdge)*.0018*zoomActive-(1.-smoothstep(0.,.003,distToEdge))*.003;
 let isSimOnly=viewMode>.5&&viewMode<1.5;
 // The detail patch refines the same macro triangles; patch placement must not
 // blend the terrain into a different surface or change its material thickness.
 let bed=bedTri;
 let rawSoil=max(0.,soilTri);
 let slopeStrip=smoothstep(.58,1.35,rawSlope)*(1.-smoothstep(.052,.26,rawSoil));
 let effSoil=rawSoil*(1.-.85*slopeStrip);
 var px=wx;var pz=wz;
 var py=bed+rawSoil+collarLift;
 var cobbleOut=0.;
 var dispOut=0.;
 if(useFormed>.5&&meso>0.&&wPatch>0.&&!isSimOnly){
  // Conservative continuous spacing bound across allocation-level changes.
  let dsLocal=filterSpacing;
  let dCam=vec3<f32>(wx-camX,bed+rawSoil-camY,wz-camZ);
  let distToCam=sqrt(dot(dCam,dCam));
  let ds=max(dsLocal,.0042*distToCam);
  let dsEff=ds*slopeScale;
  let eLedge=ledge;
  let eCrag=select(crag,0.,viewMode>1.5&&viewMode<2.5);
  let eCob=select(cobble,0.,viewMode>1.5&&viewMode<2.5);
  let eRill=select(rill,0.,viewMode>1.5&&viewMode<2.5);
  let sStyle=clamp(stepStyle,0.,1.);
  // Horizontal wavelength of vertical strata on slope is thickness / max(0.35, rawSlope):
  // strictly gate every harmonic to >= 5.5 vertex spacings so zero Nyquist teeth can ever form.
  let lamBed=thickness/max(.35,rawSlope);
  let gBed0=smoothstep(ds*5.0,ds*9.0,lamBed);
  let gBed1=smoothstep(ds*5.0,ds*9.0,lamBed*.5);
  let gBed2=smoothstep(ds*5.0,ds*9.0,lamBed*.25);
  let gCrag0=smoothstep(dsEff*4.8,dsEff*8.5,.85);
  let gCrag1=smoothstep(dsEff*4.8,dsEff*8.5,.34);
  let gCrag2=smoothstep(dsEff*4.8,dsEff*8.5,.14);
  let gCrag3=smoothstep(dsEff*4.8,dsEff*8.5,.06);
  let soilScale=mix(.014,.050,smoothstep(.25,.85,rawSlope));
  let exposed=exp(-effSoil/soilScale);
  let cliffMask=smoothstep(.18,.65,rawSlope)*max(exposed,.78*smoothstep(.42,.98,rawSlope));
  let rad=strike*.017453292519943295;let ca=cos(rad);let sa=sin(rad);let rx=wx*ca+wz*sa;let rz=-wx*sa+wz*ca;
  let dipScale=1.-.88*sStyle;
  let warp=.36*hill_fbm3(vec3<f32>(rx*.55,bed*.45,rz*.55+seed*.13));
  let nWarp=hill_fbm3(vec3<f32>(rx*1.8,bed*1.6,rz*1.8+seed*.3));
  let lensMask=clamp(.45+.95*hill_fbm3(vec3<f32>(rx*.78-seed*.09,bed*.42,rz*.78+seed*.15)),.08,1.);
  let bedWeight=clamp(.22+.78*sStyle,.22,1.)*lensMask;
  let phase=(bed-dipScale*tilt*rx-dipScale*fold*warp+seed*.017)/thickness+.14*nWarp*(1.-.45*sStyle);
  let a=phase*6.28318530718;
  // Smooth C-infinity band-limited zero-mean discontinuous sandstone shelves & recessed undercuts
  let sLedge0=(gBed0*.68*sin(a)+.24*gBed0*sin(a*.618034+.9)-gBed1*.18*cos(2.*a))*bedWeight;
  let sLedge1=(gBed1*.26*sin(2.*a+.4*nWarp)-gBed2*.10*cos(4.*a))*bedWeight;
  let ledgeStep=eLedge*thickness*(.076*sLedge0+.028*sLedge1);
  // Smooth band-limited zero-mean 3D rock buttresses & vertical ribs
  let rib0=gCrag0*hill_fbm3(vec3<f32>(rx*1.2,bed*.75,rz*1.2+seed*.19));
  let rib1=gCrag1*hill_fbm3(vec3<f32>(rx*2.9,bed*1.7,rz*2.9+seed*.37));
  let rib2=gCrag2*hill_fbm3(vec3<f32>(rx*7.0,bed*4.0,rz*7.0+seed*.61));
  let rib3=gCrag3*hill_fbm3(vec3<f32>(rx*16.,bed*9.5,rz*16.+seed*.83));
  let buttress=eCrag*(.036*rib0+.017*rib1+.0078*rib2+.0034*rib3)*min(1.75,slopeScale);
  let rawRockVert=ledgeStep+buttress;
  let rockVert=mix(rawRockVert,max(0.,rawRockVert),inCollar);
  let ledgeUp=meso*wPatch*cliffMask*rockVert;
  // Resolve bed and joint depth on the heightfield. Mapping a normal-space
  // depth into height gives steep faces useful relief without folding the
  // horizontal parameterization. World coordinates anchor neighboring faces.
  let sourceNormal=normalize(hill_sample_field(wx,wz,n,width,length,macroNormals).xyz);
  let smoothSlope=sqrt(sourceNormal.x*sourceNormal.x+sourceNormal.z*sourceNormal.z)/max(.05,sourceNormal.y);
  let reliefBedGate=smoothstep(ds*5.,ds*9.,thickness/max(.35,smoothSlope));
  let jointGate=smoothstep(ds*5.,ds*9.,.34);
  let jointA=rx*2.6+rz*.57+.65*nWarp+seed*.13;
  let jointB=rz*3.1-rx*.71+.48*nWarp+seed*.29;
  let jointWidth=.10;
  let cleftA=1.-smoothstep(jointWidth,jointWidth+.20,abs(sin(jointA*3.14159265)));
  let cleftB=1.-smoothstep(jointWidth,jointWidth+.18,abs(sin(jointB*3.14159265)));
  let cleft=jointGate*max(cleftA,.65*cleftB);
  let hardBed=smoothstep(-.25,.45,sin(a)+.24*sin(a*.618034+.9));
  let shelfDepth=eLedge*thickness*.32*reliefBedGate*bedWeight*(hardBed-.42);
  let fractureDepth=eCrag*(.018*jointGate*hill_fbm3(vec3<f32>(rx*1.2,bed*.75,rz*1.2+seed*.19))-.025*cleft);
  let soilSeal=1.-smoothstep(.025,.085,rawSoil);
  let reliefMask=meso*wPatch*(1.-inCollar)*smoothstep(.35,1.5,smoothSlope)*exp(-rawSoil/.022)*soilSeal;
  // Soil closes the relief continuously. Shallow ledges retain the existing
  // single-valued surface; caves and deep undercuts need another representation.
  let reliefScale=.035;
  let relief=reliefScale*tanh(reliefMask*(shelfDepth+fractureDepth)/reliefScale);
  let faceRelief=relief/max(.25,sourceNormal.y);
  // Smooth C1 paraboloid-domed 3D Voronoi talus boulders & cobbles (zero conical tips)
  let gCob0=smoothstep(ds*5.2,ds*8.8,.28);
  let gCob1=smoothstep(ds*5.2,ds*8.8,.10);
  let gCob2=smoothstep(ds*5.2,ds*8.8,.042);
  let benchTread=clamp(.5+.55*sLedge0,0.,1.)*smoothstep(.20,2.4,rawSlope)*(1.-smoothstep(2.0,3.6,rawSlope));
  let screeZone=clamp(smoothstep(.001,.022,rawSoil)*(1.-smoothstep(.025,.085,rawSoil))*smoothstep(.05,1.45,rawSlope)*(1.-smoothstep(1.2,2.4,rawSlope))+.55*benchTread*exposed,0.,1.);
  let c0=hill_vor2(vec2<f32>(wx*3.5+.08*nWarp,wz*3.5-.08*nWarp),seed+5.3);
  let c1=hill_vor2(vec2<f32>(wx*9.8+.04*rib1,wz*9.8-.04*rib1),seed+23.9);
  let c2=hill_vor2(vec2<f32>(wx*24.+.02*rib2,wz*24.-.02*rib2),seed+61.7);
  let r0Sq=c0.x*c0.x;let r1Sq=c1.x*c1.x;let r2Sq=c2.x*c2.x;
  let dome0=clamp(1.-r0Sq*1.35,0.,1.);
  let dome1=clamp(1.-r1Sq*1.45,0.,1.);
  let dome2=clamp(1.-r2Sq*1.55,0.,1.);
  let stone0=dome0*dome0*smoothstep(.04,.24,c0.y)*clamp(c0.z+.35,0.,1.);
  let stone1=dome1*dome1*smoothstep(.04,.22,c1.y)*clamp(c1.z+.35,0.,1.);
  let stone2=dome2*dome2*smoothstep(.04,.20,c2.y)*clamp(c2.z+.35,0.,1.);
  let cobbleH=meso*eCob*wPatch*screeZone*(gCob0*.034*stone0+gCob1*.014*stone1+gCob2*.006*stone2);
  cobbleOut=cobbleH;
  let rawBench=eCrag*(.018*rib0+.007*rib1+.0028*rib2+.001*rib3);
  let benchOutcrop=meso*wPatch*exposed*(1.-cliffMask)*smoothstep(.22,.95,bed)*mix(rawBench,max(0.,rawBench),inCollar);
  // Outcrop & gully rill carving: branched erosional gullies on hillslopes/aprons + emergent tor outcrops
  let gullyWave=gCrag1*hill_fbm3(vec3<f32>(wx*4.2+.25*nWarp,bed*.8,wz*4.2-.25*nWarp))+.45*gCrag2*hill_fbm3(vec3<f32>(wx*11.,bed*1.8,wz*11.));
  let washChannel=meso*eRill*wPatch*(1.-screeZone)*(1.-inCollar)*(.018*smoothstep(.08,.65,rawSlope)*gullyWave+.005*(1.-exposed)*gullyWave);
  let totalDisp=ledgeUp+faceRelief+cobbleH+benchOutcrop+washChannel;
  dispOut=abs(totalDisp)+cobbleH*1.2;
  py=py+totalDisp;
 }
 (*metaBuf)[v]=vec4<f32>(py-rawSoil,max(0.,rawSoil-cobbleOut*2.2),dispOut,rawSlope);
 return vec4<f32>(px,py,pz,1.);
}`,[zoomCellKernel,geoFbm3,geoLedgeProfile,geoRockCrag,geoVoronoi2,sampleTriangleField]);

const zoomNormKernel=wgslFn(`fn hill_zoom_norm(v:u32,zn:u32,tilt:f32,strike:f32,fold:f32,thickness:f32,seed:f32,stepStyle:f32,meso:f32,useFormed:f32,posBuf:ptr<storage,array<vec4<f32>>,read_write>,metaBuf:ptr<storage,array<vec4<f32>>,read_write>)->vec4<f32>{
 let xi=v%zn;let zi=v/zn;
 let l=(*posBuf)[v-select(0u,1u,xi>0u)].xyz;let r=(*posBuf)[v+select(0u,1u,xi+1u<zn)].xyz;
 let u=(*posBuf)[v-select(0u,zn,zi>0u)].xyz;let d=(*posBuf)[v+select(0u,zn,zi+1u<zn)].xyz;
 let cVec=cross(d-u,r-l);
 let cLen=length(cVec);
 let nVec=select(vec3<f32>(0.,1.,0.),cVec/cLen,cLen>1e-6);
 return vec4<f32>(nVec,0.);
}`);

const fragSafeNormal=wgslFn(`fn hill_safe_normal(nv:vec3<f32>,vd:vec3<f32>)->vec3<f32>{
 let nLen=length(nv);
 let n=select(vec3<f32>(0.,0.,1.),nv/nLen,nLen>1e-5);
 let vLen=length(vd);
 let v=select(vec3<f32>(0.,0.,1.),vd/vLen,vLen>1e-5);
 let d=dot(n,v);
 if(d<.24){return normalize(n+(.24-d)*v);}
 return n;
}`);

export function createTerrainGPU(geometry,input={}){
 let config=terrainConfig(input),ridges=makeRidges(config),mesoState=mesoAuthoringConfig({}),activeViewMode='authored',lastLiveUpdateMs=0;
 const n=config.resolution,count=n*n,attributes=[],nodes=[];
 const maskPixels=new Uint8Array(3*3*4).fill(255);maskPixels.fill(0,4*4,5*4);
 const baseAlphaMap=new DataTexture(maskPixels,3,3);baseAlphaMap.name='hill-coarse-coverage';
 baseAlphaMap.magFilter=NearestFilter;baseAlphaMap.minFilter=NearestFilter;baseAlphaMap.generateMipmaps=false;baseAlphaMap.matrixAutoUpdate=false;baseAlphaMap.needsUpdate=true;
 const uv=new Float32Array(count*2);for(let v=0;v<count;v++){uv[v*2]=(v%n)/(n-1);uv[v*2+1]=Math.floor(v/n)/(n-1);}
 geometry.setAttribute('uv',new BufferAttribute(uv,2));

 const attribute=(array,size,label)=>{const a=new StorageBufferAttribute(array,size);a.name='hill-'+label;attributes.push(a);return a;};
 const stateAttributes=[0,1].map(i=>attribute(new Float32Array(count*4),4,'state-'+i)),states=stateAttributes.map(a=>storage(a,'vec4',count));
 const flowAttribute=attribute(new Float32Array(count*4),4,'transport'),flows=storage(flowAttribute,'vec4',count);
 const bankAttribute=attribute(new Float32Array(count*4),4,'bank-collapse'),banks=storage(bankAttribute,'vec4',count);
 const ridgeAttribute=attribute(Float32Array.from(ridges.flatMap(e=>[...e.a,...e.b])),4,'initial-ridges'),ridgeNode=storage(ridgeAttribute,'vec4',ridges.length*2);
 const positions=attribute(new Float32Array(count*4),4,'positions'),normals=attribute(new Float32Array(count*4),4,'normals'),colors=attribute(new Float32Array(count*4),4,'colors');
 geometry.setAttribute('position',positions);geometry.setAttribute('normal',normals);geometry.setAttribute('color',colors);geometry.setAttribute('hillMacroNormal',normals);
 const displayAttribute=attribute(new Float32Array(count*4),4,'display-state'),displayState=storage(displayAttribute,'vec4',count),alpha=uniform(1);
 geometry.setAttribute('hillSurface',displayAttribute);
 const interpolators=states.map((state,i)=>Fn(()=>{displayState.element(instanceIndex).assign(mix(states[1-i].element(instanceIndex),state.element(instanceIndex),alpha));})().compute(count));
 const positionNode=storage(positions,'vec4',count),normalNode=storage(normals,'vec4',count),colorNode=storage(colors,'vec4',count);
 const formedAttribute=attribute(new Float32Array(count*4),4,'formed-source'),formedNode=storage(formedAttribute,'vec4',count),useFormed=uniform(0);
 const geoTilt=uniform(.14),geoStrike=uniform(16),geoFold=uniform(.14),geoThickness=uniform(.34),geoHardness=uniform(9.2),geoWeathering=uniform(.00065),geoIncision=uniform(.068),geoSeed=uniform(47),geoStepStyle=uniform(.85),geoMeso=uniform(mesoState.meso);
 const mesoLedge=uniform(mesoState.ledge),mesoCrag=uniform(mesoState.crag),mesoCobble=uniform(mesoState.cobble),mesoRill=uniform(mesoState.rill),viewModeUniform=uniform(0);
 const dt=uniform(.05),drive=uniform(config.uplift),talus=uniform(Math.tan(config.repose*Math.PI/180)),fraction=uniform(0),soil=uniform(config.soil);

 // Camera-centered detail patch (193x193 = 73,728 world-aligned triangles)
 const zoomN=193,zoomCount=zoomN*zoomN,zoomIndices=new Uint32Array((zoomN-1)**2*6);
 let zk=0;for(let z=0;z<zoomN-1;z++)for(let x=0;x<zoomN-1;x++){const a=z*zoomN+x;zoomIndices[zk++]=a;zoomIndices[zk++]=a+zoomN;zoomIndices[zk++]=a+1;zoomIndices[zk++]=a+1;zoomIndices[zk++]=a+zoomN;zoomIndices[zk++]=a+zoomN+1;}
 const zoomGeometry=new BufferGeometry();zoomGeometry.setIndex(new BufferAttribute(zoomIndices,1));
 zoomGeometry.boundingBox=new Box3(new Vector3(-config.width/2,-2,-config.length/2),new Vector3(config.width/2,8,config.length/2));
 zoomGeometry.boundingSphere=zoomGeometry.boundingBox.getBoundingSphere(new Sphere());
 const zoomPositions=attribute(new Float32Array(zoomCount*4),4,'zoom-positions'),zoomNormals=attribute(new Float32Array(zoomCount*4),4,'zoom-normals'),zoomColors=attribute(new Float32Array(zoomCount*4),4,'zoom-colors'),zoomMetaAttr=attribute(new Float32Array(zoomCount*4),4,'zoom-meta');
 const zoomMacroNormals=attribute(new Float32Array(zoomCount*4),4,'zoom-macro-normals'),zoomSurfaceFields=attribute(new Float32Array(zoomCount*4),4,'zoom-surface-fields');
 const zoomMacroNode=storage(zoomMacroNormals,'vec4',zoomCount),zoomSurfaceNode=storage(zoomSurfaceFields,'vec4',zoomCount);
 zoomGeometry.setAttribute('hillMacroNormal',zoomMacroNormals);zoomGeometry.setAttribute('hillSurface',zoomSurfaceFields);
 zoomGeometry.setAttribute('position',zoomPositions);zoomGeometry.setAttribute('normal',zoomNormals);zoomGeometry.setAttribute('color',zoomColors);
 const zoomPosNode=storage(zoomPositions,'vec4',zoomCount),zoomNormNode=storage(zoomNormals,'vec4',zoomCount),zoomColNode=storage(zoomColors,'vec4',zoomCount),zoomMetaNode=storage(zoomMetaAttr,'vec4',zoomCount);
 const initialGrid=detailLattice(config,{x:0,z:0,radius:3.2},zoomN);
 let latticeRefines=initialGrid.refining;
 const gridX=uniform(initialGrid.center[0]),gridZ=uniform(initialGrid.center[1]),stepX=uniform(initialGrid.spacing[0]),stepZ=uniform(initialGrid.spacing[1]),filterSpacing=uniform(initialGrid.filterSpacing);
 const focusX=uniform(0),focusZ=uniform(0),focusRadius=uniform(3.2),zoomEnabled=uniform(1),camX=uniform(10.2),camY=uniform(8.2),camZ=uniform(12.8);

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
  positionNode.element(v).assign(basePosKernel({v,n:uint(n),x,y:s.x.add(s.y),z,fx:focusX,fz:focusZ,fr:focusRadius,useFormed,zoomOn:zoomEnabled,state}));
  const norm=normal({v,n:uint(n),dx:float(config.width/(n-1)),dz:float(config.length/(n-1)),x,z,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,ledge:mesoLedge,crag:mesoCrag,rill:mesoRill,viewMode:viewModeUniform,useFormed,state});
  normalNode.element(v).assign(norm);
  const cover=s.y.mul(4).clamp(0,1),steep=float(1).sub(norm.y).mul(1.3).clamp(0,1),exposed=steep.mul(float(1).sub(cover.mul(.4)));
  const legacyColor=initPosition(float(.30).add(exposed.mul(.12)).add(cover.mul(.05)),float(.36).sub(exposed.mul(.04)).add(cover.mul(.10)),float(.20).add(exposed.mul(.08)));
  colorNode.element(v).assign(mix(legacyColor,formedColor({x,z,bed:s.x,soil:s.y,disp:float(0),nx:norm.x,ny:norm.y,nz:norm.z,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,ledge:mesoLedge,crag:mesoCrag,cobble:mesoCobble,rill:mesoRill,viewMode:viewModeUniform}),useFormed));
 })().compute(count));
 const zoomPosPublisher=Fn(()=>{
  const v=instanceIndex;
  zoomPosNode.element(v).assign(zoomSurfaceKernel({v,zn:uint(zoomN),n:uint(n),width:float(config.width),length:float(config.length),fx:focusX,fz:focusZ,fr:focusRadius,filterSpacing,gridX,gridZ,stepX,stepZ,camX,camY,camZ,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,ledge:mesoLedge,crag:mesoCrag,cobble:mesoCobble,rill:mesoRill,viewMode:viewModeUniform,useFormed,state:displayState,macroNormals:normalNode,metaBuf:zoomMetaNode}));
 })().compute(zoomCount);
 const zoomNormPublisher=Fn(()=>{
  const v=instanceIndex,norm=zoomNormKernel({v,zn:uint(zoomN),tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,useFormed,posBuf:zoomPosNode,metaBuf:zoomMetaNode}),p=zoomPosNode.element(v);
  zoomNormNode.element(v).assign(norm);
  const sample=field=>sampleTriangleField({x:p.x,z:p.z,n:uint(n),width:float(config.width),length:float(config.length),field});
  // Material coverage comes from the same coarse field on both meshes. Detail
  // relief and its slope must not turn soil into rock as the patch passes.
  zoomColNode.element(v).assign(sample(colorNode));
  zoomMacroNode.element(v).assign(sample(normalNode));
  zoomSurfaceNode.element(v).assign(sample(displayState));
  // Attribution is a diagnostic view: retain the actual detail displacement
  // rather than copying the coarse field's zero geometric contribution.
  If(viewModeUniform.greaterThan(2.5),()=>{
   const m=zoomMetaNode.element(v);
   zoomColNode.element(v).assign(formedColor({x:p.x,z:p.z,bed:m.x,soil:m.y,disp:m.z,nx:norm.x,ny:norm.y,nz:norm.z,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,ledge:mesoLedge,crag:mesoCrag,cobble:mesoCobble,rill:mesoRill,viewMode:viewModeUniform}));
  });
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
  const mask=baseMaskTransform(config,{x:focusX.value,z:focusZ.value,radius:focusRadius.value},useFormed.value>.5&&zoomEnabled.value>.5&&focusRadius.value<3.30&&latticeRefines);
  baseAlphaMap.matrix.set(mask[0],0,mask[1],0,mask[2],mask[3],0,0,1);
  const runMain=pendingPresentation,runZoom=(pendingPresentation||pendingZoom)&&useFormed.value>.5&&zoomEnabled.value>.5;
  const t0=(runMain||runZoom)?performance.now():0;
  if(runMain){renderer.compute([interpolators[index],publishers[index]]);pendingPresentation=false;}
  if(runZoom){renderer.compute([zoomPosPublisher,zoomNormPublisher]);pendingZoom=false;}
  if(t0>0)lastLiveUpdateMs=Number((performance.now()-t0).toFixed(3));
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
  alpha.value=1;pendingPresentation=true;pendingZoom=true;flush(renderer);return read();
 }
 function setMesoAuthoring(patch={}){
  mesoState=mesoAuthoringConfig({...mesoState,...patch});
  geoMeso.value=mesoState.meso;
  mesoLedge.value=mesoState.ledge;
  mesoCrag.value=mesoState.crag;
  mesoCobble.value=mesoState.cobble;
  mesoRill.value=mesoState.rill;
  pendingPresentation=true;pendingZoom=true;
  if(renderer&&initialized)flush(renderer);
  return read();
 }
 function setViewMode(mode='authored'){
  const found=VIEW_MODES.find(m=>m.id===mode);
  if(!found)throw Error(`Unknown surface view mode: ${mode}`);
  activeViewMode=found.id;
  viewModeUniform.value=found.index;
  pendingPresentation=true;pendingZoom=true;
  if(renderer&&initialized)flush(renderer);
  return read();
 }
 function setCameraFocus({target=[0,1.2,0],position=null,distance=null,enabled=true}={}){
  const en=enabled?1:0;
  const tx=Number.isFinite(target?.[0])?target[0]:0,ty=Number.isFinite(target?.[1])?target[1]:1.2,tz=Number.isFinite(target?.[2])?target[2]:0;
  const hasPos=Array.isArray(position)&&position.length>=3&&Number.isFinite(position[0])&&Number.isFinite(position[1])&&Number.isFinite(position[2]);
  const dist=Number.isFinite(distance)&&distance>0?distance:(hasPos?Math.hypot(position[0]-tx,position[1]-ty,position[2]-tz):10);
  const px=hasPos?position[0]:tx,py=hasPos?position[1]:ty+dist,pz=hasPos?position[2]:tz;
  const minR=hasPos?.36:.24;
  const r=Math.max(minR,Math.min(3.4,dist*(hasPos?.56:.52)));
  const maxX=Math.max(.2,config.width*.5-.25),maxZ=Math.max(.2,config.length*.5-.25);
  const cx=Math.max(-maxX,Math.min(maxX,tx));
  const cz=Math.max(-maxZ,Math.min(maxZ,tz));
  if(zoomEnabled.value!==en||Math.abs(focusX.value-cx)>1e-4||Math.abs(focusZ.value-cz)>1e-4||Math.abs(focusRadius.value-r)>1e-4||Math.abs(camX.value-px)>1e-4||Math.abs(camY.value-py)>1e-4||Math.abs(camZ.value-pz)>1e-4){
   const grid=detailLattice(config,{x:cx,z:cz,radius:r},zoomN);
   latticeRefines=grid.refining;filterSpacing.value=grid.filterSpacing;gridX.value=grid.center[0];gridZ.value=grid.center[1];stepX.value=grid.spacing[0];stepZ.value=grid.spacing[1];
   zoomEnabled.value=en;focusX.value=cx;focusZ.value=cz;focusRadius.value=r;camX.value=px;camY.value=py;camZ.value=pz;pendingZoom=true;pendingPresentation=true;
  }
  return read();
 }
 function configure(patch){
  const next=terrainConfig({...config,...patch});for(const key of ['resolution','width','length'])if(next[key]!==config[key])throw Error('Grid changes require a new simulator instance');
  if(next.seed!==config.seed||next.layout!==config.layout||next.soil!==config.soil)throw Error('Initial conditions require regenerate');config=next;return read();
 }
 function regenerate(patch={}){const next=terrainConfig({...config,...patch});for(const key of ['resolution','width','length'])if(next[key]!==config[key])throw Error('Grid changes require a new simulator instance');config=next;formationProvenance=null;useFormed.value=0;ridges=makeRidges(config);ridgeAttribute.array.set(ridges.flatMap(e=>[...e.a,...e.b]));ridgeAttribute.needsUpdate=true;soil.value=config.soil;initialized=false;steps=0;preparationSteps=0;seconds=0;generation++;if(renderer)flush(renderer);return read();}
 function read(){
  const avgSpacing=(2*focusRadius.value)/(zoomN-1);
  return{route:ROUTE,backend:renderer?'webgpu':'unbound',initialized,config:{...config},generation,steps,preparationSteps,seconds,stateIndex:index,readbackInRuntime:false,error,viewMode:activeViewMode,mesoAuthoring:{...mesoState},liveUpdateMs:lastLiveUpdateMs,representation:{kind:'height-material-grid',samples:count,triangles:(n-1)**2*2,bytes:attributes.reduce((s,a)=>s+a.array.byteLength,0),fields:['substrate_height','loose_depth','vertical_velocity','actor_memory']},zoomDetail:{enabled:Boolean(zoomEnabled.value>.5&&focusRadius.value<3.30&&latticeRefines),inactiveReason:zoomEnabled.value<.5?'disabled':focusRadius.value>=3.30?'outside-detail-range':!latticeRefines?'source-already-finer-than-patch':null,resolution:zoomN,samples:zoomCount,triangles:(zoomN-1)**2*2,focusX:focusX.value,focusZ:focusZ.value,focusRadius:focusRadius.value,vertexSpacing:Math.max(stepX.value,stepZ.value),meanVertexSpacing:avgSpacing,lattice:{center:[gridX.value,gridZ.value],spacing:[stepX.value,stepZ.value],kind:'world-aligned-dyadic',filterSpacing:filterSpacing.value},cameraEye:[camX.value,camY.value,camZ.value]},capabilities:{initialConditions:true,prepare:true,advance:true,gpuGeology:true,arbitraryZoom3D:true,liveMesoAuthoring:true,provenanceInspector:true,gpuSurface:true,actorHistoryIngress:false,fluidCoupling:false,cpuSurfaceQueries:false},provenance:formationProvenance??{seed:config.seed,layout:config.layout},clock:{dt:.05,displayAlpha:alpha.value,authority:'submitted_gpu_steps'},surfaceSelection:'scene-object-row; exact surface picking unavailable'};
 }
 const applyFragShader=material=>{
  material.vertexColors=false;
  material.roughness=.96;
  material.specularIntensity=.16;
  const macro=tslAttribute('hillMacroNormal','vec4'),surface=tslAttribute('hillSurface','vec4');
  material.normalNode=fragSafeNormal({nv:normalView,vd:positionViewDirection});
  material.colorNode=fragFormedColor({vColor:tslAttribute('color','vec4'),x:positionLocal.x,y:surface.x.add(surface.y),z:positionLocal.z,nx:macro.x,ny:macro.y,nz:macro.z,tilt:geoTilt,strike:geoStrike,fold:geoFold,thickness:geoThickness,seed:geoSeed,stepStyle:geoStepStyle,meso:geoMeso,ledge:mesoLedge,crag:mesoCrag,cobble:mesoCobble,rill:mesoRill,viewMode:viewModeUniform,useFormed});
  return material;
 };
 const decorateBaseMaterial=material=>{
  applyFragShader(material);
  material.alphaTest=.5;
  material.alphaMap=baseAlphaMap;
  return material;
 };
 return{bind,flush,advance,stepGeology,setMesoAuthoring,setViewMode,setCameraFocus,configure,regenerate,read,zoomGeometry,
  decorateMaterial:decorateBaseMaterial,
  decorateZoomMaterial:applyFragShader,
  loadFormation(result){
   if(result.config.resolution!==n||result.config.width!==config.width||result.config.length!==config.length)throw Error('Formation grid does not match GPU terrain');
   if(!(result.state instanceof Float32Array)||result.state.length!==count*4||!result.state.every(Number.isFinite))throw Error('Complete finite formed state required');
   geoTilt.value=result.config.tilt;geoStrike.value=result.config.strike??0;geoFold.value=result.config.fold;geoThickness.value=result.config.bedThickness;geoHardness.value=result.config.hardness??9.2;geoWeathering.value=result.config.weathering??.00065;geoIncision.value=result.config.incision??.068;geoSeed.value=result.config.seed;geoStepStyle.value=Math.min(1,Math.max(0,.65*(result.config.mesa??0)+.65*(result.config.terrace??0)));
   if(Number.isFinite(result.config.meso)){mesoState={...mesoState,meso:result.config.meso};geoMeso.value=mesoState.meso;}
   formationProvenance={kind:'formed-landscape',version:result.version,recipe:{...result.config},preparationSteps:result.steps};
   formedAttribute.array.set(result.state);formedAttribute.needsUpdate=true;useFormed.value=1;initialized=false;steps=0;preparationSteps=0;seconds=0;generation++;alpha.value=1;pendingZoom=true;if(renderer)flush(renderer);return read();
  },
  present(value){if(!Number.isFinite(value)||value<0||value>1)throw Error("Terrain interpolation must be in [0,1]");if(alpha.value!==value){alpha.value=value;pendingPresentation=true;pendingZoom=true;}},
  surface:()=>{if(!renderer)throw Error('Hill GPU not mounted');flush(renderer);return{device:renderer.backend.device,state:renderer.backend.get(displayAttribute).buffer,currentState:renderer.backend.get(stateAttributes[index]).buffer,previousState:renderer.backend.get(stateAttributes[1-index]).buffer,alpha:alpha.value,positions:renderer.backend.get(positions).buffer,normals:renderer.backend.get(normals).buffer,zoomPositions:renderer.backend.get(zoomPositions).buffer,zoomNormals:renderer.backend.get(zoomNormals).buffer,colors:renderer.backend.get(colors).buffer,zoomColors:renderer.backend.get(zoomColors).buffer,resolution:n,width:config.width,length:config.length,generation,steps};},
  async snapshot({presentation=false}={}){if(!renderer||disposed)throw Error('Hill GPU not mounted');flush(renderer);const identity=read(),values=new Float32Array(await renderer.getArrayBufferAsync(stateAttributes[index]));if(values.length!==count*4||!values.every(Number.isFinite))throw Error('Invalid Hill GPU snapshot');const result={identity,values};if(presentation){result.display=new Float32Array(await renderer.getArrayBufferAsync(displayAttribute));result.positions=new Float32Array(await renderer.getArrayBufferAsync(positions));}return result;},
  dispose(){if(disposed)return;disposed=true;baseAlphaMap.dispose();for(const node of nodes)node.dispose();zoomGeometry.dispose();if(renderer){renderer.backend.device.removeEventListener('uncapturederror',gpuError);for(const a of attributes)if(![positions,normals,colors,zoomPositions,zoomNormals,zoomColors,zoomMacroNormals,zoomSurfaceFields].includes(a))renderer._attributes.delete(a);}}
 };
}
const initPosition=wgslFn('fn hill_vec4(x:f32,y:f32,z:f32)->vec4<f32>{return vec4<f32>(x,y,z,1.);}');
