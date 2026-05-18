const unitWords =
  "кг|г|гр|л|мл|шт|уп\\.?|упак\\.?|пач\\.?|пак\\.?|кор\\.?|короб(?:ка)?|бан(?:ка)?|бут\\.?|вед\\.?|рул\\.?|порц\\.?"

export const unitRegexes: RegExp[] = [
  new RegExp(
    `(^|[^\\p{L}\\p{N}])(\\d+(?:[.,]\\d+)?\\s*(?:${unitWords})\\s*[xх]\\s*\\d+)(?=$|[^\\p{L}\\p{N}])`,
    "iu"
  ),
  new RegExp(
    `(^|[^\\p{L}\\p{N}])(\\d+\\s*[xх]\\s*\\d+(?:[.,]\\d+)?\\s*(?:${unitWords}))(?=$|[^\\p{L}\\p{N}])`,
    "iu"
  ),
  new RegExp(
    `(^|[^\\p{L}\\p{N}])(\\d+(?:[.,]\\d+)?\\s*(?:${unitWords}))(?=$|[^\\p{L}\\p{N}])`,
    "iu"
  ),
  new RegExp(`(^|[^\\p{L}\\p{N}])((?:${unitWords}))(?=$|[^\\p{L}\\p{N}])`, "iu")
];

export function extractUnitOrPackage(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  for (const regex of unitRegexes) {
    const match = normalized.match(regex);
    if (match?.[2]) {
      return match[2].replace(/\s+/gu, " ").trim();
    }
  }
  return "";
}

export function extractUnitFromPrice(text: string): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  const matches = Array.from(
    normalized.matchAll(new RegExp(`\\/\\s*(${unitWords})(?=$|[^\\p{L}\\p{N}])`, "giu"))
  );
  const unit = matches.at(-1)?.[1];
  return unit ? unit.replace(/\.$/u, "").trim() : "";
}
