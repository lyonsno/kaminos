// Two complementary source pairs, one lower and one upper region per pixel.
// This is spatial quadrature, not a fresh random draw each frame. Weight two
// conserves the four-source sum over a cell with constant incident radiance.
export function validateSourceQuadrature(count,sampling='all') {
  if(!Number.isSafeInteger(count)||count<1)throw Error('surface point count must be a positive integer');
  if(!['all','paired'].includes(sampling))throw Error('unknown surface point sampling');
  if(sampling==='paired'&&count!==4)throw Error('paired sampling requires four surface points');
}
export function validateSourceEvaluationBudget(value=0){
  if(!Number.isSafeInteger(value)||value<0)throw Error('surface source budget must be a nonnegative integer');
  return value;
}
export function sourceEvaluationCount(count,budget=0,sampling='all'){
  validateSourceQuadrature(count,sampling);validateSourceEvaluationBudget(budget);
  return budget?Math.min(count,budget):sampling==='paired'?2:count;
}
export function sourceQuadratureReference(x,y,options) {
  if(options){
    const {count,budget=0}=options,n=sourceEvaluationCount(count,budget);
    const phase=((Math.floor(x)+Math.floor(y))%count+count)%count;
    return {indices:Array.from({length:n},(_,i)=>(phase+i)%count),weight:count/n};
  }
  const parity=((Math.floor(x)+Math.floor(y))%2+2)%2;
  return {indices:[parity,parity+2],weight:2,filterCoordinates:[Math.floor(x/2),Math.floor(y)]};
}
