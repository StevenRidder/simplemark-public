//! Durable summaries keyed by note content, and the queue that fills them.
//!
//! Nothing here knows what a language model is: the summarizer arrives as a
//! `Summarizer` implementation, so every path below is tested on Linux with no
//! model present. PR 2 supplies the Foundation Models implementation.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// Entries kept before the least-recently-seen are dropped.
///
/// Bounded because the quiescence rule mints a fresh digest per editing
/// session and never refers to the previous one again.
pub const MAX_ENTRIES: usize = 5_000;

const CACHE_VERSION: u32 = 1;

#[derive(Clone, Serialize, Deserialize)]
pub struct CachedSummary {
    summary: String,
    last_seen_ms: u64,
}

#[derive(Serialize, Deserialize)]
pub struct SummaryCache {
    version: u32,
    entries: HashMap<String, CachedSummary>,
}

impl Default for SummaryCache {
    fn default() -> Self {
        Self { version: CACHE_VERSION, entries: HashMap::new() }
    }
}

impl SummaryCache {
    /// A missing, unreadable, corrupt, or future-versioned cache is an empty
    /// cache. Summaries are derived data; refusing to start over them would
    /// trade a cosmetic subtitle for a broken app.
    pub fn load(path: &Path) -> Self {
        let Ok(bytes) = fs::read(path) else {
            return Self::default();
        };
        match serde_json::from_slice::<Self>(&bytes) {
            Ok(cache) if cache.version == CACHE_VERSION => cache,
            _ => Self::default(),
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let parent = path
            .parent()
            .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;

        let encoded = serde_json::to_vec_pretty(self)
            .map_err(|error| format!("Could not encode the summary cache: {error}"))?;

        // Same discipline as `FilePort.save`: a partially written file is
        // never observable at the real path.
        let temporary = path.with_extension("json.writing");
        fs::write(&temporary, &encoded)
            .map_err(|error| format!("Could not write {}: {error}", temporary.display()))?;
        fs::rename(&temporary, path)
            .map_err(|error| format!("Could not replace {}: {error}", path.display()))
    }

    pub fn get(&mut self, digest: &str, now_ms: u64) -> Option<String> {
        let entry = self.entries.get_mut(digest)?;
        entry.last_seen_ms = now_ms;
        Some(entry.summary.clone())
    }

    pub fn insert(&mut self, digest: &str, summary: &str, now_ms: u64) {
        self.entries.insert(
            digest.to_string(),
            CachedSummary { summary: summary.to_string(), last_seen_ms: now_ms },
        );
        self.evict_to_cap();
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    #[cfg(test)]
    fn last_seen(&self, digest: &str) -> Option<u64> {
        self.entries.get(digest).map(|entry| entry.last_seen_ms)
    }

    fn evict_to_cap(&mut self) {
        while self.entries.len() > MAX_ENTRIES {
            let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.last_seen_ms)
                .map(|(digest, _)| digest.clone())
            else {
                return;
            };
            self.entries.remove(&oldest);
        }
    }
}

/// How much of a note is sent for summarization.
///
/// The spike distilled a 33,736-character document to 867 and halved latency;
/// nothing measured needed more than 2,253 against a 4,096-token window.
const DISTIL_LIMIT: usize = 3_000;

/// Produces a one-line summary, or `None` when it cannot or will not.
///
/// PR 1 has only `NoSummarizer`. PR 2 supplies the Foundation Models
/// implementation behind the same trait, so nothing above this line changes.
pub trait Summarizer {
    /// Whether this summarizer can do anything at all right now. Apple
    /// requires a runtime availability check rather than a compile-time
    /// assumption, so this is a method and not a constant.
    fn availability(&self) -> bool;

    fn summarize(&self, distilled: &str) -> Option<String>;
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub handle: String,
    pub content_hash: String,
    pub summary: String,
}

pub struct SummaryQueue {
    cache: SummaryCache,
    /// Handles the viewport currently wants, active note first.
    wanted: Vec<String>,
    /// Digests already attempted and declined this session. Prevents a note
    /// the model refuses from being retried on every scroll.
    attempted: std::collections::HashSet<String>,
    /// Handles written recently, and when they were last written.
    pending_changes: HashMap<String, u64>,
    /// What was last emitted for each handle, so an unchanged note is not
    /// re-announced. A catalog refresh re-requests everything on screen, and
    /// without this each cached note fires an event that patches a DOM node to
    /// the value it already held.
    emitted: HashMap<String, String>,
}

/// How long a file must be still before it is re-summarized.
///
/// Saves and agent writes change the content digest and are therefore cache
/// misses. Chosen to sit well clear of an agent's write cadence, so an editing
/// session costs one model call rather than one per write.
pub const QUIESCENCE_MS: u64 = 30_000;

impl SummaryQueue {
    pub fn new(cache: SummaryCache) -> Self {
        Self {
            cache,
            wanted: Vec::new(),
            attempted: std::collections::HashSet::new(),
            pending_changes: HashMap::new(),
            emitted: HashMap::new(),
        }
    }

    /// Replaces the wanted set. A newer viewport supersedes an older one
    /// rather than queueing behind it.
    pub fn request(&mut self, handles: &[String]) {
        self.wanted = handles.to_vec();
    }

    /// Does at most one note's work. Returns the summary to emit, or `None`
    /// when there is nothing left to do.
    pub fn drain_next(
        &mut self,
        summarizer: &dyn Summarizer,
        now_ms: u64,
    ) -> Option<NoteSummary> {
        while !self.wanted.is_empty() {
            let handle = self.wanted.remove(0);
            let Ok(bytes) = fs::read(&handle) else {
                continue;
            };
            let digest = crate::note_preview::content_digest(&bytes);

            if let Some(summary) = self.cache.get(&digest, now_ms) {
                // Already announced with this exact content: nothing changed,
                // so say nothing rather than repeat ourselves.
                if self.emitted.get(&handle) == Some(&digest) {
                    continue;
                }
                self.emitted.insert(handle.clone(), digest.clone());
                return Some(NoteSummary { handle, content_hash: digest, summary });
            }
            if self.attempted.contains(&digest) {
                continue;
            }

            let text = String::from_utf8_lossy(&bytes);

            // A note with no prose has nothing to summarize. Spending a model
            // call to describe an empty file or a bare heading is waste.
            if crate::note_preview::extract_preview(&text).is_none() {
                continue;
            }

            let distilled = crate::note_preview::distil_for_model(&text, DISTIL_LIMIT);
            self.attempted.insert(digest.clone());

            match summarizer.summarize(&distilled).as_deref().and_then(tidy_summary) {
                Some(summary) => {
                    self.cache.insert(&digest, &summary, now_ms);
                    self.emitted.insert(handle.clone(), digest.clone());
                    return Some(NoteSummary { handle, content_hash: digest, summary });
                }
                // Declined, or output that did not survive hygiene: the row
                // keeps its extractor preview and nothing is written. A later
                // session retries; this one does not.
                None => continue,
            }
        }
        None
    }

    /// Records that a note changed on disk. Called for every watcher event;
    /// a burst simply moves the deadline.
    pub fn note_changed(&mut self, handle: &str, now_ms: u64) {
        self.pending_changes.insert(handle.to_string(), now_ms);
    }

    /// Handles whose writes have stopped long enough to be worth re-reading.
    /// Claiming them clears them: a note is due once per burst.
    pub fn quiesced(&mut self, now_ms: u64) -> Vec<String> {
        let due: Vec<String> = self
            .pending_changes
            .iter()
            .filter(|(_, last)| now_ms.saturating_sub(**last) > QUIESCENCE_MS)
            .map(|(handle, _)| handle.clone())
            .collect();
        for handle in &due {
            self.pending_changes.remove(handle);
        }
        due
    }

    pub fn cache(&self) -> &SummaryCache {
        &self.cache
    }

    #[cfg(test)]
    fn cache_len(&self) -> usize {
        self.cache.len()
    }
}

/// The hygiene gate. Strips leaked markup, collapses a multi-line reply to one
/// line, caps length, and rejects what is left if it is empty.
///
/// It makes no quality judgement. An earlier draft rejected short summaries,
/// questions, and lines that restated the title; those rejections were
/// overruled on review because several of the outputs they killed were judged
/// good. A gate that second-guesses accepted output only produces false
/// negatives.
pub fn tidy_summary(raw: &str) -> Option<String> {
    let collapsed = raw
        .chars()
        .map(|c| if c == '\n' || c == '\r' || c == '\t' { ' ' } else { c })
        .filter(|c| !matches!(c, '*' | '`' | '#' | '|' | '[' | ']'))
        .collect::<String>();

    let mut tidied = String::with_capacity(collapsed.len());
    let mut previous_was_space = false;
    for character in collapsed.chars() {
        if character == ' ' {
            if !previous_was_space && !tidied.is_empty() {
                tidied.push(' ');
            }
            previous_was_space = true;
        } else {
            tidied.push(character);
            previous_was_space = false;
        }
    }

    let tidied = tidied.trim();
    if tidied.is_empty() {
        return None;
    }
    Some(crate::note_preview::cap_for_row(tidied))
}

/// The summarizer PR 1 shipped everywhere and PR 2 still ships on any machine
/// without Apple silicon: it declines.
///
/// Not a placeholder to delete. It is the live path for the browser shell,
/// every Intel Mac, every Mac on macOS 25 or earlier, and every Linux and
/// Windows build.
pub struct NoSummarizer;

impl Summarizer for NoSummarizer {
    fn availability(&self) -> bool {
        false
    }

    fn summarize(&self, _distilled: &str) -> Option<String> {
        None
    }
}

/// Whichever summarizer this build actually has.
pub fn active_summarizer() -> Box<dyn Summarizer + Send + Sync> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        Box::new(crate::foundation_models::FoundationModelsSummarizer)
    }
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    {
        Box::new(NoSummarizer)
    }
}

/// Managed state: the queue, the cache path, and whether a worker is draining.
pub struct SummaryState {
    queue: std::sync::Mutex<SummaryQueue>,
    cache_path: std::path::PathBuf,
    draining: std::sync::atomic::AtomicBool,
}

impl SummaryState {
    pub fn new(cache_path: std::path::PathBuf) -> Self {
        Self {
            queue: std::sync::Mutex::new(SummaryQueue::new(SummaryCache::load(&cache_path))),
            cache_path,
            draining: std::sync::atomic::AtomicBool::new(false),
        }
    }
}

/// Whether this build can produce summaries at all.
///
/// `false` means the webview never asks, so no work is queued and the note
/// list shows extracted previews only. Asked at runtime because Apple
/// Intelligence can be off, still downloading, or unsupported.
#[tauri::command]
pub fn note_summaries_available() -> bool {
    active_summarizer().availability()
}

/// Records what the viewport wants and starts a worker if one is not running.
///
/// Returns immediately. A summary costs 1.4–1.9s on-device, so doing this work
/// on the IPC thread would stall every other command behind it; results arrive
/// on the `note-summary` event instead.
#[tauri::command]
pub fn request_note_summaries(
    app: tauri::AppHandle,
    state: tauri::State<'_, SummaryState>,
    handles: Vec<String>,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;

    {
        let Ok(mut queue) = state.queue.lock() else {
            return Ok(());
        };
        // Notes whose writes have stopped are wanted again, behind whatever
        // the viewport asked for — the visible rows still come first.
        let settled = queue.quiesced(now_ms());
        let mut wanted = handles;
        wanted.extend(settled);
        queue.request(&wanted);
    }

    // One worker at a time. A scroll burst updates the wanted set that the
    // running worker is already reading, rather than starting a second one.
    if state.draining.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    std::thread::spawn(move || {
        let summarizer = active_summarizer();
        loop {
            let produced = {
                let state = tauri::Manager::state::<SummaryState>(&app);
                let Ok(mut queue) = state.queue.lock() else { break };
                queue.drain_next(summarizer.as_ref(), now_ms())
            };
            match produced {
                Some(summary) => {
                    let _ = tauri::Emitter::emit(&app, "note-summary", summary);
                }
                None => break,
            }
        }

        let state = tauri::Manager::state::<SummaryState>(&app);
        if let Ok(queue) = state.queue.lock() {
            let _ = queue.cache().save(&state.cache_path);
        }
        state.draining.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// Records an external write so the quiescence timer can start.
///
/// Called for every watcher event, which during agent activity means many per
/// second. It only stamps a time; no reading and no model work happens here.
pub fn note_changed_externally(state: &SummaryState, handle: &str) {
    if let Ok(mut queue) = state.queue.lock() {
        queue.note_changed(handle, now_ms());
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Where the cache lives, under the identifier in `tauri.conf.json`.
pub fn cache_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    tauri::Manager::path(app)
        .app_data_dir()
        .map(|directory| directory.join("note-summaries.json"))
        .map_err(|error| format!("Could not resolve the application data directory: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_through_disk() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note-summaries.json");

        let mut cache = SummaryCache::load(&path);
        cache.insert("abc", "Defers the gateway until June.", 1_000);
        cache.save(&path).unwrap();

        let mut reloaded = SummaryCache::load(&path);
        assert_eq!(
            reloaded.get("abc", 2_000).as_deref(),
            Some("Defers the gateway until June.")
        );
    }

    /// A missing or corrupt cache is an empty cache, never a startup failure.
    #[test]
    fn a_missing_or_unreadable_cache_starts_empty() {
        let directory = tempfile::tempdir().unwrap();
        let absent = directory.path().join("nothing.json");
        assert_eq!(SummaryCache::load(&absent).len(), 0);

        let corrupt = directory.path().join("corrupt.json");
        fs::write(&corrupt, b"{ not json").unwrap();
        assert_eq!(SummaryCache::load(&corrupt).len(), 0);
    }

    #[test]
    fn a_hit_touches_last_seen() {
        let mut cache = SummaryCache::default();
        cache.insert("abc", "one", 1_000);
        assert!(cache.get("abc", 9_000).is_some());
        assert_eq!(cache.last_seen("abc"), Some(9_000));
    }

    /// Every editing session mints a new digest and abandons the previous one,
    /// so without eviction this file grows for the life of the install.
    #[test]
    fn evicts_the_least_recently_seen_past_the_cap() {
        let mut cache = SummaryCache::default();
        for index in 0..MAX_ENTRIES {
            cache.insert(&format!("key{index}"), "summary", index as u64);
        }
        assert_eq!(cache.len(), MAX_ENTRIES);

        cache.insert("newest", "summary", 9_999_999);

        assert_eq!(cache.len(), MAX_ENTRIES);
        assert!(cache.get("newest", 9_999_999).is_some());
        assert!(cache.get("key0", 9_999_999).is_none(), "oldest must be evicted");
    }

    struct StubSummarizer {
        reply: Option<String>,
    }

    impl Summarizer for StubSummarizer {
        fn availability(&self) -> bool {
            self.reply.is_some()
        }

        fn summarize(&self, _distilled: &str) -> Option<String> {
            self.reply.clone()
        }
    }

    fn note_at(directory: &Path, name: &str, body: &str) -> String {
        let path = directory.join(name);
        fs::write(&path, body.as_bytes()).unwrap();
        path.display().to_string()
    }

    #[test]
    fn summarizes_the_first_wanted_note_and_caches_it() {
        let directory = tempfile::tempdir().unwrap();
        let handle = note_at(directory.path(), "a.md", "# A\n\nThe first real sentence of this note is here.\n");
        let summarizer = StubSummarizer { reply: Some("Stub summary".into()) };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[handle.clone()]);

        let produced = queue.drain_next(&summarizer, 1_000).expect("a summary");
        assert_eq!(produced.handle, handle);
        assert_eq!(produced.summary, "Stub summary");

        assert!(queue.drain_next(&summarizer, 2_000).is_none());
        assert_eq!(queue.cache_len(), 1);
    }

    /// The first handle is the active note. It must be served before the rows
    /// that merely happen to be on screen.
    #[test]
    fn serves_the_active_note_first() {
        let directory = tempfile::tempdir().unwrap();
        let active = note_at(directory.path(), "active.md", "# A\n\nThe active note carries several words of real prose.\n");
        let other = note_at(directory.path(), "other.md", "# B\n\nThe other note also carries real prose here.\n");
        let summarizer = StubSummarizer { reply: Some("Stub".into()) };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[active.clone(), other]);

        assert_eq!(queue.drain_next(&summarizer, 1_000).unwrap().handle, active);
    }

    /// Scrolling replaces the wanted set. Work queued for rows that have
    /// scrolled away must not be done.
    #[test]
    fn a_newer_request_supersedes_an_older_one() {
        let directory = tempfile::tempdir().unwrap();
        let gone = note_at(directory.path(), "gone.md", "# A\n\nThis row has already scrolled out of view.\n");
        let shown = note_at(directory.path(), "shown.md", "# B\n\nThis row is on screen right now.\n");
        let summarizer = StubSummarizer { reply: Some("Stub".into()) };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[gone]);
        queue.request(&[shown.clone()]);

        assert_eq!(queue.drain_next(&summarizer, 1_000).unwrap().handle, shown);
        assert!(queue.drain_next(&summarizer, 2_000).is_none());
    }

    /// A declined note keeps its extractor preview, is not cached, and is not
    /// retried in a loop within the session.
    #[test]
    fn a_declined_note_is_not_cached_and_not_retried() {
        let directory = tempfile::tempdir().unwrap();
        let handle = note_at(directory.path(), "a.md", "# A\n\nThe first real sentence of this note is here.\n");
        let declining = StubSummarizer { reply: None };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[handle.clone()]);

        assert!(queue.drain_next(&declining, 1_000).is_none());
        assert_eq!(queue.cache_len(), 0);

        queue.request(&[handle]);
        assert!(queue.drain_next(&declining, 2_000).is_none());
    }

    /// An empty or heading-only note has nothing to summarize. Queueing it
    /// would spend a model call to describe nothing.
    #[test]
    fn a_note_with_no_prose_is_never_queued() {
        let directory = tempfile::tempdir().unwrap();
        let empty = note_at(directory.path(), "empty.md", "");
        let heading = note_at(directory.path(), "heading.md", "# Just A Heading\n");
        let summarizer = StubSummarizer { reply: Some("Stub".into()) };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[empty, heading]);

        assert!(queue.drain_next(&summarizer, 1_000).is_none());
        assert_eq!(queue.cache_len(), 0);
    }

    /// Hygiene only. Leaked markup is stripped and nothing is rejected for
    /// being short, blunt, or a title restatement — those judgements were
    /// overruled on review after several such outputs were judged good.
    #[test]
    fn the_gate_strips_markup_and_keeps_terse_output() {
        assert_eq!(
            tidy_summary("Uses `GitHub`'s **native** merge queue").as_deref(),
            Some("Uses GitHub's native merge queue")
        );
        assert_eq!(
            tidy_summary("Project Maxwell kickoff call").as_deref(),
            Some("Project Maxwell kickoff call")
        );
        assert_eq!(
            tidy_summary("OpenAI's Free Tier Update").as_deref(),
            Some("OpenAI's Free Tier Update")
        );
    }

    #[test]
    fn the_gate_rejects_empty_output_and_caps_length() {
        assert_eq!(tidy_summary(""), None);
        assert_eq!(tidy_summary("   \n  "), None);
        assert_eq!(tidy_summary("**``**"), None);

        let long = "alpha ".repeat(80);
        let tidied = tidy_summary(&long).expect("kept");
        assert!(tidied.chars().count() <= crate::note_preview::PREVIEW_LIMIT);
    }

    /// A summary is one line. A model that returns several must not blow the
    /// row's layout open.
    #[test]
    fn the_gate_collapses_newlines() {
        assert_eq!(
            tidy_summary("First line.\nSecond line.").as_deref(),
            Some("First line. Second line.")
        );
    }

    /// Editing a note changes its digest, so the cached summary no longer
    /// applies and the note becomes wanted again.
    #[test]
    fn edited_content_misses_the_cache() {
        let directory = tempfile::tempdir().unwrap();
        let handle = note_at(directory.path(), "a.md", "# A\n\nThe original sentence of this note is here.\n");
        let summarizer = StubSummarizer { reply: Some("Stub".into()) };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[handle.clone()]);
        assert!(queue.drain_next(&summarizer, 1_000).is_some());

        fs::write(&handle, b"# A\n\nA completely rewritten sentence for this note.\n").unwrap();
        queue.request(&[handle]);
        assert!(queue.drain_next(&summarizer, 2_000).is_some());
        assert_eq!(queue.cache_len(), 2);
    }

    /// A catalog refresh re-requests every visible note, and that happens on
    /// every note switch. Re-announcing an unchanged summary costs an event
    /// and a DOM write to set a value that is already there.
    #[test]
    fn an_unchanged_note_is_announced_once() {
        let directory = tempfile::tempdir().unwrap();
        let handle = note_at(directory.path(), "a.md", "# A\n\nThe first real sentence of this note is here.\n");
        let summarizer = StubSummarizer { reply: Some("Stub".into()) };

        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.request(&[handle.clone()]);
        assert!(queue.drain_next(&summarizer, 1_000).is_some());

        // Same bytes, asked again: cached, and already said.
        queue.request(&[handle.clone()]);
        assert!(queue.drain_next(&summarizer, 2_000).is_none());

        // Different bytes: worth saying again.
        fs::write(&handle, b"# A\n\nA completely rewritten sentence for this note.\n").unwrap();
        queue.request(&[handle]);
        assert!(queue.drain_next(&summarizer, 3_000).is_some());
    }

    /// An agent rewriting a file fires the watcher constantly. One model call
    /// per write would mean one every few seconds, indefinitely.
    #[test]
    fn a_burst_of_writes_yields_one_re_summary() {
        let mut queue = SummaryQueue::new(SummaryCache::default());
        for tick in 0..20 {
            queue.note_changed("a.md", 1_000 + tick * 500);
        }
        // Still being written: nothing is due yet.
        assert!(queue.quiesced(1_000 + 20 * 500).is_empty());

        let settled = 1_000 + 19 * 500 + QUIESCENCE_MS + 1;
        assert_eq!(queue.quiesced(settled), vec!["a.md".to_string()]);
    }

    /// Once claimed, a note is not due again until it changes again.
    #[test]
    fn a_quiesced_note_is_reported_once() {
        let mut queue = SummaryQueue::new(SummaryCache::default());
        queue.note_changed("a.md", 1_000);
        let settled = 1_000 + QUIESCENCE_MS + 1;
        assert_eq!(queue.quiesced(settled).len(), 1);
        assert!(queue.quiesced(settled + 10_000).is_empty());
    }

    /// A partially written cache must never be observable, for the same reason
    /// `FilePort.save` writes atomically.
    #[test]
    fn writes_atomically_leaving_no_temp_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("note-summaries.json");

        let mut cache = SummaryCache::default();
        cache.insert("abc", "one", 1_000);
        cache.save(&path).unwrap();

        let leftovers: Vec<_> = fs::read_dir(directory.path())
            .unwrap()
            .filter_map(|entry| entry.ok())
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .filter(|name| name != "note-summaries.json")
            .collect();
        assert!(leftovers.is_empty(), "left behind {leftovers:?}");
    }
}
