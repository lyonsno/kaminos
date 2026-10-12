export function validateLayoutFrame(frame) {
  if(frame.overflow||frame.tiles?.length!==4||frame.stage?.height<180)throw Error('Comparison missing or overflowing');
  const names=new Set(frame.tiles.map(tile=>tile.mode));
  if(['original','photo','relit','materials'].some(name=>!names.has(name)))throw Error('Missing comparison view');
  for(const tile of frame.tiles){
    if(tile.surface.width<=0||tile.surface.height<=0||tile.label.top<tile.surface.bottom-1||tile.label.bottom>tile.bottom+1||tile.surface.right>frame.width+1)throw Error('Clipped comparison pane or label');
  }
  if(frame.tuningHit!==true||frame.runHit!==true)throw Error('Toolbar control occluded');
}
