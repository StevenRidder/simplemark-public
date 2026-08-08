//! Runs the full summary path — extractor, then Apple's on-device model —
//! over real Markdown files, showing what each produces side by side.
//!
//! This is the honest comparison: for many documents the model returns the
//! author's own lead sentence, which the extractor already found for free.
//!
//! ```text
//! cargo run --manifest-path src-tauri/Cargo.toml --example summary_corpus -- ~/Notes/*.md
//! ```

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
fn main() {
    use simplemark_lib::foundation_models::FoundationModelsSummarizer;
    use simplemark_lib::note_summaries::{tidy_summary, Summarizer};
    use std::time::Instant;

    let summarizer = FoundationModelsSummarizer;
    println!("Apple Intelligence available: {}\n", summarizer.availability());

    for path in std::env::args().skip(1) {
        let Ok(bytes) = std::fs::read(&path) else { continue };
        let text = String::from_utf8_lossy(&bytes);
        let name = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();

        let extracted = simplemark_lib::note_preview::extract_preview(&text);
        let distilled = simplemark_lib::note_preview::distil_for_model(&text, 3_000);
        let started = Instant::now();
        let summarized = summarizer
            .summarize(&distilled)
            .as_deref()
            .and_then(tidy_summary);
        let elapsed = started.elapsed().as_millis();

        println!("── {}", name.chars().take(60).collect::<String>());
        println!("   extracted: {}", extracted.as_deref().unwrap_or("(none)"));
        println!("   apple     : {}  [{}ms]", summarized.as_deref().unwrap_or("(declined)"), elapsed);
    }
}

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
fn main() {
    println!("Foundation Models requires macOS on Apple silicon.");
}
