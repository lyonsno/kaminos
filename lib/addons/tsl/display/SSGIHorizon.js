import { Fn, float, vec2, abs, sqrt, clamp, PI, HALF_PI, sign } from 'three/tsl';

// Extracted unchanged from the horizon loop so the production angular law can
// be exercised with explicit coarse-source positions on native hardware.
export const ssgiHorizonSide = Fn( ( [ requestedSide, actualTangent, useRetainedPoint ] ) => useRetainedPoint.select( sign( actualTangent ), requestedSide ) ).setLayout( {
 name: 'ssgiHorizonSide', type: 'float', inputs: [
  { name: 'requestedSide', type: 'float' }, { name: 'actualTangent', type: 'float' }, { name: 'useRetainedPoint', type: 'bool' }
 ]
} );
export const ssgiHorizonInterval = Fn( ( [ frontBackCos, normalAngle, side ] ) => {
 const outVal = abs( frontBackCos ).mul( float( -0.156583 ) ).add( HALF_PI ).mul( sqrt( abs( frontBackCos ).oneMinus() ) );
 const angles = vec2( frontBackCos.x.greaterThanEqual( 0 ).select( outVal.x, PI.sub( outVal.x ) ),
  frontBackCos.y.greaterThanEqual( 0 ).select( outVal.y, PI.sub( outVal.y ) ) );
 const interval = clamp( side.mul( angles.negate() ).sub( normalAngle.sub( HALF_PI ) ).div( PI ) );
 return side.greaterThan( 0 ).select( interval.yx, interval.xy );
} ).setLayout( { name: 'ssgiHorizonInterval', type: 'vec2', inputs: [
 { name: 'frontBackCos', type: 'vec2' }, { name: 'normalAngle', type: 'float' }, { name: 'side', type: 'float' }
] } );
