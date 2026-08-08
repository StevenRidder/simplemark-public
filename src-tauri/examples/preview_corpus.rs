//! Runs the note-list preview extractor over real Markdown files.
//!
//! Unit fixtures encode the shapes we already thought of. This exists for the
//! ones we did not: pointed at a folder of actual notes it found three defects
//! the fixtures missed — a link inside a list item read as prose, a sentence
//! cut at a semicolon inside a parenthetical, and `claim_next` mangled to
//! `claimnext` by emphasis stripping. Each is now a regression test.
//!
//! Usage:
//!
//! ```text
//! cargo run --manifest-path src-tauri/Cargo.toml --example preview_corpus -- ~/Notes/*.md
//! ```

fn main() {
    let paths: Vec<String> = std::env::args().skip(1).collect();
    if paths.is_empty() {
        eprintln!("usage: preview_corpus <file.md> [file.md ...]");
        std::process::exit(2);
    }

    for path in paths {
        let name = std::path::Path::new(&path)
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        let display: String = name.chars().take(44).collect();

        match std::fs::read(&path) {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                let preview = simplemark_lib::note_preview::extract_preview(&text);
                println!("{display:<46} → {}", preview.as_deref().unwrap_or("(no preview)"));
            }
            Err(error) => println!("{display:<46} ! {error}"),
        }
    }
}
