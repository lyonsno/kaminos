import { Node, RenderTarget, NodeMaterial, QuadMesh, RendererUtils, FloatType, HalfFloatType, RedFormat, NearestFilter, NearestMipmapNearestFilter } from 'three/webgpu';
import { NodeUpdateType, passTexture, texture, uv, vec4, vec2, outputStruct, context, uniform, Fn, If } from 'three/tsl';
import { fullscreenGraphContext } from './FullscreenGraphContext.js';
import SSGICoherentPyramid from './SSGICoherentPyramid.js';

// The SSRT3 reference builds depth/light/normal pyramids and uses point samples
// from coarser levels at distant steps. Keep HDR color and depth precision here;
// changing their formats is a separate quality/performance comparison.
export default class SSGISourcePyramid extends Node {
  static get type() { return 'SSGISourcePyramid'; }
  constructor( beauty, depth, normal, enabled, options = {} ) {
    super( 'vec4' );
    Object.assign( this, { beauty, depth, normal, enabled } );
    this.updateBeforeType = NodeUpdateType.FRAME;
    this.frames = 0;
    this.coherentEnabled = options.coherentEnabled ?? uniform( options.coherent ?? false, 'bool' );
    this.depthTolerance = options.depthTolerance ?? uniform( .05 );
    this.normalCos = options.normalCos ?? uniform( .5 );
    this.coherent = options.camera ? new SSGICoherentPyramid( options.camera ) : null;
    this.target = new RenderTarget( 1, 1, { count: 3, depthBuffer: false } );
    for ( const [ i, map ] of this.target.textures.entries() ) {
      map.name = [ 'SSGI mip depth', 'SSGI mip radiance', 'SSGI mip normal' ][ i ];
      map.type = i === 0 ? FloatType : HalfFloatType;
      if ( i === 0 ) map.format = RedFormat;
      map.generateMipmaps = true;
      map.minFilter = NearestMipmapNearestFilter;
      map.magFilter = NearestFilter;
    }
    this.depthNode = passTexture( this, this.target.textures[ 0 ] );
    this.beautyNode = passTexture( this, this.target.textures[ 1 ] );
    this.normalNode = passTexture( this, this.target.textures[ 2 ] );
    this.material = new NodeMaterial();
    this.material.name = 'SSGI source pyramids';
    this.quad = new QuadMesh( this.material );
  }
  sample( index, coords, level, allowCoherent = true ) {
    // This runtime's PassTextureNode.clone drops UV/LOD. A plain TextureNode
    // retains both; the pass nodes above still own explicit producer scheduling.
    const original = texture( this.target.textures[ index ], coords ).level( level );
    if ( ! this.coherent || allowCoherent === false ) return original;
    return Fn( () => {
      const result = vec4().toVar();
      const enabled = allowCoherent === true ? this.coherentEnabled : this.coherentEnabled.and( allowCoherent );
      If( enabled, () => { result.assign( texture( this.coherent.textures[ index ], coords ).level( level ) ); } )
        .Else( () => { result.assign( original ); } );
      return result;
    } )();
  }
  positionUV( coords, level, allowCoherent ) {
    if ( ! this.coherent ) return coords;
    return Fn( () => {
      const result = vec2( coords ).toVar();
      If( this.coherentEnabled.and( allowCoherent ), () => { result.assign( texture( this.coherent.textures[ 0 ], coords ).level( level ).gb ); } );
      return result;
    } )();
  }
  setup( builder ) {
    const graphContext = fullscreenGraphContext( this._graphContext, builder, this.version );
    if ( graphContext === this._graphContext ) return this.beautyNode;
    const coords = uv(), alternate = this.sourceOverride;
    const sample = ( original, key ) => alternate ? alternate.enabled.select( alternate[ key ].sample( coords ), original.sample( coords ) ) : original.sample( coords );
    this.material.contextNode = context( graphContext.shared );
    this.material.outputNode = outputStruct( sample( this.depth, 'depth' ).r,
      sample( this.beauty, 'beauty' ), vec4( sample( this.normal, 'normal' ).rgb, 1 ) );
    this.material.needsUpdate = true;
    this._graphContext = graphContext;
    return this.beautyNode;
  }
  updateBefore( frame ) {
    if ( ! this.enabled() ) return;
    for ( const node of [ this.beauty, this.sourceOverride?.beauty ] ) {
      if ( node?.passNode ) frame.updateBeforeNode( node.passNode );
    }
    const { renderer } = frame;
    const state = RendererUtils.resetRendererState( renderer );
    try {
      // These are source pixels, independent of the estimator's output scale.
      const image = this.depth.value.image;
      this.target.setSize( image.width, image.height );
      renderer.setRenderTarget( this.target );
      this.quad.render( renderer );
      this.frames ++;
    } finally {
      // Switching away finishes this target and generates all three mip chains.
      RendererUtils.restoreRendererState( renderer, state );
    }
    if ( this.coherentEnabled.value && this.coherent ) this.coherent.update( renderer, this.target, this.depthTolerance.value, this.normalCos.value );
  }
  dispose() {
    super.dispose();
    this.material.dispose();
    this.target.dispose();
    this.coherent?.dispose();
  }
}
