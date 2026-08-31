# Archive Workbench

Archive Workbench is a conservative ZIP manager. It previews all central-directory entries, makes an extraction plan before writing anything, creates simple stored ZIP archives, and extracts only after separately granted archive and destination dialogs.

The ZIP boundary rejects traversal, absolute/Windows/UNC paths, backslashes, NULs, unsupported/encrypted/data-descriptor entries, symlinks/hardlinks/devices/FIFOs, oversized files, compression bombs, Unicode/case collisions, Windows reserved names, and unsafe ancestors. The default conflict policy is `rename`; it never silently overwrites.

TAR/TGZ is displayed as “planned” in this version rather than being accepted through an incomplete safety model. The UI previews ZIPs, selects an explicit destination, then asks for confirmation before extraction; all node filesystem work remains behind a small capability bridge. The plugin rejects symlinks already present at checked paths and rechecks critical paths before writes, but pure cross-platform Node cannot promise protection against a same-account process concurrently replacing the directory tree; do not treat this as a hostile multi-process sandbox.

Run `npm test`, `npm run build`, then `npm run verify-dist`. Physical archive handling on ZTools Windows/macOS/Linux hosts is not yet tested.
