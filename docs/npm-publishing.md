# npm Publishing

Use the manual `npm publish` Actions workflow to publish an approved package
through GitHub OIDC. It needs no npm write token and adds no staged approval.
Publication approval remains part of the shop's release workflow.

## Configure Once

Create the GitHub environment `npm` in `lyonsno/kaminos`. Allow deployment
from the branch `main` only, not tags, and leave required reviewers and wait
timers unset. Do this before registering npm trust: an environment created
implicitly by a workflow has no branch restriction.

For each existing npm package, open Settings / Trusted publishing and add:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `lyonsno` |
| Repository | `kaminos` |
| Workflow filename | `npm-publish.yml` |
| Environment | `npm` |
| Allowed action | Allow `npm publish` |

Use the npm website's existing owner session. Trust administration requires
interactive 2FA; routine OIDC publication does not add a per-release owner
challenge. Do not grant only staged-publish permission.

Register trust when an approved release can run: new configurations expire
unless their first successful publish occurs within 48 hours. A new package
must exist before it can have trust configured. Its first publication is a
separate authenticated bootstrap, not a requirement to stage later releases.

Official contracts: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/),
[trust administration](https://docs.npmjs.com/cli/v12/commands/npm-trust/),
[GitHub environment configuration](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

## Prepare And Publish

The workflow accepts one package, exact version, source commit and approved
archive SHA256. Package choices map to the existing producers:

| Choice | Package | Producer |
| --- | --- | --- |
| `kit` | `@kaminos/webgpu-inference-kit` | `npm pack` in `webgpu-inference-kit` |
| `klein` | `@kaminos/flux2-klein` | `models/flux2-klein/pack-klein.mjs` |
| `supermat` | `@kaminos/supermat` | `scripts/pack-supermat-module.mjs` |
| `unimate` | `@kaminos/unimate-webgpu` | `models/unimate/pack-npm.mjs` |
| `u2net` | `@kaminos/u2net` | `scripts/pack-u2net-module.mjs` |

Choose the immutable source commit that produced the approved archive, including
its version metadata. The workflow can pack an unlanded approved source commit;
the publication machinery itself must run from `main`.

After the exact package/version/archive has approval:

```sh
gh workflow run npm-publish.yml --repo lyonsno/kaminos --ref main \
  -f package=kit -f version="$VERSION" -f source="$SOURCE_COMMIT" \
  -f sha256="$APPROVED_ARCHIVE_SHA256" -f publish=false
```

The default `publish=false` builds and verifies without receiving npm publishing
credentials. Read the run's `npm-release` artifact: `report.json` must say
`prepared`, the effective source must match, and `package.tgz` must match the
approved SHA256. Packaging uses the existing producer scripts and npm11.12.1;
changed bytes fail rather than silently replacing the approved archive.

Run with `-f publish=true` to publish the same approved package. Only the
separate publication job receives `id-token: write`; it requires a manual
dispatch from main on a GitHub-hosted runner and the `npm` environment.
It downloads this run's artifact, verifies its source, metadata and bytes again,
and calls `npm publish --ignore-scripts` with npm12.2.1/Node24.15.0.
It does not install or execute the package's code.

Preparation logs and failures remain in `npm-release`; final verification
remains in `npm-publication`. An npm publish exit is not a complete consumer
installation witness: the release owner checks registry metadata/integrity and
installs the published version. If publication succeeded but a later observation
failed, inspect the registry before retrying; never blindly republish a version.

No local CLI login is needed to run this workflow. `npm whoami` does not test
OIDC publication access, and `npm publish --dry-run` does not establish it.
The first actual approved publish is the end-to-end authentication witness.
