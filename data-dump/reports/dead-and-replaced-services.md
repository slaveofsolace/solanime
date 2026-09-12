# Availability, redirects and unresolved entries

230 redirect chains were observed; see indexes/redirects.json. No service is conclusively labeled dead or replaced solely from a request failure.

| Unresolved reason | Resource count |
|---|---:|
| http_403 | 193 |
| robots_disallow_or_unavailable | 133 |
| redirect_target_robots_disallow_or_unavailable | 9 |
| http_451 | 2 |
| ReadTimeout | 2 |
| redirect_limit | 2 |
| http_503 | 2 |
| redirect_target_not_requested | 1 |
| run_budget_exhausted | 1 |
| challenge_document | 1 |
| http_526 | 1 |

All resources remain in reports/unresolved.json. A successful response can be a shell, landing page or challenge not detected by the heuristic. A single 403/404/timeout is not a service-wide availability judgment.
