// CPU preparation fixture; execution and UI admission remain consumer-owned.
import { fileURLToPath } from 'node:url';

export function prepareAttempt({requestId, outputDir, inputs}) {
  return {
    schema: 'gpu-greenroom.interactive-smoke.v1', id: requestId,
    kind: 'interactive-smoke', source: {agent_id: inputs.owner, repo_root: inputs.repo},
    title: 'CPU restart preparation fixture', prompt: 'Exercise a fresh preparation.',
    availability: 'prepared', availability_note: 'CPU fixture only', target: {kind: 'terminal'},
    operator_command: {
      schema: 'gpu-greenroom.command.v3', agent_id: inputs.owner,
      repo_root: inputs.repo, cwd: inputs.repo, route_identity: 'cpu-restart-fixture',
      argv: [process.execPath, fileURLToPath(import.meta.url)], output_dir: outputDir,
    },
  };
}
