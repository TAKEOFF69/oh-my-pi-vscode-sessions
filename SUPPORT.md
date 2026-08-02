# Support

## Compatibility

| Component | Supported baseline |
| --- | --- |
| VS Code | 1.85 or newer |
| OMP | 17.1.3 or newer with RPC protocol v2 |
| Windows | x64 and arm64 |
| macOS | x64 and arm64 |
| Linux | x64 and arm64 |

Current OMP is recommended. Full structured parity requires RPC protocol v2; older runtimes are not
supported even if a terminal session can start.

## Getting help

- Reproducible bugs: open a bug report.
- Feature proposals: open a feature request.
- Security vulnerabilities: use private reporting described in [SECURITY.md](SECURITY.md).
- OMP runtime/provider questions: use the upstream [Oh My Pi repository](https://github.com/can1357/oh-my-pi).

Include extension version, OMP version, VS Code version, operating system, architecture, and relevant
redacted output. Never post tokens, private source, prompts containing sensitive data, or full local
paths when a repository-relative path is sufficient.

Project-specific adapters are supported by their owning project. Generic extension issues should
reproduce without a private adapter whenever possible.
