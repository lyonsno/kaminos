// Native membership history retains roots. Temporary scene children also retain
// their real presentation parent; scene.remove only handles direct children.
export function createMountedWorkshopMembership() {
 const parents=new WeakMap();
 return {
  detach(entry){
   const root=entry.object;
   if(root.userData.kaminosMountedWorkshop&&root.parent)parents.set(root,root.parent);
   root.removeFromParent();
  },
  attach(entry,mount){
   const root=entry.object,parent=parents.get(root);
   if(root.userData.kaminosMountedWorkshop&&parent)parent.add(root);else mount(entry);
  },
 };
}
