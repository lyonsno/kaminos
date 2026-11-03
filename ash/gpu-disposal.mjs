// Geometry disposal owns rendered storage attributes used as vertex inputs. Compute-only
// attributes remain ours; a failed construction may not have allocated them.
export function releaseAshAttributes(renderer,attributes){
 for(const attribute of attributes)if(renderer.backend.get(attribute).buffer)renderer.backend.destroyAttribute(attribute);
}
