# RiffTrax Pluto

Listed URL: https://pluto.tv/live-tv/rifftrax

HTTP observation: reachable; final URL: https://pluto.tv/us/watch/live-tv/18681/

Observed: 2026-09-12T07:42:20.349149+00:00

## Architecture evidence

Provider/infrastructure references: YouTube

These are source declarations or bounded homepage observations, not verified playback integrations. No end-to-end playable-media chain is certified.

| Reference | Evidence type | Source |
|---|---|---|
| https://pluto.tv/api/manifest/ | manifest | https://pluto.tv/us/watch/live-tv/18681/ |
| https://ipv4.pluto.tv/api/tn/video/playout/ | source-literal | https://pluto.tv/us/watch/live-tv/18681/ |
| https://hydra-api.cbsivideo.com/v1/token | client-endpoint-reference | https://pluto.tv/scripts/tn/dit.svc.datahub.js?v=26.08.04 |
| https://hydra-api.cbsivideo.com/v1/auth | client-endpoint-reference | https://pluto.tv/scripts/tn/dit.svc.datahub.js?v=26.08.04 |
| https://hydra-api.cbsivideo.com/v1/events | client-endpoint-reference | https://pluto.tv/scripts/tn/dit.svc.datahub.js?v=26.08.04 |

Additional references and exact timestamps/hashes are retained in metadata.json.

## Unresolved

Live server/provider selections, downstream media/CDN delivery, authorization, and any unvisited dependencies remain unknown unless a separate explicit claim establishes them. HTTP errors and blockers are not proof of service death.
