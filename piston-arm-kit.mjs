// An authored primitive carrier. Geometry and actuator semantics stay separate.
import {Vector3,Quaternion,Euler} from './lib/three.core.js';
import {prepareActuator} from './scene-actuator.mjs';
import {checkedProceduralMesh} from './scene-geometry.mjs';
import {flamePoseToDomain,immersedControlsForFlamePose} from './scene-flame-emitter.mjs';
const pose=(position=[0,0,0],rotation=[0,0,0])=>({position,rotation,scale:[1,1,1]});
export function pistonArmScene(template, options={}) {
 const {height=.665,reach=1.1,thickness=.10,cupRadius=.14,prefix='analytical-arm'}=options;
 for(const [key,value]of Object.entries({height,reach,thickness,cupRadius}))if(!Number.isFinite(value)||value<=0)throw Error(`${key} must be positive`);
 if(typeof prefix!=='string'||!prefix.trim())throw Error('prefix is required');
 const scene=structuredClone(template),source=scene.objects?.find(o=>o.type==='flame-emitter');
 if(!source)throw Error('A template with a flame emitter is required');
 const floor=-.6,hinge=[0,floor+height,-.48],base=[0,floor+height*.32,-.36],end=[0,hinge[1]-height*.165,hinge[2]+reach*.49];
 const cup=[0,hinge[1]+thickness*.85,hinge[2]+reach*.9],objects=[],parts={base:[],boom:[],barrel:[],rod:[]};
 const colors={base:'#8998a3',boom:'#d9d3bd',barrel:'#668698',rod:'#c9d5dc'};
 const add=(role,key,kind,parameters,transform,color=colors[role])=>{
  const id=`${prefix}-${key}`;parts[role].push(id);
  objects.push(checkedProceduralMesh({id,type:'procedural-mesh',source:'kaminos:geometry',label:key.replaceAll('-',' '),fileName:kind,
   groupId:`${prefix}-${role}`,geometry:{kind,parameters},transform,surface:{color,roughness:role==='rod'?.25:.5,metalness:role==='rod'?.65:.25}}));return id;
 };
 const cylinder=(role,key,start,finish,radius,color)=>{
  const a=new Vector3(...start),b=new Vector3(...finish),direction=b.clone().sub(a),height=direction.length();
  const e=new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0,1,0),direction.normalize()));
  return add(role,key,'cylinder',{radius,height},pose(a.add(b).multiplyScalar(.5).toArray(),[e.x,e.y,e.z]),color);
 };
 const pin=(role,key,center,radius=.065)=>cylinder(role,key,[center[0]-thickness*.95,center[1],center[2]],[center[0]+thickness*.95,center[1],center[2]],radius,'#bca477');
 add('base','foot','cylinder',{radius:thickness*2,height:.065},pose([0,floor+.0325,hinge[2]]));
 add('base','upright','box',{width:thickness,height:height-.06,depth:thickness*1.15},pose([0,floor+(height+.06)/2,hinge[2]]));
 pin('base','boom-hinge',hinge,thickness*.95);
 // Both cheeks and their crossbar belong to one rigid boom, with visible gaps.
 for(const side of [-1,1])add('boom',`boom-cheek-${side===1?'right':'left'}`,'box',{width:thickness*.28,height:thickness*.7,depth:reach},pose([side*thickness*.43,hinge[1],hinge[2]+reach/2]));
 add('boom','mount-bracket','box',{width:thickness*.8,height:thickness*1.35,depth:thickness*.6},pose([0,hinge[1]-thickness*.45,end[2]]));
 add('boom','burner-neck','cylinder',{radius:cupRadius*.3,height:thickness},pose([0,cup[1]-thickness*.5,cup[2]]));
 add('boom','burner-floor','cylinder',{radius:cupRadius,height:thickness*.22},pose(cup));
 for(let i=0;i<12;i++){
  const angle=i*Math.PI/6,radius=cupRadius*.94;
  add('boom',`burner-rim-${i}`,'box',{width:2*radius*Math.tan(Math.PI/12),height:thickness*.8,depth:thickness*.18},pose([Math.sin(angle)*radius,cup[1]+thickness*.4,cup[2]+Math.cos(angle)*radius],[0,angle,0]));
 }
 const axis=new Vector3(...end).sub(new Vector3(...base)),length=axis.length();axis.normalize();
 const along=(origin,distance)=>new Vector3(...origin).addScaledVector(axis,distance).toArray();
 cylinder('barrel','barrel-body',base,along(base,length*.76),thickness*.55);
 pin('barrel','base-eye',base,thickness*.65);
 cylinder('rod','sliding-shaft',along(end,-length*.67),end,thickness*.25);
 pin('rod','rod-eye',end,thickness*.48);
 source.transform={...pose([cup[0],cup[1]+thickness*.85,cup[2]]),scale:[...source.transform.scale]};
 const domain=scene.objects.find(o=>o.type==='simulation-domain');
 if(!domain)throw Error('A template with a flame domain is required');
 const scale=domain.transform.scale[0],translation=domain.transform.position.map((v,i)=>v-(i===1?scale:0));
 const mapped=immersedControlsForFlamePose({},flamePoseToDomain(source.transform,translation,scale),false);
 for(const [suffix,key]of [['centre-x','immersedCentreX'],['centre-y','immersedCentreY'],['centre-z','immersedCentreZ'],['yaw','immersedYaw'],['pitch','immersedPitch']]){
  // Observed Chromium range serialization in the retained source-diagnosis
  // witness uses 15 significant digits. Preserve full authored source TRS;
  // serialize only its duplicated UI backing at that effective route precision.
  const control=source.emission?.settings?.[`volume-immersed-${suffix}`];if(control){control.value=Number(mapped[key].toPrecision(15));delete control.rawValue;}
 }
 source.groupId=`${prefix}-boom`;parts.boom.push(source.id);
 const groups=Object.entries(parts).map(([role,objectIds])=>({id:`${prefix}-${role}`,type:'group',label:`Analytical ${role}`,objectIds,transform:pose(),source:null}));
 const roleIds=Object.fromEntries(Object.entries({fixedId:'base',followerId:'boom',barrelId:'barrel',rodId:'rod'}).map(([k,r])=>[k,`@group:${prefix}-${r}`]));
 const actuator=prepareActuator({id:`${prefix}-drive`,label:'Analytical lift piston',...roleIds,baseMount:base,movingMount:end,hinge,axis:[1,0,0],reference:Object.fromEntries(Object.values(roleIds).map(id=>[id,pose()])),drive:{min:length*.75,max:length*1.25,period:1.8,outward:.75}});
 scene.objects=[...objects,source,...scene.objects.filter(o=>['simulation-domain','camera','light'].includes(o.type))];
 scene.groups=groups;scene.actuators=[actuator];scene.version=11;scene.model=null;scene.transform=pose();scene.materials=null;scene.capture=null;
 scene.activeObjectId=null;scene.activeGroupId=`${prefix}-barrel`;scene.activeFieldId=null;scene.selectionIds=[roleIds.barrelId];
 scene.label='Analytical flame arm';
 scene.environment={...scene.environment,ground:{...scene.environment?.ground,height:floor}};
 scene.provenance={...scene.provenance,analyticalCarrier:{schema:'kaminos.piston-arm-carrier.v1',parameters:{height,reach,thickness,cupRadius,prefix},parts,roleIds}};
 return scene;
}
