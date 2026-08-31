# Webhook Lab

A bounded local webhook receiver. It listens only on loopback with a random route token, retains at most 200 small events, and can render/verify payloads without sending them anywhere. Replay is intentionally not in this first release.

On Windows, the copied sample is PowerShell-executable: it uses single-quoted arguments with `curl.exe`; the local listener URL is rejected if it contains a single quote.

Cross-platform command and lifecycle contracts are covered by Node tests, and the loopback server was smoke-tested on the development macOS machine. Loading in real Windows, macOS, and Linux ZTools hosts remains untested; Windows PowerShell execution and Linux runtime behavior are contract-tested only.
