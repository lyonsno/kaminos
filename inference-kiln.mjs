import {promptReliefMetadata} from './inference-kiln-record.mjs';
import {createPromptRelief} from './inference-kiln-relief.mjs';
import {Group,Mesh,PlaneGeometry,CanvasTexture,SRGBColorSpace,DoubleSide,MeshStandardMaterial,PointLight} from './lib/three.core.js';
import {MeshStandardNodeMaterial} from './lib/three.webgpu.js';
import {uniform,texture,uv,float,vec3,sin,smoothstep,mix} from './lib/three.tsl.js';

// A prompt ceremony: erosion is presentation, not a physical combustion claim.
// The original text survives every burn and is never edited by the animation.
export function createInferenceKiln({document,prompt='A weathered bronze lantern',duration=6,representation='billboard',appearance='crust',promptMesh=null,stage=true}){
  if(!['composed','crust','incineration'].includes(appearance))throw Error('Unknown kiln appearance');
  if(!['billboard','relief'].includes(representation))throw Error('Unknown prompt representation');
  if(typeof prompt!=='string'||!prompt.trim())throw Error('Enter a prompt to burn');
  if(!Number.isFinite(duration)||duration<=0)throw Error('Duration must be positive finite seconds');
  const root=new Group();root.name='Inference Kiln';
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  const map=new CanvasTexture(canvas);map.colorSpace=SRGBColorSpace;
  const burn=uniform(-.2);
  const p=uv(),grain=sin(p.x.mul(71).add(sin(p.y.mul(29)).mul(2))).mul(.042).add(sin(p.x.mul(23).add(p.y.mul(41))).mul(.06));
  const distance=p.y.add(grain).sub(burn);
  const remaining=smoothstep(float(-.006),float(.012),distance);
  const ember=float(1).sub(smoothstep(float(.005),float(.14),distance)).mul(remaining);
  const paper=new MeshStandardNodeMaterial({side:DoubleSide,transparent:true,depthWrite:false,roughness:.92});
  paper.colorNode=mix(vec3(.56,.51,.44),vec3(.1,.022,.004),ember);
  paper.opacityNode=texture(map,p).a.mul(remaining);
  paper.emissiveNode=vec3(1,.11,.008).mul(ember.mul(1.8));
  const text=promptMesh??new Mesh(new PlaneGeometry(2,.5),paper);if(!promptMesh){text.position.set(0,.15,.13);text.name='Prompt';root.add(text);}
  const solid=representation==='relief'?new MeshStandardMaterial({color:0xb8b2a8,roughness:.8,metalness:0}):null;
  if(solid){solid.userData.kaminosBurnAppearance=appearance;if(!promptMesh)text.material=solid;text.castShadow=true;text.receiveShadow=true;}
  let textOwned=!promptMesh;
  const floorMaterial=new MeshStandardMaterial({color:0x181a1e,roughness:.97,metalness:0});
  const floor=new Mesh(new PlaneGeometry(200,200),floorMaterial);floor.rotation.x=-Math.PI/2;floor.position.y=-1.8;floor.receiveShadow=true;if(stage)root.add(floor);
  const backdrop=new Mesh(new PlaneGeometry(200,200),floorMaterial);backdrop.position.z=-2.5;if(stage)root.add(backdrop);
  const light=new PointLight(0xff782c,0,4,2);light.position.set(0,-.3,.4);if(stage)root.add(light);
  let source='',elapsed=0,running=false,disposed=false;
  function setPrompt(value){
    if(typeof value!=='string'||!value.trim())throw Error('Enter a prompt to burn');
    source=value;if(solid)text.userData.kaminosPromptRelief=promptReliefMetadata(value,appearance);const words=value.trim().split(/\s+/);const lines=[];let line='';
    canvas.width=1024;ctx.font='500 76px Georgia';
    for(const word of words){const candidate=line?`${line} ${word}`:word;if(line&&ctx.measureText(candidate).width>880){lines.push(line);line=word;}else line=candidate;}if(line)lines.push(line);
    canvas.height=Math.max(180,lines.length*92+40);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.font='500 76px Georgia';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#fff';
    lines.forEach((line,index)=>ctx.fillText(line,512,25+index*92+40,900));
    map.needsUpdate=true;
    if(solid){const geometry=createPromptRelief(canvas);text.geometry.dispose();text.geometry=geometry;text.scale.y=1;}
    else text.scale.y=(canvas.height/1024*2)/.5;
    reset();return read();
  }
  function reset(){elapsed=0;running=false;burn.value=-.12;light.intensity=0;return read();}
  function ignite(){if(solid)throw Error('Relief ignition uses scene-owned combustion');elapsed=0;running=true;burn.value=-.12;return read();}
  function advance(seconds){
    if(disposed||!running)return read();
    if(!Number.isFinite(seconds)||seconds<0)throw Error('Invalid frame duration');
    elapsed+=seconds;
    const progress=Math.min(1,elapsed/duration);burn.value=-.12+1.25*progress;
    light.intensity=.15*(1-Math.max(0,(progress-.8)/.2))*(.65+.08*Math.sin(elapsed*19)+.05*Math.sin(elapsed*31));
    if(progress===1)running=false;
    return read();
  }
  function read(){if(solid)return {prompt:source,representation:'shallow-glyph-mesh',burnAuthority:'scene-owned-thermal',appearance};return {prompt:source,elapsed,duration,running,consumed:elapsed>=duration,progress:Math.min(1,elapsed/duration),representation:'transparent-text-billboard',burnAuthority:'presentation-clock'};}
  if(promptMesh){source=prompt;text.userData.kaminosPromptRelief=promptReliefMetadata(prompt,appearance);reset();}else setPrompt(prompt);
  return {root,text,detachText(){text.removeFromParent();textOwned=false;return text;},setPrompt,setAppearance(value){if(!solid||!['composed','crust','incineration'].includes(value))throw Error('Unknown kiln appearance');appearance=value;solid.userData.kaminosBurnAppearance=value;text.userData.kaminosPromptRelief=promptReliefMetadata(source,value);return read();},reset,ignite,advance,read,dispose(){if(disposed)return;disposed=true;running=false;map.dispose();if(textOwned)text.geometry.dispose();paper.dispose();if(solid&&(textOwned||text.material!==solid))solid.dispose();floor.geometry.dispose();backdrop.geometry.dispose();floorMaterial.dispose();root.removeFromParent();}};
}
