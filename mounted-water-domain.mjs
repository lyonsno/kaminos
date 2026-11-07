import {checkedMlsPresentationFrame} from './mls-presentation-frame.mjs';
import {waterDomainPose,checkedWaterDomainPose,waterDomainSampling} from './authored-water-domain.mjs';
import {resolveAuthoredWaterSampling} from './authored-water-drop.mjs';
import {normalizeLocalLiquidSetup} from './local-liquid-setup.mjs';
import {authoredMlsCellSize} from './authored-mls-water.mjs';
export function presentWaterPose(pose,value){const {translation,scale}=checkedMlsPresentationFrame(value);return {position:pose.position.map((v,i)=>v*scale+translation[i]),rotation:[...pose.rotation],scale:pose.scale.map(v=>v*scale)};}
export function authorWaterPose(pose,value){const {translation,scale}=checkedMlsPresentationFrame(value);return {position:pose.position.map((v,i)=>(v-translation[i])/scale),rotation:[...pose.rotation],scale:pose.scale.map(v=>v/scale)};}
export function presentWaterBounds(bounds,value){const {translation,scale}=checkedMlsPresentationFrame(value);return Object.fromEntries(['min','max'].map(k=>[k,bounds[k].map((v,i)=>v*scale+translation[i])]));}
// Distinct edit identities retain this water owner through Return and history.
export function createMountedWaterDomain({id,feature,sources,frame,changed=()=>{}}){
 const cell=()=>authoredMlsCellSize(sources(),feature.setup),sampling=()=>resolveAuthoredWaterSampling(sources(),feature.setup);
 const writeSettings=value=>{feature.setup={...normalizeLocalLiquidSetup(value),trackPopulation:false};feature.host?.setSetup(feature.setup);changed();};
 const local={read:()=>waterDomainPose(sampling()),check:value=>checkedWaterDomainPose(value,cell()),write:value=>writeSettings({...feature.setup,waterSampling:waterDomainSampling(sampling(),value,cell())})};
 const world={read:()=>({...presentWaterPose(local.read(),frame()),authoredPose:local.read()}),check:value=>{const authoredPose=local.check(authorWaterPose(value,frame()));return {...presentWaterPose(authoredPose,frame()),authoredPose};},write:value=>local.write(value.authoredPose??authorWaterPose(value,frame()))};
 const settings={read:()=>structuredClone(feature.setup),check:normalizeLocalLiquidSetup,write:writeSettings};
 return {localId:'@mounted-water-domain:'+id,worldId:'@mounted-water-domain-world:'+id,settingsId:'@mounted-water-settings:'+id,local,world,settings,frame,owns:value=>value===feature};
}
