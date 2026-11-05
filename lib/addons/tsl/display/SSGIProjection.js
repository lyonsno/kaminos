// Coefficients of the actual projection, including zoom, view offsets and TAA
// jitter. Oblique/custom projections retain the general inverse-matrix path.
export function updateSSGIPerspectiveParameters( camera, scaleOffset, depth ) {
  const e = camera.projectionMatrix.elements;
  if ( camera.isPerspectiveCamera !== true || ! e.every( Number.isFinite ) ||
    e[ 0 ] === 0 || e[ 5 ] === 0 || e[ 14 ] === 0 ||
    e[ 3 ] !== 0 || e[ 7 ] !== 0 || e[ 11 ] !== - 1 || e[ 15 ] !== 0 ||
    [ 1, 2, 4, 6, 12, 13 ].some( i => e[ i ] !== 0 ) ) return false;
  scaleOffset.set( 1 / e[ 0 ], 1 / e[ 5 ], e[ 8 ], e[ 9 ] );
  depth.set( e[ 14 ], e[ 10 ] );
  return true;
}
