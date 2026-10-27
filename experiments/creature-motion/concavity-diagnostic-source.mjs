const fields=['concavityCostPerLength','originalForelimbShare','candidateForelimbShare','transferredToChest','leftCostDistance','rightCostDistance'];
export function validateConcavityDiagnostic({descriptor,caseSha256,values}){
 const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 if(!descriptor||!sha(descriptor.sourceManifestSha256)||!sha(descriptor.candidateManifestSha256)||!sha(descriptor.sha256)||![descriptor.sourceManifestSha256,descriptor.candidateManifestSha256].includes(caseSha256))throw Error('Diagnostic binding association differs from displayed case');
 if(!Array.isArray(descriptor.shape)||descriptor.shape.length!==2||descriptor.shape[1]!==6||!Number.isInteger(descriptor.shape[0])||descriptor.shape[0]<1||values.length!==descriptor.shape[0]*6)throw Error('Diagnostic shape differs from declared binding');
 if(!Array.isArray(descriptor.fields)||fields.some((field,i)=>descriptor.fields[i]!==field)||descriptor.fields.length!==6||!values.every(Number.isFinite))throw Error('Invalid concavity diagnostic fields');
 return descriptor;
}
