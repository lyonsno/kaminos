import {build} from 'esbuild';
await build({entryPoints:['structural-material-chunk-integration.js'],outfile:'dist/structural-material-chunk-integration.js',bundle:true,format:'esm',target:'es2022',external:['three','three/webgpu','three/tsl']});
