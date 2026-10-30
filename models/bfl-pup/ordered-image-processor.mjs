// Transformers.js 4.2 Qwen2VLImageProcessor treats a flat image array as
// temporal frames. A reference set is independent still images: prepare each
// with the existing processor, then concatenate patches and one grid per image.
export function independentImageProcessor(single,cat){
 return Object.assign(async(images,...args)=>{
  if(!Array.isArray(images)||images.length<2)return single(images,...args);
  const parts=[],merged={};
  try{
   for(const image of images){
    const part=await single(image,...args);parts.push(part);
    const grids=part.image_grid_thw.tolist();
    if(grids.length!==1||Number(grids[0][0])!==1)throw Error('Each reference must produce one still-image grid.');
   }
   merged.pixel_values=cat(parts.map(p=>p.pixel_values),0);
   merged.image_grid_thw=cat(parts.map(p=>p.image_grid_thw),0);
   return{...merged,original_sizes:parts.flatMap(p=>p.original_sizes),reshaped_input_sizes:parts.flatMap(p=>p.reshaped_input_sizes)};
  }catch(error){for(const tensor of Object.values(merged))tensor.dispose();throw error;}
  finally{for(const part of parts){part.pixel_values.dispose();part.image_grid_thw.dispose();}}
 },{config:single.config});
}
