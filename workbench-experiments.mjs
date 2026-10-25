import {investigationOperations} from './investigation-recording.mjs';

function validateDefinition(definition, source='experiment') {
  if(!definition || typeof definition.id !== 'string' || !definition.id.trim()
    || typeof definition.title !== 'string' || !definition.title.trim()
    || typeof definition.create !== 'function') {
    throw Error(`${source}: experiment requires id, title and create`);
  }
}

// The catalogue contains data only. Import the implementation at activation,
// preserving source identity before allowing its factory to touch the host.
export async function loadExperimentContributions(entries, {loadModule=url=>import(url)}={}) {
  if(!Array.isArray(entries))throw Error('Experiment catalogue requires an entries array');
  const definitions=entries.map(entry=>{
    const {id,title,moduleUrl,error}=entry??{};
    const problem=error || (typeof id!=='string'||!id.trim()||typeof title!=='string'||!title.trim()||typeof moduleUrl!=='string'||!moduleUrl.trim()
      ? 'Experiment metadata requires id, title and moduleUrl' : null);
    return {id,title,moduleUrl,...(problem?{error:`${moduleUrl??'experiment'}: ${problem}`}:{})};
  });
  const ids=new Map();
  for(const entry of definitions)if(typeof entry.id==='string'){
    if(!ids.has(entry.id))ids.set(entry.id,[]);ids.get(entry.id).push(entry);
  }
  for(const [id,group] of ids)if(group.length>1){
    const error=`Duplicate experiment ${id}: ${group.map(d=>d.moduleUrl).join(' and ')}`;
    for(const entry of group)entry.error=error;
  }
  return definitions.map(entry=>({...entry,async create(context){
    if(entry.error)throw Error(entry.error);
    let definition;
    try {
      definition=(await loadModule(entry.moduleUrl)).default;
      validateDefinition(definition,entry.moduleUrl);
      if(definition.id!==entry.id || definition.title!==entry.title)throw Error('catalogue identity differs from implementation; refresh metadata and reload');
    } catch(error){throw Error(`Experiment ${entry.moduleUrl}: ${error.message}`,{cause:error});}
    return definition.create(context);
  }}));
}

export async function openExperiment(definition, {host,inputs={},record=operation=>investigationOperations.emit(operation),onInputsChange=()=>{}}={}) {
  validateDefinition(definition);
  let disposed=false, disposal;
  const instance=await definition.create({host,inputs,record,updateInputs:value=>{if(disposed)throw Error(`Experiment ${definition.id} is disposed`);onInputsChange(value);}});
  try {
    if(typeof instance?.read !== 'function')throw Error(`${definition.id}: read required`);
    if(!instance.operations || typeof instance.operations !== 'object')throw Error(`${definition.id}: operations required`);
    for(const [name,operation] of Object.entries(instance.operations)) {
      if(typeof operation !== 'function')throw Error(`${definition.id}: operation ${name} must be a function`);
    }
    for(const name of ['mount','dispose']) {
      if(instance[name] !== undefined && typeof instance[name] !== 'function')throw Error(`${definition.id}: ${name} must be a function`);
    }
  } catch(error) {
    if(typeof instance?.dispose === 'function') {
      try {await instance.dispose();}
      catch(cleanup) {throw new AggregateError([error,cleanup],`${definition.id}: invalid instance and cleanup failed`);}
    }
    throw error;
  }
  const active=()=>{if(disposed)throw Error(`Experiment ${definition.id} is disposed`);};
  const api={
    id:definition.id,
    title:definition.title,
    operationNames:Object.freeze(Object.keys(instance.operations)),
    async read() {active();return instance.read();},
    async invoke(name,input) {
      active();
      if(!Object.hasOwn(instance.operations,name))throw Error(`Unknown operation ${definition.id}.${name}`);
      return instance.operations[name](input);
    },
    async mount(context) {
      active();
      return instance.mount ? instance.mount({...context,invoke:api.invoke,read:api.read}) : null;
    },
    dispose() {
      if(!disposed) {
        disposed=true;
        disposal=Promise.resolve().then(()=>instance.dispose?.());
      }
      return disposal;
    },
  };
  return Object.freeze(api);
}
