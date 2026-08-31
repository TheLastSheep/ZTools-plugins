# HAR Doctor

An offline HAR waterfall diagnostician. It accepts up to two `.har` files, masks common credentials by default, and reports latency, errors, redirects, cache/CORS/security posture, transfer duplication, plus an environment diff.

No network request is made. Limits: 20 MiB per file and 5,000 entries. Pure-JavaScript path contracts, Node tests, build verification, and Chromium rendering are verified; loading and file-dialog behavior in real Windows, macOS, and Linux ZTools hosts remain untested.
