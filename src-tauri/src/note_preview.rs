//! Deriving a stable identity and a one-line preview from a note's bytes.
//!
//! Pure: no Tauri, no filesystem, no async. Everything here is unit-tested on
//! every platform, which is why the model-facing work in `note_summaries.rs`
//! is kept out of it.

use sha2::{Digest, Sha256};

/// Stable, cross-process identity for a note's exact bytes.
///
/// Lowercase hex so it can be a JSON object key and read in a diff.
pub fn content_digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// Longest subtitle we will show.
///
/// The row wraps rather than clipping, so this is a runaway guard rather than
/// a layout constraint — a two-sentence summary is capped at 30 words by the
/// prompt and measured at most 181 characters, so it is never reached in
/// practice. It exists so a pathological note cannot push one row down the
/// whole list.
pub const PREVIEW_LIMIT: usize = 280;

/// A bold run shorter than this is emphasis or a label, not a lead sentence.
const LEAD_MIN_WORDS: usize = 5;

/// Prose needs enough words to be a sentence rather than a stray fragment.
const PROSE_MIN_WORDS: usize = 6;

/// Bold labels that introduce the real lead rather than being it.
const LEAD_LABELS: &[&str] = &["one-liner", "headline", "bottom line", "tl;dr", "summary"];

/// Document metadata that reads like prose to a naive scanner. Every one of
/// these produced a wrong preview before it was excluded.
const METADATA_KEYS: &[&str] = &[
    "to", "from", "date", "tone", "type", "product", "source", "status",
    "duration", "transcription", "note", "participants", "author", "updated",
];

/// The author's own lead sentence, or `None` if the note has no prose.
pub fn extract_preview(text: &str) -> Option<String> {
    let mut in_fence = false;
    for raw in strip_frontmatter(text).lines() {
        let line = raw.trim();
        if line.starts_with("```") || line.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence || line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.chars().all(|c| matches!(c, '-' | '=' | '*' | ' ')) {
            continue;
        }
        // The list marker comes off *before* the structural test, not after.
        // Checking the raw line let `- [docs/flow.html](…)` through as prose,
        // because the bracket was no longer at position zero once the marker
        // was gone.
        let content = line.trim_start_matches(['-', '*', '+', ' ']).trim();
        // Tables, quotes, images, raw HTML, reference links and horizontal
        // rules are structure. None of them is a sentence about the note.
        if content.starts_with(['|', '>', '!', '<', '[']) {
            continue;
        }
        if content.is_empty() || is_metadata(content) {
            continue;
        }
        if let Some(lead) = bold_lead(content) {
            return Some(cap_for_row(&lead));
        }
        if content.split_whitespace().count() >= PROSE_MIN_WORDS {
            return Some(cap_for_row(&first_sentence(&strip_inline_markup(content))));
        }
    }
    None
}

fn strip_frontmatter(text: &str) -> &str {
    let Some(rest) = text.strip_prefix("---\n") else {
        return text;
    };
    match rest.find("\n---") {
        Some(end) => rest[end + 4..].trim_start_matches('\n'),
        None => text,
    }
}

/// `**Key:** value` and `Key: value` are metadata, whatever they contain.
fn is_metadata(content: &str) -> bool {
    let bare = content.trim_start_matches('*').trim();
    let Some((key, _)) = bare.split_once(':') else {
        return false;
    };
    let key = key.trim_end_matches('*').trim().to_lowercase();
    METADATA_KEYS.contains(&key.as_str())
}

/// A bold opener used as the document's lead sentence, unwrapping a label
/// such as `**One-liner:**` when one introduces it.
fn bold_lead(content: &str) -> Option<String> {
    let rest = content.strip_prefix("**")?;
    let close = rest.find("**")?;
    let head = rest[..close].trim().trim_end_matches(':').trim();
    let tail = rest[close + 2..].trim_start_matches([':', '.', ' ']).trim();

    if LEAD_LABELS.contains(&head.to_lowercase().as_str()) {
        if tail.is_empty() {
            return None;
        }
        return Some(first_sentence(&strip_inline_markup(tail)));
    }
    if head.split_whitespace().count() >= LEAD_MIN_WORDS {
        return Some(strip_inline_markup(head));
    }
    None
}

/// Removes emphasis characters and reduces `[text](url)` to `text` — a link's
/// visible text is what a reader sees, so it is what the preview carries.
///
/// An underscore only counts as emphasis at a word boundary. Removing every
/// one turned `claim_next` into `claimnext`, which matters in a reader built
/// for technical Markdown: identifiers are the substance, not decoration.
fn strip_inline_markup(text: &str) -> String {
    let unlinked = render_links(text);
    let characters: Vec<char> = unlinked.chars().collect();
    let mut out = String::with_capacity(unlinked.len());
    for (index, character) in characters.iter().enumerate() {
        match character {
            '*' | '`' => continue,
            '_' => {
                let before_is_word = index
                    .checked_sub(1)
                    .and_then(|previous| characters.get(previous))
                    .is_some_and(|c| c.is_alphanumeric());
                let after_is_word =
                    characters.get(index + 1).is_some_and(|c| c.is_alphanumeric());
                // Intra-word: part of an identifier, so keep it.
                if before_is_word && after_is_word {
                    out.push('_');
                }
            }
            other => out.push(*other),
        }
    }
    out
}

fn render_links(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('[') {
        let Some(close) = rest[open..].find("](") else { break };
        let Some(end) = rest[open + close..].find(')') else { break };
        out.push_str(&rest[..open]);
        out.push_str(&rest[open + 1..open + close]);
        rest = &rest[open + close + end + 1..];
    }
    out.push_str(rest);
    out
}

/// A semicolon is deliberately not a terminator here: real notes use it inside
/// parentheticals, and treating it as one cut a sentence mid-bracket.
fn first_sentence(text: &str) -> String {
    let bytes = text.as_bytes();
    for (index, window) in bytes.windows(2).enumerate() {
        if matches!(window[0], b'.' | b'!' | b'?') && window[1] == b' ' {
            return text[..=index].trim().to_string();
        }
    }
    text.trim().to_string()
}

/// Truncate on a word boundary so a preview never ends mid-word.
pub fn cap_for_row(text: &str) -> String {
    if text.chars().count() <= PREVIEW_LIMIT {
        return text.to_string();
    }
    let clipped: String = text.chars().take(PREVIEW_LIMIT - 1).collect();
    let cut = clipped.rfind(' ').unwrap_or(clipped.len());
    format!("{}…", clipped[..cut].trim_end())
}

/// Reduces a document to the parts that carry meaning, for the model.
///
/// This is the largest measured win in the whole feature and it needs no
/// model at all: it took a 33,736-character document to 867 and halved
/// latency, and it makes the 4,096-token context window a non-issue rather
/// than a constraint to design around.
///
/// Samples *each* section rather than the opening alone. Sending raw leading
/// characters instead produced visibly worse summaries — a call transcript
/// came back as "the document discusses naming a project", because the first
/// three thousand characters were the header and the opening pleasantries.
pub fn distil_for_model(text: &str, budget: usize) -> String {
    let mut title = String::new();
    let mut sections: Vec<(String, Vec<String>)> = vec![(String::new(), Vec::new())];
    let mut in_fence = false;

    for raw in strip_frontmatter(text).lines() {
        let line = raw.trim();
        if line.starts_with("```") || line.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }
        if let Some(heading) = line.strip_prefix("# ") {
            if title.is_empty() {
                title = heading.trim().to_string();
            }
            continue;
        }
        if line.starts_with("## ") || line.starts_with("### ") {
            let heading = line.trim_start_matches('#').trim().to_string();
            sections.push((heading, Vec::new()));
            continue;
        }
        if line.is_empty() || line.starts_with(['|', '>', '!', '<']) {
            continue;
        }
        if line.chars().all(|c| matches!(c, '-' | '=' | '*' | ' ')) {
            continue;
        }
        let content = line.trim_start_matches(['-', '*', '+', ' ']).trim();
        if content.is_empty() {
            continue;
        }
        // Two prose lines per section is enough to carry that section's claim
        // without letting one long section crowd out the rest.
        if let Some(last) = sections.last_mut() {
            if last.1.len() < 2 {
                last.1.push(strip_inline_markup(content));
            }
        }
    }

    let mut out = format!(
        "Title: {}\n\nDocument:",
        if title.is_empty() { "(untitled)" } else { title.as_str() }
    );
    for (heading, prose) in sections.iter().take(10) {
        if prose.is_empty() {
            continue;
        }
        if !heading.is_empty() {
            out.push_str(&format!("\n[{heading}]\n"));
        } else {
            out.push('\n');
        }
        out.push_str(&prose.join("\n"));
        out.push('\n');
    }

    if out.chars().count() > budget {
        out = out.chars().take(budget).collect();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distillation_keeps_the_title_and_samples_every_section() {
        let note = "# Call Transcript\n\n**Date:** 2026-06-14\n\n## Naming\n\nSteve proposes calling it Maxwell.\n\n## Scope\n\nThe agent triages methane emissions for the operator.\n";
        let distilled = distil_for_model(note, 3_000);

        assert!(distilled.starts_with("Title: Call Transcript"));
        assert!(distilled.contains("[Naming]"));
        // The section the model actually needs is the one raw truncation
        // would have cut: it sits past the header and the opening exchange.
        assert!(distilled.contains("triages methane emissions"));
    }

    #[test]
    fn distillation_shrinks_a_long_document() {
        let mut note = String::from("# Huge\n\nOpening sentence here.\n");
        for index in 0..400 {
            note.push_str(&format!("\n## Section {index}\n\nProse for section {index}.\n"));
        }
        let distilled = distil_for_model(&note, 3_000);

        assert!(distilled.chars().count() <= 3_000);
        assert!(distilled.len() < note.len() / 4, "expected real reduction");
    }

    #[test]
    fn distillation_survives_a_document_with_no_headings() {
        let note = "Just a paragraph with no heading at all in it.\n";
        let distilled = distil_for_model(note, 3_000);

        assert!(distilled.starts_with("Title: (untitled)"));
        assert!(distilled.contains("Just a paragraph"));
    }

    /// The property `DefaultHasher` does not offer. `content_hash` in `lib.rs`
    /// serves the write ledger and is correct there; a cache that outlives the
    /// process needs a digest whose value is fixed by the algorithm.
    #[test]
    fn digest_is_the_published_sha256_of_the_bytes() {
        assert_eq!(
            content_digest(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn digest_of_empty_input_is_defined() {
        assert_eq!(
            content_digest(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn one_changed_byte_changes_the_digest() {
        assert_ne!(content_digest(b"note\n"), content_digest(b"note\r\n"));
    }

    /// A README whose lead is a bold tagline. The extractor must take the
    /// tagline, not the H1 and not the paragraph beneath it.
    #[test]
    fn takes_a_bold_lead_sentence() {
        let note = "# SimpleMark\n\n**The beautiful living document for AI work.**\n\nYour agent writes the Markdown.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("The beautiful living document for AI work.")
        );
    }

    /// A briefing with a labelled headline. The label is scaffolding; the
    /// sentence after it is the preview.
    #[test]
    fn unwraps_a_labelled_lead() {
        let note = "# Status Briefing\n\n## Headline\n\n**Total's FMP asset sync is live in production.** Pads sync cleanly.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("Total's FMP asset sync is live in production.")
        );
    }

    /// The failure that broke the first attempt: a document whose first lines
    /// are all `Key: value` metadata. Those are not prose.
    #[test]
    fn skips_metadata_lines_before_prose() {
        let note = "# Call Transcript\n\n**Date:** 2026-06-14\n**Duration:** 25 min\n**Source:** recording.m4a\n\nThe team agreed to defer the gateway until June.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("The team agreed to defer the gateway until June.")
        );
    }

    #[test]
    fn skips_frontmatter_fences_tables_and_quotes() {
        let note = "---\ntitle: x\n---\n\n# Heading\n\n```rust\nfn main() {}\n```\n\n| a | b |\n\n> quoted\n\nThe first real sentence lives here. A second one follows.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("The first real sentence lives here.")
        );
    }

    #[test]
    fn strips_inline_markup_from_prose() {
        let note = "# Doc\n\nThe `budget` is **fixed** at _four_ thousand tokens for now.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("The budget is fixed at four thousand tokens for now.")
        );
    }

    /// A short bold run is a label or emphasis, not a lead sentence. Falling
    /// through to prose is what keeps `**Note:**` out of the subtitle.
    #[test]
    fn ignores_a_short_bold_run() {
        let note = "# Doc\n\n**Warning** applies to every one of the cases listed below.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("Warning applies to every one of the cases listed below.")
        );
    }

    #[test]
    fn caps_a_long_sentence_on_a_word_boundary() {
        let note = format!("# Doc\n\n{}\n", "alpha ".repeat(60));
        let preview = extract_preview(&note).expect("prose");
        assert!(preview.chars().count() <= PREVIEW_LIMIT, "got {} chars", preview.chars().count());
        assert!(preview.ends_with('…'));
        assert!(!preview.contains("alph…"), "must cut between words");
    }

    /// Found by running the extractor over real notes rather than fixtures.
    /// A link inside a list item slipped through as prose, because the list
    /// marker was stripped before the structural check ran.
    #[test]
    fn skips_a_link_inside_a_list_item() {
        let note = "# Index\n\n- [docs/ui/flow.html](ui/flow.html) — the lifecycle wireframe\n\nThe document explains each stage in order.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("The document explains each stage in order.")
        );
    }

    /// Also found on real notes: a semicolon inside a parenthetical cut the
    /// sentence mid-bracket. A semicolon does not end a sentence.
    #[test]
    fn does_not_break_a_sentence_at_a_semicolon() {
        let note = "# Call\n\nSteve leads Taikun (building the agent; dialing in from Fiji) this week.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("Steve leads Taikun (building the agent; dialing in from Fiji) this week.")
        );
    }

    /// A link's text is what a reader sees, so it is what a preview should
    /// carry — never the URL.
    #[test]
    fn renders_a_link_as_its_text() {
        let note = "# Doc\n\nThe [release contract](docs/RELEASE.md) governs every published build.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("The release contract governs every published build.")
        );
    }

    /// Found on a real note: `claim_next` became `claimnext`. Emphasis
    /// underscores go; the ones holding an identifier together stay.
    #[test]
    fn keeps_underscores_inside_identifiers() {
        let note = "# Doc\n\nSwitchboard owns the floor: intake, plan, then `claim_next` dispatch.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("Switchboard owns the floor: intake, plan, then claim_next dispatch.")
        );
    }

    #[test]
    fn still_strips_underscore_emphasis() {
        let note = "# Doc\n\nThe budget is _fixed_ at four thousand tokens for every request.\n";
        assert_eq!(
            extract_preview(note).as_deref(),
            Some("The budget is fixed at four thousand tokens for every request.")
        );
    }

    #[test]
    fn returns_none_when_there_is_no_prose() {
        assert_eq!(extract_preview("# Only A Heading\n\n- a\n"), None);
        assert_eq!(extract_preview(""), None);
    }
}
