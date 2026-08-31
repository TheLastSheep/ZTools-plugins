# OpenAPI Contract Gate

An offline contract ledger for OpenAPI 3 and Swagger 2 JSON or conservative YAML. It compares endpoints, methods, parameters, request bodies, responses, security, schema required fields, types, and enums, with JSON Pointer evidence for each finding.

YAML is parsed only in the preload boundary. Normal mappings, sequences, quoted values, and block scalars are accepted; anchors, aliases, explicit tags, duplicate keys, and remote `$ref` values are rejected instead of being resolved. Files are capped at 10 MiB, depth 60, and 40,000 audited nodes.

Node contract tests, packaged-dependency checks, source/dist identity, and Chromium rendering are verified. Loading and file-dialog behavior in real Windows, macOS, and Linux ZTools hosts remain untested.
