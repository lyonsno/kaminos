export function validateNormalizationSetup(setup){
 if(setup?.correction!=='pose-and-rig-proportions')throw Error('Explicit pose and proportion correction label required');
 if(typeof setup.castLabel!=='string'||!setup.castLabel.trim())throw Error('Cast label required');
 if(setup.casts?.length!==2)throw Error('Exactly two comparison bodies required');
 const [a,b]=setup.casts;
 if(a.slug!=='original'||b.slug!=='corrected'||a.case_sha256===b.case_sha256)throw Error('Original and corrected distinct packages required');
 if(a.motion_sha256!==b.motion_sha256||a.frame_sha256!==b.frame_sha256)throw Error('Comparison requires same motion and rig frame');
 return setup;
}
