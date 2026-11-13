import {createQ4LoraProjection} from './q4-lora.mjs';
import {q4Arrays} from './q4-checks.mjs';

const finite=x=>typeof x==='number'&&Number.isFinite(x);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
function require(ok,message){if(!ok)throw new Error(message);}
function vector(a,n,name,unsigned=false){
  require(Array.isArray(a)&&a.length===n&&a.every(x=>finite(x)&&(!unsigned||(integer(x)&&x<=0xffffffff))), 'invalid '+name);
}
export function validateRun(r){
  require(r?.schema==='kaminos.q4-training.v1'&&r.backend==='webgpu','unsupported training route/schema');
  require(integer(r.updates)&&r.updates>0&&integer(r.seed)&&r.seed>0&&r.seed<=0xffffffff,'invalid updates/seed');
  require(Array.isArray(r.fixtures)&&r.fixtures.length>0,'training data required');
  const d=r.fixtures[0].dims;
  require(d&&['tokens','columns','rows','rank'].every(k=>integer(d[k])&&d[k]>0)&&d.columns%64===0&&d.groupSize===64&&finite(d.alpha),'invalid projection dimensions');
  for(const f of r.fixtures){
    require(stable(f.dims)===stable(d),'incompatible sample dimensions');
    const {tokens:T,columns:C,rows:R,rank:K}=d;
    vector(f.base?.packed,R*C/8,'packed base',true);vector(f.base?.scales,R*C/64,'scales');vector(f.base?.biases,R*C/64,'biases');
    vector(f.params?.input,T*C,'input');vector(f.params?.a,K*C,'adapter A');vector(f.params?.b,R*K,'adapter B');vector(f.target,T*R,'target');
    require(stable(f.base)===stable(r.fixtures[0].base),'samples must share frozen base');
    for(const k of ['a','b'])require(stable(f.params[k])===stable(r.fixtures[0].params[k]),'samples must share initial adapter');
  }
  const o=r.optimizer;
  require(o?.name==='adamw'&&finite(o.learningRate)&&o.learningRate>0&&finite(o.epsilon)&&o.epsilon>0&&finite(o.weightDecay)&&o.weightDecay>=0,'invalid AdamW configuration');
  require(['beta1','beta2'].every(k=>finite(o[k])&&o[k]>=0&&o[k]<1),'invalid AdamW decay');
  return r;
}
export async function makeTrainingRun({fixtures,updates,seed=17,optimizer={}}){
  return validateRun({schema:'kaminos.q4-training.v1',backend:'webgpu',fixtures,updates,seed,
    optimizer:{name:'adamw',learningRate:0.001,beta1:0.9,beta2:0.999,epsilon:1e-8,weightDecay:0.01,...optimizer}});
}
export function stable(x){
  if(x===null||typeof x!=='object')return JSON.stringify(x);
  if(Array.isArray(x))return '['+x.map(stable).join(',')+']';
  return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stable(x[k])).join(',')+'}';
}
export async function runIdentity(r){
  validateRun(r);
  const bytes=new TextEncoder().encode(stable(r));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
function shuffle(n,rng){
  const order=Array.from({length:n},(_,i)=>i);
  for(let i=n-1;i>0;i--){rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;rng>>>=0;const j=rng%(i+1);[order[i],order[j]]=[order[j],order[i]];}
  return {order,rng};
}
export async function validateCheckpoint(run,s){
  require(s?.schema==='kaminos.q4-training-state.v1'&&s.runIdentity===await runIdentity(run),'checkpoint identity mismatch');
  const d=run.fixtures[0].dims,n=run.fixtures.length;
  require(integer(s.update)&&s.update<=run.updates&&integer(s.epoch)&&integer(s.cursor)&&s.cursor<n&&s.update===s.epoch*n+s.cursor,'invalid training cursor');
  require(integer(s.rng)&&s.rng>0&&s.rng<=0xffffffff,'invalid RNG state');
  require(Array.isArray(s.order)&&s.order.length===n&&[...s.order].sort((a,b)=>a-b).every((v,i)=>v===i),'invalid sample order');
  for(const section of ['params','m','v'])for(const k of ['a','b']){
    vector(s[section]?.[k],k==='a'?d.rank*d.columns:d.rows*d.rank,section+'.'+k);
    if(section==='v')require(s.v[k].every(x=>x>=0),'negative Adam variance');
  }
  require(s.lastLoss===null||finite(s.lastLoss),'invalid last loss');
  return s;
}

// One actual differentiated projection per update. The small reference still
// decodes the base internally; this is not a model-scale memory implementation.
export async function createQ4Trainer(jax,run,backend,resume){
  validateRun(run);require(['cpu','webgpu'].includes(backend),'unsupported effective backend');
  if(resume)await validateCheckpoint(run,resume);
  const np=jax.numpy,f=run.fixtures[0],d=f.dims,identity=await runIdentity(run);
  const initial=resume??{schema:'kaminos.q4-training-state.v1',runIdentity:identity,update:0,epoch:0,cursor:0,
    ...shuffle(run.fixtures.length,run.seed),params:{a:f.params.a,b:f.params.b},
    m:{a:f.params.a.map(()=>0),b:f.params.b.map(()=>0)},v:{a:f.params.a.map(()=>0),b:f.params.b.map(()=>0)},lastLoss:null};
  let state=structuredClone(initial),disposed=false;
  const shapes={a:[d.rank,d.columns],b:[d.rows,d.rank]};
  const tensors=obj=>Object.fromEntries(Object.entries(obj).map(([k,v])=>[k,np.array(new Float32Array(v)).reshape(shapes[k])]));
  let params=tensors(state.params),m=tensors(state.m),v=tensors(state.v);
  const frozen=q4Arrays(jax,f);jax.tree.dispose(frozen.params);const base=frozen.base;
  const projection=createQ4LoraProjection(d);
  const loss=(p,base,target)=>np.square(projection(p,base).sub(target)).sum().mul(0.5/(d.tokens*d.rows));
  const gradient=jax.valueAndGrad(loss),o=run.optimizer;
  const update=jax.jit((p,m,v,input,base,target,c1,c2)=>{
    const [value,g]=gradient({input,a:p.a.ref,b:p.b.ref},base,target);
    g.input.dispose();const next={params:{},m:{},v:{},value};
    for(const k of ['a','b']){
      const mm=m[k].mul(o.beta1).add(g[k].ref.mul(1-o.beta1));
      const vv=v[k].mul(o.beta2).add(np.square(g[k]).mul(1-o.beta2));
      const delta=mm.ref.div(c1.ref).div(np.sqrt(vv.ref.div(c2.ref)).add(o.epsilon)).mul(o.learningRate);
      next.params[k]=p[k].mul(1-o.learningRate*o.weightDecay).sub(delta);next.m[k]=mm;next.v[k]=vv;
    }
    c1.dispose();c2.dispose();return next;
  });
  const check=()=>require(!disposed,'trainer disposed');
  const read=async a=>{require(a.device===backend,'effective backend mismatch');const out=Array.from(await a.data());require(out.every(finite),'nonfinite training values');return out;};
  return {
    get progress(){return {update:state.update,total:run.updates,cursor:state.cursor,epoch:state.epoch,lastLoss:state.lastLoss};},
    async step(){
      check();require(state.update<run.updates,'training already complete');
      const sample=run.fixtures[state.order[state.cursor]];
      const x=np.array(new Float32Array(sample.params.input)).reshape([d.tokens,d.columns]);
      const target=np.array(new Float32Array(sample.target)).reshape([d.tokens,d.rows]);
      const next=update(params,m,v,x,jax.tree.map(a=>a.ref,base),target,np.array(1-o.beta1**(state.update+1)),np.array(1-o.beta2**(state.update+1)));
      params=next.params;m=next.m;v=next.v;
      state.lastLoss=(await read(next.value))[0];state.update++;state.cursor++;
      if(state.cursor===run.fixtures.length){state.cursor=0;state.epoch++;Object.assign(state,shuffle(run.fixtures.length,state.rng));}
      return this.progress;
    },
    async snapshot(){
      check();const saved={...state,params:{},m:{},v:{}};
      for(const [name,tree]of Object.entries({params,m,v}))for(const k of ['a','b'])saved[name][k]=await read(tree[k].ref);
      await validateCheckpoint(run,saved);return structuredClone(saved);
    },
    async dispose(){if(disposed)return;disposed=true;jax.tree.dispose(params);jax.tree.dispose(m);jax.tree.dispose(v);jax.tree.dispose(base);update.dispose();}
  };
}
