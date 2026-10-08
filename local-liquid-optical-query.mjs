/** Host scene depth is metric view depth, not the private toy G-buffer. */
export function localLiquidOpticalQueryControls(camera,hostFrame=false) {
 if(!hostFrame)return [0,0,0,0];
 const near=camera?.near,far=camera?.far;
 if(!Number.isFinite(near)||!Number.isFinite(far)||near<0||far<=near)throw Error('Host optical query requires a valid camera depth interval');
 return [1,far,near,0];
}
