# Privacy

Oh My Pi Sessions has no analytics or advertising telemetry.

## Local data

Extension keeps session metadata needed by VS Code, including session label, working directory,
branch, process state, and local diagnostic timing. OMP owns conversation storage, model-provider
authentication, tool execution, and provider requests.

Extension output channel may contain local paths, branch names, executable errors, and process
timings. Review and redact logs before sharing them publicly.

## Network activity

Extension itself does not send prompts or source files to a maintainer-operated service. Network
activity may occur when:

- OMP contacts configured model or tool providers;
- user invokes tools that access network;
- VS Code checks or downloads extension updates;
- trusted project policy verifies canonical repository data through configured Git tooling.

Provider and tool privacy terms apply to those requests. Credentials remain under OMP, provider,
Git, or operating-system credential management; they must not be stored in workspace settings.

## Reporting

Privacy defects that expose credentials, private source, prompts, or local data should be reported
privately through [SECURITY.md](SECURITY.md).
