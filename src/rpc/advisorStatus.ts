export const EXPECTED_ADVISOR_SELECTOR = "openai-codex/gpt-5.6-sol";

export function advisorStatusMatches(output: string): boolean {
  return new RegExp(
    `Advisor is enabled \\(${escapeRegExp(EXPECTED_ADVISOR_SELECTOR)}\\)\\.`,
    "i",
  ).test(output);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
