/**
 * Chooses the suggested filename for a new Markdown document.
 *
 * This is only a suggestion for the platform Save panel: the person remains
 * free to choose another location and name. Keeping the rule pure makes the
 * native shell's first-save behaviour testable without a dialog.
 */
export function suggestedMarkdownFileName(markdown: string): string {
  const heading = markdown
    .split(/\r\n|\r|\n/u)
    .map((line) => /^ {0,3}#(?!#)[ \t]+(.+?)\s*$/u.exec(line)?.[1])
    .find((candidate): candidate is string => candidate !== undefined && candidate.trim() !== '')

  const stem = heading
    ?.replace(/[ \t]+#+\s*$/u, '')
    .replace(/[\\/:*?"<>|]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/\.(md|markdown)$/iu, '')
    .slice(0, 120)

  return stem === undefined || stem === '' || stem === '.' || stem === '..'
    ? 'Untitled.md'
    : `${stem}.md`
}
