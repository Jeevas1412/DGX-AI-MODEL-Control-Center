# Contributing

The project is in public-delivery remediation and is not ready for external contributions yet. Proposed changes must preserve these boundaries:

- Do not add credentials, private IPs, user names, local paths, screenshots, logs or DGX snapshots to source control.
- Do not add arbitrary shell, SSH or remote-command execution paths.
- Keep remote actions fixed, adapter-scoped, confirmable and auditable.
- Run the relevant component tests and `scripts/verify-public-tree.ps1` before proposing a public change.

Public contribution workflow, code style and issue templates will be added after the root build and CI gates are established.
