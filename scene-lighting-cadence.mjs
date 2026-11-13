// One outstanding solve, and a single replaceable request. Existing scenes
// remain on synchronous frame ownership until this cockpit opts in.
export function createSceneLightingCadence(defaults) {
 let request=null,pending=false,lastStart=null;
 return {
  configure(patch){
   const next={enabled:true,intervalMs:250,...defaults,...request,...patch};
   if(typeof next.enabled!=='boolean')throw Error('Lighting enabled must be boolean');
   if(!Number.isFinite(next.intervalMs)||next.intervalMs<=0)throw Error('Lighting interval must be positive');
   if(request?.enabled===false&&next.enabled)lastStart=null;
   request=next;return {...request};
  },
  read(){return request&&{...request};},
  due(now){return !request||(request.enabled&&!pending&&(lastStart===null||now-lastStart>=request.intervalMs));},
  begin(now){if(!request?.enabled||pending)return null;lastStart=now;pending=true;return {...request};},
  complete(){pending=false;},
  clear(){request=null;lastStart=null;},
 };
}
