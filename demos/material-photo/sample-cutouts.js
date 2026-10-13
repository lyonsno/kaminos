// Authored display silhouettes in the original image coordinates. Model inputs
// and saved outputs are unchanged; these are not inferred segmentation results.
const silhouettes={
  orb:{width:1510,height:1514,path:'M 721 111 C 909 112 1117 213 1263 397 C 1361 517 1406 657 1402 810 C 1400 1002 1319 1192 1165 1308 C 1025 1416 833 1434 642 1396 C 441 1355 275 1236 186 1060 C 115 918 110 758 157 616 C 216 422 336 255 491 172 C 566 130 640 109 721 111 Z'},
  bag:{width:1024,height:1024,path:'M 449 182 C 442 151 438 119 447 97 C 465 71 489 47 514 47 C 542 45 569 74 587 101 L 590 183 C 662 190 731 206 758 241 C 789 278 802 389 809 508 L 814 613 C 831 662 829 833 816 902 L 793 951 C 748 985 640 978 525 978 L 347 978 C 276 979 245 967 218 940 L 204 921 C 204 808 196 693 213 619 L 221 577 C 221 473 230 360 258 285 C 299 219 371 184 449 182 Z M 513 57 C 489 57 477 73 473 95 C 468 118 478 146 487 174 L 545 174 C 555 145 564 114 558 92 C 553 71 537 57 513 57 Z'},
};

export function createSampleCutout(sample,width,height){
  const silhouette=silhouettes[sample];
  if(!silhouette)return null;
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1)throw Error('Invalid display cutout size');
  const canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d');
  context.scale(width/silhouette.width,height/silhouette.height);
  context.fillStyle='#ffffff';context.fill(new Path2D(silhouette.path),'evenodd');
  return {width,height,data:context.getImageData(0,0,width,height).data,sample,source:'hand-authored-example-cutout'};
}
