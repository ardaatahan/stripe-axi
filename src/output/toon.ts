// TOON (Token-Oriented Object Notation) emitter. All stdout flows through
// this module so every command stays consistent (AXI principle 1).

export function print(text: string): void {
  process.stdout.write(text + "\n");
}

/**
 * Escapes one value so it can never break the one-record-per-line shape:
 * anything containing a comma, quote or line break is quoted, with quotes
 * doubled (CSV style) and line breaks written as \n / \r escapes. Emitting a
 * raw newline inside a quoted value would still split the record across two
 * physical lines, and the continuation line is neither a header nor an
 * indented row — parseToon (and any agent reading stdout) would reject it.
 */
export function toonValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (!/[,"\r\n\\]/.test(s)) return s;
  const escaped = s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '""')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return '"' + escaped + '"';
}

export function emitList(
  name: string,
  rows: Array<Record<string, unknown>>,
  fields: string[],
): string {
  const header = `${name}[${rows.length}]{${fields.join(",")}}:`;
  const lines = rows.map(
    (row) => "  " + fields.map((f) => toonValue(row[f])).join(","),
  );
  return [header, ...lines].join("\n");
}

/** A named block of pre-formatted lines, e.g. help[2]: or next[3]:. */
export function emitBlock(name: string, lines: string[]): string {
  return [`${name}[${lines.length}]:`, ...lines.map((l) => "  " + l)].join("\n");
}

/**
 * `key: value` lines. Values go through toonValue so a Stripe string
 * containing a comma, quote or newline (descriptions and customer names are
 * free-form) stays a single parseable TOON line instead of spilling into
 * lines that are neither a header nor an indented row.
 */
export function emitKV(pairs: Array<[string, unknown]>): string {
  return pairs.map(([k, v]) => `${k}: ${toonValue(v)}`.trimEnd()).join("\n");
}

/**
 * Tolerant TOON parser used by the validator: checks that text is shaped
 * like TOON (top-level `key: value` / `name[N]{f,..}:` headers with indented
 * rows) without enforcing a strict grammar.
 */
export function parseToon(text: string): { ok: boolean; errorLine?: number } {
  const lines = text.split("\n");
  let allowIndent = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    if (/^\s/.test(line)) {
      if (!allowIndent) return { ok: false, errorLine: i + 1 };
      continue;
    }
    const header = /^[A-Za-z][\w.-]*(\[[^\]]*\])?(\{[^}]*\})?:(\s.*|)$/.test(line);
    if (!header) return { ok: false, errorLine: i + 1 };
    allowIndent = true;
  }
  return { ok: true };
}
