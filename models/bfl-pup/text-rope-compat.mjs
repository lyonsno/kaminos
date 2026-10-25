// Transformers.js4.2 Qwen2VL._get_text_only_rope_index computes
// max_position + 1 + sequence_length; its decoder then adds cache length.
// Canonical text continuation needs max_position + 1 - sequence_length.
// Actual three-token browser/native comparison is retained in conversion receipts.
export function installTextRopeCompatibility(model){
 if(typeof model._get_text_only_rope_index!=='function')throw Error('The pinned Qwen text-only position method is unavailable.');
 const original=model._get_text_only_rope_index.bind(model);
 model._get_text_only_rope_index=(inputIds,attentionMask)=>{
  const result=original(inputIds,attentionMask);
  const adjustment=2n*BigInt(inputIds.dims[1]);
  for(let i=0;i<result[1].data.length;i++)result[1].data[i]-=adjustment;
  return result;
 };
}
