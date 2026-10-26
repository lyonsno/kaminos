// Whole-settings preview writes already force the inspector current before their
// diagnostics. Coalesce only the surrounding nonforced notifications in that same
// synchronous operation; ordinary requests and every forced write remain immediate.
export function createFlameInspectorRefresh(sync) {
  let depth=0,pending=false,refreshed=false;
  return {
    request(force){
      if(!depth)return sync(force);
      if(force===true){pending=false;refreshed=true;return sync(true);}
      if(!refreshed)pending=true;
    },
    preview(operation){
      if(!depth){pending=false;refreshed=false;}
      depth++;
      try{return operation();}
      finally{
        depth--;
        if(!depth){const flush=pending;pending=false;refreshed=false;if(flush)sync(false);}
      }
    },
  };
}
