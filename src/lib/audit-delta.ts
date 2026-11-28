/**
 * Which audit findings did an import introduce?
 *
 * The catalogue carries known findings, so the totals say little about one
 * week. What matters to a reviewer is what was not there before.
 */

/** Findings in an `audit --report` file, each with the section it sits under. */
export function findings(report: string): string[] {
  const out: string[] = [];
  let section = '';
  for (const line of report.split('\n')) {
    if (line.startsWith('## ')) section = line.slice(3).trim();
    // The table of contents is a list too, but sits under its own heading.
    else if (section && section !== 'Contents' && line.startsWith('- ')) out.push(`[${section}] ${line.slice(2)}`);
  }
  return out;
}

export function newFindings(before: string, after: string): string[] {
  const left = new Map<string, number>();
  for (const f of findings(before)) left.set(f, (left.get(f) ?? 0) + 1);
  return findings(after).filter((f) => {
    const n = left.get(f) ?? 0;
    left.set(f, n - 1);
    return n <= 0;
  });
}
