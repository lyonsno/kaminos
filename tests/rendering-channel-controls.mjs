import assert from 'node:assert/strict';
import { renderingChannelsForMode, sceneSourceIntensityForMode, parseSceneSourcePosition } from '../rendering-channel-controls.mjs';

assert.deepEqual(renderingChannelsForMode('all'), { shared: true, flameField: true });
assert.deepEqual(renderingChannelsForMode('shared'), { shared: true, flameField: false });
assert.deepEqual(renderingChannelsForMode('flame-field'), { shared: false, flameField: true });
assert.deepEqual(renderingChannelsForMode('neither'), { shared: false, flameField: false });
assert.throws(() => renderingChannelsForMode('unknown'), /unknown rendering mode/);

const authored = [3, 1, 0.2];
assert.deepEqual(sceneSourceIntensityForMode(authored, 'neither'), [0, 0, 0]);
assert.deepEqual(sceneSourceIntensityForMode(authored, 'all'), authored);
assert.deepEqual(sceneSourceIntensityForMode(authored, 'shared', 3), [24, 8, 1.6]);
assert.deepEqual(authored, [3, 1, 0.2], 'isolation must not overwrite authored source intensity');
assert.deepEqual(parseSceneSourcePosition('0, -0.5, 1.25'), [0, -0.5, 1.25]);
assert.equal(parseSceneSourcePosition('0,NaN,1'), null);
assert.equal(parseSceneSourcePosition('0,1'), null);
assert.equal(parseSceneSourcePosition('0,1,2,3'), null);
