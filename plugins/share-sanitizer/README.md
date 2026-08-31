# Share Sanitizer

Local-first review desk for removing sensitive data before text or an image is shared.

It detects email addresses, Chinese phone and ID numbers, IPv4 addresses, absolute paths, Bearer/API credentials and JWTs. Rules can be disabled and approved values can be whitelisted. Image output is drawn onto a new canvas, which removes image metadata; the user can add manual rectangular masks. Browser OCR is deliberately optional: when `TextDetector` is unavailable the UI says so and never claims OCR completed.

## Safety and portability

- The detector is pure JavaScript and tests POSIX, Windows and Linux path shapes without relying on the host OS.
- The narrow preload bridge only exposes host clipboard actions (`copyText` and `copyImage`) when those APIs exist; renderer code never receives a filesystem path.
- Input is capped at 1 MiB and 500 findings to keep the UI responsive.
- No network, external fonts, native add-ons, or shell commands are used.

Run `npm test`, `npm run build`, and `npm run verify-dist`. Runtime loading on physical Windows/macOS/Linux ZTools hosts remains to be tested.
