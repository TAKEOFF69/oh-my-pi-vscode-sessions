## Summary

Describe user-visible change and why it belongs in generic extension or named project policy.

## Verification

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npx vsce ls`
- [ ] UI/browser verification completed or not applicable
- [ ] Regression test added or reason documented

## Safety and compatibility

- [ ] No credentials, private source, customer data, or personal absolute paths added
- [ ] Process, worktree, webview, URI, and project-policy boundaries are unchanged or explicitly reviewed
- [ ] OMP/VS Code compatibility impact documented
- [ ] Documentation and changelog updated when user-visible
