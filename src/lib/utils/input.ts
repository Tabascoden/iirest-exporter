export function normalizeInputItems(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const line of raw.split(/\r?\n/u)) {
    const value = line.replace(/\s+/gu, " ").trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}
