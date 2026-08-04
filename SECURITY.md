# Security policy

Oh My Pi Sessions launches local agent processes with access to developer workspaces. Reports about
process execution, worktree isolation, webview content, credential handling, project-policy
validation, or path traversal are treated as security issues.

## Supported versions

Security fixes are provided for the latest published minor release. Pre-release builds receive
best-effort fixes and may change without compatibility guarantees.

| Version | Supported |
| --- | --- |
| Latest `2.x` release | Yes |
| Older releases | No |
| Unreleased `main` | Best effort |

## Report privately

Do not open a public issue for a vulnerability. Use GitHub's private vulnerability reporting:

<https://github.com/TAKEOFF69/oh-my-pi-vscode-sessions/security/advisories/new>

Include:

- affected extension and OMP versions;
- operating system and architecture;
- minimal reproduction;
- expected and observed security boundary;
- whether credentials, source files, or Git state may have been exposed;
- suggested mitigation, if known.

Do not include real access tokens, provider credentials, private source, or customer data. Replace
them with redacted fixtures.

Maintainers aim to acknowledge a complete report within three business days. Disclosure timing is
coordinated with the reporter after a fix is available.

## Security boundaries

- OMP remains the model, credential, tool, and session runtime.
- Extension never requires provider tokens in repository settings.
- Generic sessions execute only in VS Code-trusted workspaces and show `Custom access` unless a
  project policy proves a stricter tool contract.
- Writer leases prevent two extension sessions from owning the same worktree concurrently.
- Webviews use nonce-bound scripts and a deny-by-default content security policy.
- Closing a session reaps its process tree before releasing writer lease.

Project-specific launch policies may impose stronger requirements. Their guarantees apply only
when policy validation passes; they are not inferred for generic folders.
