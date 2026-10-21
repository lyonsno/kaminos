import poseComparison from './pose-comparison.mjs';

export default async function preview(context) {
  process.send?.({type:'preview-mounted',at:Date.now()});
  const result=await poseComparison(context);
  process.send?.({type:'preview-captured',at:Date.now()});
  return result;
}
