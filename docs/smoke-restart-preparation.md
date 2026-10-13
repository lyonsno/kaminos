# Fresh Smoke Preparation

The shared preparation adapter turns a producer's existing launch builder into
a Greenroom restart command. A producer exports one function; Greenroom supplies
the new identity and destination and retains the old attempt. The dispatched
runner initializes its recording at the new destination through its usual
recording mount.

```js
// /absolute/project/prepare-smoke.mjs
import path from 'node:path';

export async function prepareAttempt({ requestId, outputDir, inputs }) {
  return {
    schema: 'gpu-greenroom.interactive-smoke.v1',
    id: requestId,
    kind: 'interactive-smoke',
    title: 'Material study',
    prompt: 'Compare the material response while moving the light.',
    availability_note: 'Prepared for a fresh session.',
    availability: 'prepared',
    target: { kind: 'browser', url: inputs.url },
    source: { agent_id: inputs.owner, repo_root: inputs.repo },
    operator_command: {
      schema: 'gpu-greenroom.command.v3',
      agent_id: inputs.owner,
      repo_root: inputs.repo,
      cwd: inputs.repo,
      route_identity: 'material-study',
      argv: [inputs.node, path.join(inputs.repo, 'tools/material-smoke.mjs'),
        '--out', outputDir, '--session', path.join(outputDir, 'session.json')],
      output_dir: outputDir,
      preflight: {
        argv: [inputs.node, path.join(inputs.repo, 'tools/material-preflight.mjs'), inputs.scene],
        inputs: [inputs.scene, path.join(inputs.repo, 'tools/material-preflight.mjs')],
      },
    },
  };
}
```

Use your producer's actual accepted request builder and launch inputs. The
example names an illustrative material runner; domain preparation belongs in
that producer module. It returns JSON-compatible data, including additive
request fields used by its caller. The preparation function constructs a launch
request; execution belongs to Greenroom's normal admission and dispatch path.

## Registration

Supply the local `restart` descriptor with the original smoke request:

```js
restart: {
  schema: 'gpu-greenroom.smoke-restart.v1',
  argv: [nodeExecutable, '/absolute/kaminos/tools/prepare-smoke-restart.mjs',
    '--producer', '/absolute/project/prepare-smoke.mjs'],
  cwd: '/absolute/project',
  inputs: canonicalProducerInputs,
  input_paths: [
    '/absolute/kaminos/tools/prepare-smoke-restart.mjs',
    '/absolute/project/prepare-smoke.mjs',
    // Include imported preparation sources and configuration files here.
  ],
}
```

This adapter implements Handy's proposed Greenroom restart wire contract.
Consumer integration and the restart action are versioned in Greenroom. A local
registration fixes literal command arguments and declared source paths; the
HTTP action refers to that registration by request identity/digest.

The adapter accepts one stdin JSON object with
`schema: gpu-greenroom.smoke-restart-input.v1`, `action_id`, `requestId`, an
absolute `outputDir`, and object `inputs`. It calls `prepareAttempt` once, then
emits one stdout JSON object with `schema: gpu-greenroom.smoke-restart-result.v1`,
the same `action_id`, and the returned `request`. The request's `id` must match
`requestId`. Additional envelope fields are accepted; request fields pass through.

Console diagnostics, including import-time logs, go to stderr. Producers use
`console` for diagnostics and return their result; stdout is reserved for the
adapter. Failures exit nonzero and add a JSON stderr diagnostic with a `phase`
and `error`. Greenroom retains the invocation and full stdout/stderr beneath
its action receipt directory, including failures before a request exists.

Greenroom owns prior-input validation, prepared-command validation, same-owner
and new-output checks, durable duplicate-click identity, interruption recovery,
queue submission and Start. The adapter owns argument transfer, one producer
invocation, result identity and serialization. Registered producer code executes
with the invoking process's permissions; it is trusted local setup code.

For a local wire check, run the command above with its stdin envelope redirected
from a file. Run `npm test -- --only tests/prepare-smoke-restart.test.mjs` for
the CPU adapter tests. These establish the preparation boundary; Greenroom's
consumer exercise establishes the button-to-new-session path.
