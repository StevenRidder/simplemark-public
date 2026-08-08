//! The Rust half of the Foundation Models bridge.
//!
//! Declarations and one safe wrapper. Every rule about *what* to summarize and
//! *when* lives in `note_summaries.rs`; this file only crosses the boundary.
//!
//! Present only when `build.rs` set `simplemark_intelligence`, which requires
//! Apple silicon macOS and a macOS 26 SDK. Everywhere else the crate compiles
//! `NoSummarizer` instead and the note list shows extracted previews.

use crate::note_summaries::Summarizer;

#[cfg(simplemark_intelligence)]
mod ffi {
    use std::os::raw::c_char;

    extern "C" {
        pub fn simplemark_intelligence_available() -> bool;
        pub fn simplemark_intelligence_summarize(input: *const c_char) -> *mut c_char;
        pub fn simplemark_intelligence_free(pointer: *mut c_char);
    }
}

/// Apple's on-device model, when this machine has one to offer.
pub struct FoundationModelsSummarizer;

impl Summarizer for FoundationModelsSummarizer {
    /// Asked every time rather than cached. Apple Intelligence can be switched
    /// off, or still be downloading, while the app is running.
    #[cfg(simplemark_intelligence)]
    fn availability(&self) -> bool {
        // Safe: no arguments, no allocation, and the Swift side cannot trap.
        unsafe { ffi::simplemark_intelligence_available() }
    }

    #[cfg(not(simplemark_intelligence))]
    fn availability(&self) -> bool {
        false
    }

    #[cfg(simplemark_intelligence)]
    fn summarize(&self, distilled: &str) -> Option<String> {
        use std::ffi::{CStr, CString};

        // A note containing an interior NUL is not a summarization failure
        // worth reporting — it is not Markdown anyone wrote.
        let input = CString::new(distilled).ok()?;

        // Safe: `input` outlives the call, the Swift side copies before
        // returning, and every failure path there returns null rather than
        // trapping. The returned pointer is freed below without exception.
        unsafe {
            let produced = ffi::simplemark_intelligence_summarize(input.as_ptr());
            if produced.is_null() {
                return None;
            }
            let summary = CStr::from_ptr(produced).to_str().ok().map(str::to_owned);
            ffi::simplemark_intelligence_free(produced);
            summary
        }
    }

    #[cfg(not(simplemark_intelligence))]
    fn summarize(&self, _distilled: &str) -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Must answer without trapping on every machine, including one with no
    /// Swift module linked at all.
    #[test]
    fn availability_is_answerable_anywhere() {
        let _ = FoundationModelsSummarizer.availability();
    }

    /// An unavailable model declines rather than failing. On a machine where
    /// it *is* available this returns a real summary, which is why the
    /// assertion is about not panicking rather than about the text.
    #[test]
    fn summarizing_never_panics() {
        let summarizer = FoundationModelsSummarizer;
        if !summarizer.availability() {
            assert_eq!(summarizer.summarize("Title: A\n\nSome prose."), None);
        } else {
            let _ = summarizer.summarize("Title: A\n\nSome prose about a topic.");
        }
    }
}
