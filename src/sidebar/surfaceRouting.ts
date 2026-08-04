export function messageMatchesSurface(
  raw: unknown,
  expectedToken: string,
): boolean {
  return (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    (raw as { surfaceToken?: unknown }).surfaceToken === expectedToken
  );
}

export function tagSurfaceMessage(
  message: unknown,
  surfaceToken: string,
): unknown {
  return typeof message === "object" && message !== null && !Array.isArray(message)
    ? { ...(message as Record<string, unknown>), surfaceToken }
    : message;
}
