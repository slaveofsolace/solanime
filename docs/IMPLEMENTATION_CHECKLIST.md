# Implementation status

This file previously recorded the initial September 10 catalogue reconstruction. That historical checklist remains in Git history; it is not the acceptance record for the current cloud release.

See [cloud release verification](cloud-release-checklist.md) for current test results, deployment gates, exact imported counts, and pending work. See [cloud operations](CLOUD_RELEASE.md) for setup, backup, restoration, and durable import controls.

## Invariants

- Preserve source identifiers and independently observed title, episode, language, and provider relationships.
- Never replace failed imports with empty inventories or delete previously good records on transient failure.
- Keep metadata coverage, provider implementation, successful resolution, and browser playback verification separate.
- Retain incomplete queues and report their exact scope; an import checkpoint is not full coverage.
- Permit native playback only for a reviewed resource through its supported public interface. Do not embed webpage-only players, bypass access restrictions, or retain temporary media URLs.
- Keep accounts, operator research, secrets, and catalogue exports separated. A source archive is not a database backup.
