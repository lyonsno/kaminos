export function chooseComparisonLayout(width,height,aspect=1) {
  if(!(width>0&&height>0&&aspect>0))return 'grid';
  const fit=(columns,rows)=>Math.max(0,Math.min((width-12*(columns-1))/columns/aspect,(height-12*(rows-1))/rows-32));
  return fit(2,2)>fit(4,1)?'grid':'strip';
}
