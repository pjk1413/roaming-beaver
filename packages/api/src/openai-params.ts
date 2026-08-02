/** Models (gpt-5*) reject non-default temperature — omit rather than force 0.x. */
export function openaiChatModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

export function openaiTemperature(
  preferred: number,
): { temperature: number } | Record<string, never> {
  const model = openaiChatModel();
  if (/^gpt-5/i.test(model)) return {};
  return { temperature: preferred };
}
