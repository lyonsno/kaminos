// Physical chart metadata is carried in the extensible architecture string of
// the author archive. Legacy checkpoints keep exactly their original convention.
export const CHART_PREFIX='kaminos-chart-v1:';
export function validateNeumipChart(chart){
 if(!chart||![chart.width,chart.depth,chart.offsetMeters].every(x=>Number.isFinite(x)&&x>0)||!['clamp','repeat'].includes(chart.boundary))throw Error('Invalid physical material chart');
 return {width:chart.width,depth:chart.depth,offsetMeters:chart.offsetMeters,boundary:chart.boundary};
}
export function chartOffsetScale(chart){return chart?[chart.offsetMeters/chart.width,chart.offsetMeters/chart.depth]:[.05,.05];}
