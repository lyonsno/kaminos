// Temporary beauty presentation. Source materials and saved object visibility are
// restored after every draw; shadow/physics consumers retain authored objects.
export function createSceneArrivalPresentation(){
 let weights=null;const clones=new Map();
 return {set(value){weights=value?new Map(value):null;},opacity:id=>weights?.get(id)??1,
  withFrame(rows,draw){
   if(!weights)return draw();const restore=[];const visited=new Set();
   try{for(const row of rows){const opacity=weights.get(row.id);if(opacity===undefined||opacity===1)continue;
    row.object.traverse(node=>{if(visited.has(node))return;visited.add(node);
     if(opacity===0){const before=node.visible;restore.push(()=>node.visible=before);node.visible=false;return;}
     if(!node.material)return;const before=node.material;
     const fade=material=>{let clone=clones.get(material);if(!clone){clone=material.clone();clone.transparent=true;clone.depthWrite=false;clones.set(material,clone);}clone.opacity=material.opacity*opacity;return clone;};
     node.material=Array.isArray(before)?before.map(fade):fade(before);restore.push(()=>node.material=before);
    });}
    return draw();
   }finally{for(const undo of restore.reverse())undo();}
  },dispose(){weights=null;for(const clone of clones.values())clone.dispose();clones.clear();}};
}
