import { Node, RenderTarget, NodeMaterial, QuadMesh, RendererUtils, FloatType, HalfFloatType, RedFormat, NearestFilter, NearestMipmapNearestFilter } from 'three/webgpu';
import { NodeUpdateType, passTexture, texture, uv, vec4, outputStruct, context } from 'three/tsl';
import { fullscreenGraphContext } from './FullscreenGraphContext.js';

// The SSRT3 reference builds depth/light/normal pyramids and uses point samples
// from coarser levels at distant steps. Keep HDR color and depth precision here;
// changing their formats is a separate quality/performance comparison.
export default class SSGISourcePyramid extends Node {
  static get type() { return 'SSGISourcePyramid'; }
  constructor( beauty, depth, normal, enabled, maxSampleLevel = Infinity ) {
    super( 'vec4' );
    Object.assign( this, { beauty, depth, normal, enabled, maxSampleLevel } );
    this.updateBeforeType = NodeUpdateType.FRAME;
    this.frames = 0;
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
  sample( index, coords, level ) {
    // This runtime's PassTextureNode.clone drops UV/LOD. A plain TextureNode
    // retains both; the pass nodes above still own explicit producer scheduling.
    return texture( this.target.textures[ index ], coords ).level( level );
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
  setSize( width, height ) {
    const levels = Math.min( this.maxSampleLevel, Math.floor( Math.log2( Math.max( width, height ) ) ) ) + 1;
    if ( this.target.width === width && this.target.height === height && this.target.textures[ 0 ].mipmaps.length === levels ) return;
    // Three allocates render-target mips from this declared chain length.
    // The entries describe allocation only; its existing GPU downsampler still
    // generates every retained level with unchanged filtering and formats.
    if ( this.target.width === width && this.target.height === height ) this.target.dispose();
    for ( const map of this.target.textures ) {
      map.mipmaps = Array.from( { length: levels }, ( _, level ) => ( {
        width: Math.max( 1, width >> level ), height: Math.max( 1, height >> level )
      } ) );
    }
    this.target.setSize( width, height );
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
      this.setSize( image.width, image.height );
      renderer.setRenderTarget( this.target );
      this.quad.render( renderer );
      this.frames ++;
    } finally {
      // Switching away finishes this target and generates all three mip chains.
      RendererUtils.restoreRendererState( renderer, state );
    }
  }
  dispose() {
    super.dispose();
    this.material.dispose();
    this.target.dispose();
  }
}
