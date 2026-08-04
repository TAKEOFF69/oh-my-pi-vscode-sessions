export type SelectableSession = {
  setActive(active: boolean): void;
};

export function clearSessionSelection(
  sessions: readonly SelectableSession[],
): undefined {
  for (const session of sessions) session.setActive(false);
  return undefined;
}
