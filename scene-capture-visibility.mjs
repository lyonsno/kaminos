// Native editors can display a retained physical surface through DOM while it
// remains a real lighting participant. Borrow that surface only within capture
// or cooperative compilation; callers restore before yielding to ordinary draw.
export function borrowSceneCaptureVisibility(scene){
 const restores=[];
 const restore=()=>{for(const undo of restores.splice(0).reverse())undo?.();};
 try{scene.traverse(node=>{
   const borrow=node.userData?.kaminosCaptureVisibility;if(typeof borrow!=='function')return;
   let visible=true;for(let parent=node;parent;parent=parent.parent)if(!parent.visible){visible=false;break;}
   if(visible||node.userData.kaminosCaptureHiddenPreparation===true)restores.push(borrow());
 });}
 catch(error){restore();throw error;}
 return restore;
}
