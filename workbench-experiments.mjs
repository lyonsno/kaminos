import {investigationOperations} from './investigation-recording.mjs';

function validateDefinition(definition, source='experiment') {
  if(!definition || typeof definition.id !== 'string' || !definition.id.trim()
    || typeof definition.title !== 'string' || !definition.title.trim()
    || typeof definition.create !== 'function') {
    throw Error(`${source}: experiment requires id, title and create`);
  }
}

// Importing trusted owner definitions discovers tools; creating an instance is
// a separate, explicit act. The server supplies URLs from the current checkout.
export async function loadExperimentContributions(urls, {loadModule=url=>import(url)}={}) {
  const definitions=[], seen=new Map();
  for(const url of urls) {
    let definition;
    try {definition=(await loadModule(url)).default;validateDefinition(definition,url);}
    catch(error) {throw Error(`Experiment ${url}: ${error.message}`,{cause:error});}
    if(seen.has(definition.id))throw Error(`Duplicate experiment ${definition.id}: ${seen.get(definition.id)} and ${url}`);
    seen.set(definition.id,url);
    definitions.push({...definition,moduleUrl:url});
  }
  return definitions;
}

export async function openExperiment(definition, {host,inputs={},record=operation=>investigationOperations.emit(operation)}={}) {
  validateDefinition(definition);
  const instance=await definition.create({host,inputs,record});
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
  let disposed=false, disposal;
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
