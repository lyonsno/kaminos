import { Fn, If, min, max, uint } from 'three/tsl';

// Shared by the production horizon sampler and its native numerical witness.
export const ssgiSourceMipLevel = Fn( ( [ index, distance, mode, fixedLevel, detailBias, maximum ] ) => {
  const level = min( index.add( 1 ).div( uint( 2 ) ).toFloat(), min( maximum, 4 ) ).toVar();
  If( mode.equal( uint( 1 ) ), () => { level.assign( fixedLevel.clamp( 0, maximum ) ); } );
  If( mode.equal( uint( 2 ) ), () => {
    level.assign( max( distance, 1 ).log2().sub( detailBias ).floor().clamp( 0, maximum ) );
  } );
  return level;
} ).setLayout( {
  name: 'ssgiSourceMipLevel', type: 'float', inputs: [
    { name: 'index', type: 'uint' }, { name: 'distance', type: 'float' },
    { name: 'mode', type: 'uint' }, { name: 'fixedLevel', type: 'float' },
    { name: 'detailBias', type: 'float' }, { name: 'maximum', type: 'float' }
  ]
} );
