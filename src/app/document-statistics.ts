/**
 * Reading measurements for the statistics panel and the word-count pill.
 *
 * These describe the *prose* a person reads, not the Markdown bytes on disk, so
 * fenced code, link targets, and emphasis markers are removed before counting.
 * Counting the raw source instead would be simpler and wrong in the direction
 * that matters: a note full of code blocks would claim a reading time nobody
 * spends.
 *
 * Pure and app-level, exactly like reader-preferences: nothing here is written
 * to the `.md` file, and no count can make a document dirty.
 */

export interface DocumentStatistics {
  readonly words: number
  /** Characters of prose including the spaces between words, as Bear reports. */
  readonly characters: number
  readonly paragraphs: number
  /** Whole minutes, never zero for a document that has any words at all. */
  readonly readMinutes: number
}

/**
 * 265 words per minute — the widely used adult silent-reading average, and the
 * figure that reproduces Bear's own rounding on a shared sample note.
 */
const WORDS_PER_MINUTE = 265

/** Strips the Markdown that a reader sees through rather than reads. */
function prose(markdown: string): string {
  return (
    markdown
      // Fenced code first: everything inside is deliberately not prose, and
      // removing it early keeps its contents from matching the rules below.
      .replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1[ \t]*$/gm, '')
      .replace(/^[ \t]*(```|~~~)[\s\S]*$/gm, '')
      .replace(/`[^`\n]*`/g, '')
      // Images contribute nothing to read; links contribute their text only.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^[ \t]*\[[^\]]+\]:[^\n]*$/gm, '')
      .replace(/<[^>\n]+>/g, '')
      // Leading block markers: heading hashes, quote carets, list bullets.
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/^[ \t]*>[ \t]?/gm, '')
      .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, '')
      // Thematic breaks and table rules are furniture, not sentences.
      .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '')
      .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, '')
      .replace(/\|/g, ' ')
      // Inline emphasis markers, once their surrounding syntax is gone.
      .replace(/(\*\*\*|\*\*|\*|___|__|_|~~|==)/g, '')
  )
}

export function documentStatistics(markdown: string): DocumentStatistics {
  const text = prose(markdown)

  // A "word" must carry a letter or a number: a stray bullet or an em dash left
  // on its own line is punctuation, and counting it inflates every note.
  const words = text.split(/\s+/).filter((token) => /[\p{L}\p{N}]/u.test(token))
  const paragraphs = text
    .split(/\n[ \t]*\n/)
    .filter((block) => /[\p{L}\p{N}]/u.test(block)).length

  return {
    words: words.length,
    characters: words.join(' ').length,
    paragraphs,
    // Ceiling, floored at one: any prose at all takes a moment, and "0m" reads
    // as a failure to measure rather than as a short note.
    readMinutes: words.length === 0 ? 0 : Math.max(1, Math.ceil(words.length / WORDS_PER_MINUTE)),
  }
}
