# Plugin Guard

Plugin Guard reads a selected plugin directory and reports manifest errors, risky capability patterns, file limits, path hazards, and a masked evidence report. It does not modify the scanned directory and does not follow symbolic links. Audited text is read in full within the global scan-byte limit; it is never silently truncated.

The scanner limits traversal depth, file count, and total bytes; unknown bridge fields fail closed. Reports are exportable as JSON or Markdown. ZIP inspection is intentionally not enabled in this first version because a safe archive parser belongs behind the same limits as a dedicated archive tool.

The scanner uses lstat, realpath, and checked open handles to narrow filesystem races. A same-account process can still replace a directory tree between checks; pure cross-platform Node cannot eliminate that class without platform-specific filesystem capabilities, so re-run a scan immediately before publishing.

Run `npm test`, `npm run build`, then `npm run verify-dist`. Physical ZTools host testing is still required on Windows, macOS, and Linux.
