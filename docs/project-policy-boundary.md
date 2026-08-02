# Generic core and project-policy boundary

## Current architecture

Generic core owns:

- OMP executable discovery and RPC protocol v2 transport;
- one structured sidebar surface, recent-session index, and selected-session routing;
- prompt, steering, follow-up, abort, extension UI, and history rendering;
- process-tree shutdown and per-worktree writer leases;
- editor-context remapping;
- generic sessions labelled `Custom access`.

Repository policies may add stronger launch, worktree, model, effort, and tool-inventory contracts.
Generic core does not claim those guarantees unless policy detection and parity both pass.

## Built-in Dzialkopedia policy

Version 2.4.0 still ships one built-in Dzialkopedia adapter. It is isolated by exact canonical Git
origin and fails closed unless repository launcher and declared adapter inventory match canonical
GitHub `main`. Its source-visible origin, control-file names, protocol identifiers, and test fixtures
are integration metadata, not credentials.

This is a runtime boundary, not yet a package boundary: generic users do not activate adapter, but
adapter code is compiled into same VSIX. Public stable release should move project trust anchors into
declarative, independently installable policy bundle or companion extension without weakening
canonical-byte verification. Until then, changes to built-in adapter require its exact parity suite.

## Rules for future adapters

1. Generic folder must work without adapter.
2. Adapter activation requires explicit repository identity; folder name is insufficient.
3. No project code runs before trust validation.
4. Adapter cannot silently broaden executable, arguments, cwd, tools, model, or write ownership.
5. Credentials remain outside adapter and repository.
6. Generic UI labels unverified policy as `Custom access`, never `Full access`.
7. Project-specific tests use synthetic paths and redacted fixtures.
