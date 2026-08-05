# Privacy

Oh My Pi Sessions has no analytics or advertising telemetry.

## Local data

Extension keeps session metadata needed by VS Code, including session label, working directory,
branch, process state, and local diagnostic timing. OMP owns conversation storage, model-provider
authentication, tool execution, and provider requests.

While attached, screenshot bytes exist in current webview memory and extension-host draft memory so
switching chats or a failed launch can restore them. They are not written to recent-session metadata
or VS Code webview state, and they leave extension only when included in a prompt sent to OMP.

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
