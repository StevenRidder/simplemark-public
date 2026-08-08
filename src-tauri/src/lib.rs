//! The operating-system bridge for SimpleMark (APP-2).
//!
//! This crate is a thin transport, exactly like the MCP adapter: it opens a
//! file, writes bytes atomically, and reports when the file changed underneath
//! us. It holds no document model, no editor state, and no Markdown knowledge —
//! every document rule lives in the shared TypeScript modules that both shells
//! load (ADR-0001).
//!
//! Two rules shape everything here:
//!
//! * **Bytes, not strings.** The D7 fidelity contract is defined in bytes, so
//!   the boundary carries base64 rather than a decoded `String`. A lone CR, an
//!   invalid UTF-8 sequence, or a missing final newline survives the round trip.
//! * **Coarse commands.** `open_note` and `save_note` are whole-document
//!   operations called on the same debounce the browser shell uses. There is
//!   deliberately no per-keystroke IPC.

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, VecDeque};
use std::fs::{self, File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
// Subprocesses, filesystem watching, and the timing they need are all desktop
// capabilities: iOS forbids spawning processes and offers no `notify` backend.
#[cfg(desktop)]
use std::process::Command;
use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};
#[cfg(desktop)]
use std::sync::mpsc::RecvTimeoutError;
use std::sync::{Arc, Mutex};
// Not desktop-only: the watcher was its first user, but the AI request timeout
// needs it on every platform. Gating it broke the iOS build the moment that
// timeout landed.
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
#[cfg(desktop)]
use notify::{Event, EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, Url};
use tauri_plugin_dialog::DialogExt;

// Its two commands are registered on every platform so the shell can ask and be
// told no, but everything behind them is AppKit. On iOS that leaves the helpers
// unreferenced rather than wrong.
#[cfg_attr(mobile, allow(dead_code))]
mod app_icons;
#[cfg(target_os = "macos")]
mod macos_context_menu;
#[cfg(target_os = "macos")]
mod macos_note_navigation;
#[cfg(target_os = "macos")]
mod macos_traffic_lights;
#[cfg(target_os = "macos")]
mod macos_zoom;

pub mod note_images;
pub mod note_preview;
pub mod note_summaries;

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub mod foundation_models;

#[cfg(target_os = "macos")]
use objc2::{sel, MainThreadMarker};
#[cfg(target_os = "macos")]
use objc2_app_kit::NSApplication;
#[cfg(target_os = "macos")]
use tauri::RunEvent;

/// Which commit produced this bundle, captured at compile time by `build.rs`.
///
/// Reported, never interpreted. The shell decides how to say it; this only
/// carries what the build knew. `sha` is `unknown` when the build had no git
/// metadata to read, which the shell must show as-is rather than hide.
#[derive(Serialize)]
pub struct BuildProvenance {
    sha: String,
    short_sha: String,
    built_at: String,
    /// `owner/name` this build came from, or `unknown`. Read from the build's
    /// own remote so no source file names the private canonical repository.
    repository: String,
    /// Native capabilities compiled into *this* binary.
    ///
    /// A capability can be absent for honest reasons — wrong architecture, an
    /// SDK without the framework, a platform Apple does not serve — and a
    /// green build proves nothing about which. Reporting it lets an installed
    /// bundle be asked rather than inferred: grepping a `.app` answers only
    /// for things that survive as symbols or shell config, and gives false
    /// negatives for everything else.
    capabilities: Vec<String>,
}

/// The commit and time this binary was built from.
#[tauri::command]
fn build_provenance() -> BuildProvenance {
    let sha = env!("SIMPLEMARK_BUILD_SHA").to_string();
    BuildProvenance {
        short_sha: short_sha(&sha),
        sha,
        built_at: env!("SIMPLEMARK_BUILD_TIME").to_string(),
        repository: env!("SIMPLEMARK_BUILD_REPOSITORY").to_string(),
        capabilities: native_capabilities(),
    }
}

/// What this binary can actually do, as opposed to what the source allows.
fn native_capabilities() -> Vec<String> {
    let mut capabilities = Vec::new();
    if cfg!(simplemark_intelligence) {
        capabilities.push("note-summaries".to_string());
    }
    capabilities
}

/// One message in an OpenAI-compatible chat-completion request.
#[derive(serde::Serialize, serde::Deserialize)]
struct ChatMessage {
    role: String,
    content: String,
}

fn chat_completion_url(base_url: &str) -> String {
    format!("{}/chat/completions", base_url.trim_end_matches('/'))
}

fn chat_completion_body(model: &str, messages: &[ChatMessage]) -> serde_json::Value {
    serde_json::json!({ "model": model, "messages": messages })
}

/// One shared, timed-out `reqwest::Client` for the Fix-it network call.
///
/// A `Client` is meant to be pooled and reused rather than built per request,
/// and a fixed timeout means a wedged endpoint fails instead of leaving the
/// frontend's `await` — and the Fix it button, stuck on "Fixing… (N/3)" —
/// hanging forever.
fn http_client() -> &'static reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .unwrap_or_default()
    })
}

/// The diagram-error "Fix it" button's one network call (EDITOR error-recovery).
///
/// This crate is a thin transport everywhere else (module doc, top of this
/// file) and stays one here too: it knows the OpenAI request/response
/// envelope only as far as building the URL and the `{model, messages}` body,
/// and returns the response text unparsed. Everything else — the prompt, the
/// retry loop, extracting the fixed source from the response — lives in the
/// shared TypeScript adapter that also drives the browser dev shell's direct
/// `fetch`, so the two platforms cannot drift.
///
/// Going through Rust is not optional: the packaged app's CSP
/// (`connect-src 'self' ipc: http://ipc.localhost`, tauri.conf.json) silently
/// blocks a frontend `fetch` to any external host.
#[tauri::command]
async fn ai_chat_completion(
    base_url: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<String, String> {
    let client = http_client();
    let url = chat_completion_url(&base_url);
    let body = chat_completion_body(&model, &messages);
    let response = client
        .post(&url)
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Could not reach {url}: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the response from {url}: {error}"))?;
    if !status.is_success() {
        return Err(format!("{url} returned {status}: {text}"));
    }
    Ok(text)
}

fn models_url(base_url: &str) -> String {
    format!("{}/models", base_url.trim_end_matches('/'))
}

/// The Settings panel's "Load models" button — same thin-transport contract
/// as `ai_chat_completion`: this returns the response text unparsed. Which
/// ids are chat-capable, and sorting them, is a TypeScript concern
/// (`parseModelList` in `openai-compatible-diagram-fix.ts`).
#[tauri::command]
async fn ai_list_models(base_url: String, api_key: String) -> Result<String, String> {
    let client = http_client();
    let url = models_url(&base_url);
    let response = client
        .get(&url)
        .bearer_auth(&api_key)
        .send()
        .await
        .map_err(|error| format!("Could not reach {url}: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Could not read the response from {url}: {error}"))?;
    if !status.is_success() {
        return Err(format!("{url} returned {status}: {text}"));
    }
    Ok(text)
}

/// Seven characters, git's own abbreviation, except for the honest non-SHA
/// values — truncating `unknown` to `unknow` would read like a real commit.
fn short_sha(sha: &str) -> String {
    if sha.len() >= 40 && sha.chars().all(|c| c.is_ascii_hexdigit()) {
        sha[..7].to_string()
    } else {
        sha.to_string()
    }
}

/// A document handed to the shared application layer.
///
/// `handle` is the absolute path. It is opaque to the TypeScript side, which
/// only ever passes it back to `save_note` — the same contract the browser
/// port's opaque `fsa:N` handles satisfy.
#[derive(Serialize)]
pub struct OpenedNote {
    handle: String,
    name: String,
    /// Base64 of the file's exact bytes.
    bytes: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCatalogEntry {
    handle: String,
    name: String,
    modified_ms: u64,
    created_ms: u64,
    /// The author's own lead sentence, when the note has one. `None` renders
    /// no subtitle rather than an empty one.
    ///
    /// Skipped rather than serialized as `null`, so the field is genuinely
    /// absent on the wire and the TypeScript `preview?: string` is honest
    /// instead of quietly meaning `string | null`.
    #[serde(skip_serializing_if = "Option::is_none")]
    preview: Option<String>,
}

#[derive(Serialize)]
pub struct WorkspaceCatalog {
    handle: String,
    name: String,
    notes: Vec<WorkspaceCatalogEntry>,
}

/// What this process last wrote to each path, so the watcher can tell our own
/// saves apart from someone else's edit.
#[derive(Clone, Default)]
pub struct WriteLedger(Arc<Mutex<HashMap<PathBuf, u64>>>);

/// Owns the one filesystem watcher associated with the current document.
///
/// Reopening or switching a note replaces the previous generation and signals
/// its thread to stop. The stop sender also disconnects during application
/// teardown, so no detached watcher can outlive Tauri's managed state.
#[derive(Default)]
pub struct NoteWatchControl(Mutex<Option<ActiveNoteWatch>>);

struct ActiveNoteWatch {
    path: PathBuf,
    stop: Sender<()>,
}

fn watcher_was_stopped(stop: &Receiver<()>) -> bool {
    matches!(stop.try_recv(), Ok(()) | Err(TryRecvError::Disconnected))
}

fn active_note_watch_matches(active: &Option<ActiveNoteWatch>, path: &Path) -> bool {
    active.as_ref().is_some_and(|watch| watch.path == path)
}

fn replace_active_note_watch(
    active: &mut Option<ActiveNoteWatch>,
    path: PathBuf,
    stop: Sender<()>,
) {
    if let Some(previous) = active.replace(ActiveNoteWatch { path, stop }) {
        let _ = previous.stop.send(());
    }
}

fn stop_active_note_watch(active: &mut Option<ActiveNoteWatch>) -> bool {
    let Some(watch) = active.take() else {
        return false;
    };
    let _ = watch.stop.send(());
    true
}

/// Finder may hand the app a file before the webview has installed listeners.
/// Keep those paths until the TypeScript composition root explicitly takes
/// them; the event is only a wake-up signal, never the durable delivery path.
#[derive(Default)]
pub struct OpenRequestQueue(Mutex<VecDeque<PathBuf>>);

fn content_hash(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}

/// Prompts for one Markdown file and returns its exact bytes.
#[tauri::command]
async fn open_note(app: AppHandle) -> Result<Option<OpenedNote>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .blocking_pick_file();

    let Some(picked) = picked else {
        // A cancelled picker is an ordinary outcome, not an error. The shell
        // leaves the current document exactly as it was.
        return Ok(None);
    };

    let path = picked
        .into_path()
        .map_err(|error| format!("That selection has no readable path: {error}"))?;

    read_note(&path).map(Some)
}

/// The folder this platform supplies without anyone choosing it.
///
/// Desktop has none: a folder becomes a collection because the person picked
/// it, and inventing one would adopt a directory nobody pointed at. iOS is the
/// opposite — the operating system hands the application exactly one document
/// directory, published to the Files app and replicated by iCloud, and there
/// is no picker that could choose a different one. Returning it is a statement
/// of fact rather than a guess.
///
/// The shell adopts this only when no folder has been adopted already, so a
/// person's own choice always outranks the platform's.
#[cfg(desktop)]
#[tauri::command]
async fn default_workspace() -> Result<Option<WorkspaceCatalog>, String> {
    Ok(None)
}

/// The app's folder in iCloud Drive, when the platform will grant one.
///
/// `URLForUbiquityContainerIdentifier` answers `nil` for every honest reason a
/// person might have — signed out of iCloud, iCloud Drive switched off, the
/// entitlement not granted to this build — and none of them is an error worth
/// reporting. The caller falls back to the on-device folder, which is a smaller
/// promise that still works.
///
/// It can block while the daemon sets the container up, which is why this is
/// only ever reached from an async command rather than the UI thread.
#[cfg(target_os = "ios")]
fn icloud_documents() -> Option<PathBuf> {
    use objc2_foundation::NSFileManager;

    let container = NSFileManager::defaultManager().URLForUbiquityContainerIdentifier(None)?;
    let path = container.path()?;
    // `Documents` is the one subdirectory iCloud Drive shows to a person; the
    // rest of a ubiquity container stays private to the application.
    let documents = PathBuf::from(path.to_string()).join("Documents");
    fs::create_dir_all(&documents).ok()?;
    Some(documents)
}

#[cfg(all(mobile, not(target_os = "ios")))]
fn icloud_documents() -> Option<PathBuf> {
    None
}

#[cfg(mobile)]
#[tauri::command]
async fn default_workspace(app: AppHandle) -> Result<Option<WorkspaceCatalog>, String> {
    // iCloud first, because the same notes on a phone and a Mac is the whole
    // point of the folder; on-device second, because a person without iCloud
    // still has notes. Whichever answers, the shell receives one ordinary
    // folder of Markdown and cannot tell the difference.
    let directory = match icloud_documents() {
        Some(icloud) => icloud,
        None => app
            .path()
            .document_dir()
            .map_err(|error| format!("This device exposed no documents directory: {error}"))?,
    };
    workspace_catalog_for_directory(&directory).map(Some)
}

/// Prompts for a folder whose direct Markdown children become one collection.
///
/// Picking a folder is deliberately separate from opening a file: opening
/// `Downloads/example.md` must never imply permission to adopt every Markdown
/// file in Downloads.
#[cfg(desktop)]
#[tauri::command]
async fn open_workspace_folder(app: AppHandle) -> Result<Option<WorkspaceCatalog>, String> {
    let picked = app.dialog().file().blocking_pick_folder();

    let Some(picked) = picked else {
        return Ok(None);
    };

    let directory = picked
        .into_path()
        .map_err(|error| format!("That folder has no readable path: {error}"))?;
    workspace_catalog_for_directory(&directory).map(Some)
}

/// On iOS there is no folder picker, and there does not need to be.
///
/// The application owns one document directory, exposed to the Files app and
/// replicated by iCloud, so the folder that would be chosen on desktop is
/// already known. Adopting a collection is therefore not a prompt but a fact:
/// return the catalog of the directory the operating system gave this app.
///
/// This is the mobile half of the same `WorkspaceCatalogPort` contract — a
/// folder of ordinary Markdown files — reached by a different route.
#[cfg(mobile)]
#[tauri::command]
async fn open_workspace_folder(app: AppHandle) -> Result<Option<WorkspaceCatalog>, String> {
    let directory = app
        .path()
        .document_dir()
        .map_err(|error| format!("This device exposed no documents directory: {error}"))?;
    workspace_catalog_for_directory(&directory).map(Some)
}

/// Reads a note that is already chosen — used by reopen and by the watcher.
#[tauri::command]
fn read_note_at(path: String) -> Result<OpenedNote, String> {
    read_note(Path::new(&path))
}

fn read_note(path: &Path) -> Result<OpenedNote, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());

    Ok(OpenedNote {
        handle: path.display().to_string(),
        name,
        bytes: BASE64.encode(&bytes),
    })
}

#[derive(Debug, PartialEq)]
enum ResolvedDocumentLink {
    External(String),
    Local(PathBuf),
}

/// Resolves portable Markdown links at click time from the note's current
/// location. The Markdown never receives this absolute path; moving the whole
/// folder to another device therefore keeps the same relative source valid.
fn resolve_document_link(
    document_handle: &str,
    href: &str,
) -> Result<ResolvedDocumentLink, String> {
    let href = href.trim();
    if href.is_empty() {
        return Err("The link has no destination".to_string());
    }

    if let Ok(url) = Url::parse(href) {
        return match url.scheme() {
            "http" | "https" | "mailto" => Ok(ResolvedDocumentLink::External(url.to_string())),
            "file" => Err(
                "Absolute file links are tied to one machine; use a relative Markdown path"
                    .to_string(),
            ),
            scheme => Err(format!("Links using {scheme}: are not allowed")),
        };
    }

    let raw_path = Path::new(href.split(['?', '#']).next().unwrap_or_default());
    if raw_path.is_absolute() || href.starts_with('~') {
        return Err(
            "Absolute file links are tied to one machine; use a relative Markdown path".to_string(),
        );
    }

    let document = Path::new(document_handle);
    let base = document
        .parent()
        .ok_or_else(|| "The open document has no containing folder".to_string())?;
    let base_url = Url::from_directory_path(base)
        .map_err(|_| "The document folder cannot resolve relative links".to_string())?;
    let target_url = base_url
        .join(href)
        .map_err(|error| format!("The relative link is invalid: {error}"))?;
    if target_url.scheme() != "file" {
        return Err("The link does not resolve to a local file".to_string());
    }
    let target = target_url
        .to_file_path()
        .map_err(|_| "The local link is not a valid file path".to_string())?
        .canonicalize()
        .map_err(|error| format!("Linked file is unavailable: {error}"))?;
    Ok(ResolvedDocumentLink::Local(target))
}

const REMOTE_DATA_MESSAGE: &str =
    "Remote data is not loaded. Put the values in the chart, or link a file next to your note.";

/// Reads a data file named by a chart, resolved exactly as a document link is.
///
/// Deliberately the same resolver as `open_document_link`, because a chart
/// naming a file and a link naming a file are the same act: relative paths
/// resolve against the note's folder and may traverse upward, while absolute
/// paths and `file:` URLs are refused as machine-specific. No containment rule
/// is added here that links do not already have.
///
/// The one divergence is the remote case. A link hands `http(s)` to the system
/// browser; a chart has nowhere to hand it and this crate holds no network
/// permission, so it is refused with the message the reader can act on.
/// Consent-gated remote data is a separate task.
fn read_data_at(document_handle: &str, href: &str) -> Result<String, String> {
    match resolve_document_link(document_handle, href)? {
        ResolvedDocumentLink::External(_) => Err(REMOTE_DATA_MESSAGE.to_string()),
        ResolvedDocumentLink::Local(path) => std::fs::read_to_string(&path)
            .map_err(|error| format!("Linked file is unavailable: {error}")),
    }
}

#[tauri::command]
fn read_note_data(document_handle: String, href: String) -> Result<String, String> {
    read_data_at(&document_handle, &href)
}

/// iOS forbids spawning a subprocess, so the desktop `open`/`xdg-open` route
/// does not exist. The platform equivalent is `UIApplication.open`, which is
/// Phase 1 work; until then this is a named limitation rather than a silent
/// failure, and the Markdown source is untouched either way.
#[cfg(mobile)]
fn open_with_system(_target: &str) -> Result<(), String> {
    Err("Opening external links is not available on iOS yet".to_string())
}

#[cfg(desktop)]
fn open_with_system(target: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return Err("Opening links is not supported on this platform".to_string());

    command
        .arg(target)
        .spawn()
        .map_err(|error| format!("The operating system could not open the link: {error}"))?;
    Ok(())
}

#[tauri::command]
fn open_document_link(app: AppHandle, document_handle: String, href: String) -> Result<(), String> {
    let resolved = resolve_document_link(&document_handle, &href)?;
    match resolved {
        ResolvedDocumentLink::External(url) => open_with_system(&url),
        ResolvedDocumentLink::Local(path) if is_markdown(&path) => {
            // Markdown stays in this window regardless of the user's global
            // Finder association. The existing queue is the sole open route.
            queue_opened_paths(&app, vec![path]);
            Ok(())
        }
        ResolvedDocumentLink::Local(path) => open_with_system(&path.to_string_lossy()),
    }
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| {
            extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown")
        })
}

/// Validates a person-supplied filename and supplies the Markdown suffix when
/// it is omitted. Paths are deliberately not accepted here: Save and Rename
/// must never turn a filename field into authority to write somewhere else.
fn markdown_file_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("A note needs a name".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains(':') {
        return Err("A note name cannot contain a path separator".to_string());
    }
    let mut components = Path::new(name).components();
    let component = components
        .next()
        .ok_or_else(|| "A note needs a name".to_string())?;
    if components.next().is_some() || !matches!(component, Component::Normal(_)) {
        return Err("A note name must be a filename, not a path".to_string());
    }
    let extension = Path::new(name).extension().and_then(|value| value.to_str());
    match extension {
        None => Ok(format!("{name}.md")),
        Some(extension)
            if extension.eq_ignore_ascii_case("md")
                || extension.eq_ignore_ascii_case("markdown") =>
        {
            Ok(name.to_string())
        }
        Some(_) => Err("Notes must use a .md or .markdown filename".to_string()),
    }
}

/// Uses the native Save panel's directory choice but keeps the name a
/// Markdown filename. A filter alone is only a convenience in Finder, not a
/// file-safety guarantee.
fn markdown_destination(path: PathBuf) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("{} is not a file destination", path.display()))?
        .to_string_lossy();
    let name = markdown_file_name(&file_name)?;
    Ok(path.with_file_name(name))
}

/// Creates a new file with bytes exactly once. `create_new` is the overwrite
/// guard — no preflight `exists()` check can make a collision safe.
fn write_new_note(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                format!(
                    "A note named {} already exists — choose another name",
                    path.file_name()
                        .map(|name| name.to_string_lossy())
                        .unwrap_or_else(|| path.display().to_string().into())
                )
            } else {
                format!("Could not create {}: {error}", path.display())
            }
        })?;

    if let Err(error) = file.write_all(bytes).and_then(|()| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(path);
        return Err(format!("Could not finish {}: {error}", path.display()));
    }
    Ok(())
}

fn millis(time: Result<SystemTime, std::io::Error>) -> u64 {
    time.ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// How much of a note is read to find its preview.
///
/// Every extraction rule looks at the document's opening only, and opening a
/// folder must not wait on I/O — so this is deliberately small.
const PREVIEW_READ_LIMIT: u64 = 8 * 1024;

fn catalog_entry(path: &Path) -> Result<WorkspaceCatalogEntry, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    Ok(WorkspaceCatalogEntry {
        handle: path.display().to_string(),
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.display().to_string()),
        modified_ms: millis(metadata.modified()),
        created_ms: millis(metadata.created()),
        preview: preview_of(path),
    })
}

/// An unreadable note is not a catalog failure. The row still lists, without
/// a subtitle — the same outcome as a note that has no prose.
fn preview_of(path: &Path) -> Option<String> {
    use std::io::Read;
    let file = fs::File::open(path).ok()?;
    let mut buffer = Vec::with_capacity(PREVIEW_READ_LIMIT as usize);
    file.take(PREVIEW_READ_LIMIT).read_to_end(&mut buffer).ok()?;
    note_preview::extract_preview(&String::from_utf8_lossy(&buffer))
}

fn inspected_workspace_note(path: &Path) -> Result<WorkspaceCatalog, String> {
    let directory = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    Ok(WorkspaceCatalog {
        handle: directory.display().to_string(),
        name: directory
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| directory.display().to_string()),
        notes: vec![catalog_entry(path)?],
    })
}

fn workspace_catalog(path: &Path) -> Result<WorkspaceCatalog, String> {
    let directory = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    workspace_catalog_for_directory(directory)
}

fn workspace_catalog_for_directory(directory: &Path) -> Result<WorkspaceCatalog, String> {
    let mut notes = Vec::new();
    for entry in fs::read_dir(directory)
        .map_err(|error| format!("Could not list {}: {error}", directory.display()))?
    {
        let entry = entry.map_err(|error| format!("Could not read folder entry: {error}"))?;
        let note_path = entry.path();
        if !note_path.is_file() || !is_markdown(&note_path) {
            continue;
        }
        notes.push(catalog_entry(&note_path)?);
    }
    notes.sort_by(|left, right| {
        right
            .modified_ms
            .cmp(&left.modified_ms)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(WorkspaceCatalog {
        handle: directory.display().to_string(),
        name: directory
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| directory.display().to_string()),
        notes,
    })
}

#[tauri::command]
fn list_workspace(handle: String) -> Result<WorkspaceCatalog, String> {
    workspace_catalog(Path::new(&handle))
}

#[tauri::command]
fn list_workspace_folder(handle: String) -> Result<WorkspaceCatalog, String> {
    workspace_catalog_for_directory(Path::new(&handle))
}

#[tauri::command]
fn inspect_workspace_note(handle: String) -> Result<WorkspaceCatalog, String> {
    inspected_workspace_note(Path::new(&handle))
}

#[tauri::command]
fn create_note(workspace_handle: String) -> Result<OpenedNote, String> {
    let directory = PathBuf::from(&workspace_handle);
    for number in 1..=10_000 {
        let name = if number == 1 {
            "Untitled.md".to_string()
        } else {
            format!("Untitled {number}.md")
        };
        let path = directory.join(name);
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(b"# New note\n\n")
                    .map_err(|error| format!("Could not create {}: {error}", path.display()))?;
                file.sync_all()
                    .map_err(|error| format!("Could not finish {}: {error}", path.display()))?;
                return read_note(&path);
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Could not create {}: {error}", path.display())),
        }
    }
    Err("Could not choose a unique Untitled note name".to_string())
}

/// First save for an in-memory note. The operating system, not a remembered
/// folder, owns the destination choice; cancelling leaves the draft untouched.
#[tauri::command]
async fn save_new_note(
    app: AppHandle,
    suggested_name: String,
    bytes: String,
) -> Result<Option<OpenedNote>, String> {
    let suggested_name = markdown_file_name(&suggested_name)?;
    let decoded = BASE64
        .decode(bytes.as_bytes())
        .map_err(|error| format!("Rejected a malformed new-note payload: {error}"))?;
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name(suggested_name)
        .blocking_save_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let destination = markdown_destination(
        picked
            .into_path()
            .map_err(|error| format!("That save destination has no writable path: {error}"))?,
    )?;
    write_new_note(&destination, &decoded)?;
    read_note(&destination).map(Some)
}

/// Renames one note without relying on `rename`'s platform-specific overwrite
/// behaviour. Linking the old file to the requested new name first makes a
/// collision fail safely before the source is removed.
#[tauri::command]
fn rename_note(handle: String, name: String) -> Result<OpenedNote, String> {
    let source = PathBuf::from(&handle);
    let directory = source
        .parent()
        .ok_or_else(|| format!("{handle} has no parent folder"))?;
    let destination = directory.join(markdown_file_name(&name)?);
    if source == destination {
        return read_note(&source);
    }

    fs::hard_link(&source, &destination).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            format!(
                "A note named {} already exists — choose another name",
                destination
                    .file_name()
                    .map(|value| value.to_string_lossy())
                    .unwrap_or_else(|| destination.display().to_string().into())
            )
        } else {
            format!(
                "Could not rename {} to {}: {error}",
                source.display(),
                destination.display()
            )
        }
    })?;
    if let Err(error) = fs::remove_file(&source) {
        let _ = fs::remove_file(&destination);
        return Err(format!(
            "Could not finish renaming {} to {}: {error}",
            source.display(),
            destination.display()
        ));
    }
    read_note(&destination)
}

#[tauri::command]
fn duplicate_note(handle: String) -> Result<OpenedNote, String> {
    let source = PathBuf::from(&handle);
    let directory = source
        .parent()
        .ok_or_else(|| format!("{handle} has no parent folder"))?;
    let stem = source
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .ok_or_else(|| format!("{handle} has no file name"))?;
    let extension = source
        .extension()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "md".to_string());

    for number in 1..=10_000 {
        let suffix = if number == 1 {
            " copy".to_string()
        } else {
            format!(" copy {number}")
        };
        let destination = directory.join(format!("{stem}{suffix}.{extension}"));
        if destination.exists() {
            continue;
        }
        fs::copy(&source, &destination).map_err(|error| {
            format!(
                "Could not duplicate {} to {}: {error}",
                source.display(),
                destination.display()
            )
        })?;
        return read_note(&destination);
    }

    Err("Could not choose an unused duplicate name".to_string())
}

#[tauri::command]
async fn export_note(app: AppHandle, handle: String) -> Result<bool, String> {
    let source = PathBuf::from(&handle);
    let name = source
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "note.md".to_string());
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name(name)
        .blocking_save_file();
    let Some(picked) = picked else {
        return Ok(false);
    };
    let destination = picked
        .into_path()
        .map_err(|error| format!("That export destination has no writable path: {error}"))?;
    fs::copy(&source, &destination).map_err(|error| {
        format!(
            "Could not export {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })?;
    Ok(true)
}

/// Copies `source`'s exact bytes to `destination` and reads the result back.
///
/// A destination equal to the source is not copied — `fs::copy` opens the
/// destination for writing before it has finished reading the source, so
/// copying a file onto itself risks truncating it mid-read.
fn copy_note_to(source: &Path, destination: &Path) -> Result<OpenedNote, String> {
    if destination == source {
        return read_note(source);
    }
    fs::copy(source, destination).map_err(|error| {
        format!(
            "Could not save {} to {}: {error}",
            source.display(),
            destination.display()
        )
    })?;
    read_note(destination)
}

/// Prompts for a new name/location and switches the document to the copy.
///
/// Unlike `duplicate_note`, the destination is the person's own choice, not
/// an auto-generated "copy" name — the traditional desktop Save As.
#[tauri::command]
async fn save_note_as(app: AppHandle, handle: String) -> Result<Option<OpenedNote>, String> {
    let source = PathBuf::from(&handle);
    let name = source
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "note.md".to_string());
    let picked = app
        .dialog()
        .file()
        .add_filter("Markdown", &["md", "markdown"])
        .set_file_name(name)
        .blocking_save_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let destination = picked
        .into_path()
        .map_err(|error| format!("That destination has no writable path: {error}"))?;
    copy_note_to(&source, &destination).map(Some)
}

#[cfg(desktop)]
#[tauri::command]
async fn trash_note(handle: String) -> Result<(), String> {
    let path = PathBuf::from(&handle);
    move_note_to_trash(path).map_err(|error| format!("Could not move {handle} to Trash: {error}"))
}

/// iOS has no user-visible Trash an app may move a document into, so this is a
/// named limitation rather than a silent no-op: the note is still the person's
/// file, and the Files app is where it is deleted.
#[cfg(mobile)]
#[tauri::command]
async fn trash_note(_handle: String) -> Result<(), String> {
    Err("Deleting a note is done from the Files app on iOS".to_string())
}

/// Reveals a note or folder in the platform file manager, with the item
/// selected where the platform supports that (Finder, Explorer).
#[tauri::command]
async fn reveal_in_finder(handle: String) -> Result<(), String> {
    #[cfg_attr(mobile, allow(unused_variables))]
    let path = PathBuf::from(&handle);

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|error| format!("Could not reveal {handle} in Finder: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        let mut argument = std::ffi::OsString::from("/select,");
        argument.push(path.as_os_str());
        Command::new("explorer")
            .arg(argument)
            .spawn()
            .map_err(|error| format!("Could not reveal {handle} in Explorer: {error}"))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        // xdg-open has no cross-desktop "reveal and select" verb, so open the
        // containing folder — the closest portable equivalent.
        let directory = path.parent().unwrap_or(&path);
        Command::new("xdg-open")
            .arg(directory)
            .spawn()
            .map_err(|error| format!("Could not reveal {handle}: {error}"))?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    Err("Revealing files is not supported on this platform".to_string())
}

#[cfg(desktop)]
fn move_note_to_trash(path: PathBuf) -> Result<(), trash::Error> {
    // trash-rs defaults to scripting Finder on macOS. That adds an Automation
    // permission prompt and can leave the app waiting for an AppleEvent timeout.
    // NSFileManager is the native, permission-free Trash operation and keeps
    // this ordinary note action immediate.
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};

        let mut context = trash::TrashContext::new();
        context.set_delete_method(DeleteMethod::NsFileManager);
        context.delete(path)
    }

    #[cfg(not(target_os = "macos"))]
    trash::delete(path)
}

/// Returns the next file macOS asked SimpleMark to open.
#[tauri::command]
fn take_open_note_request(queue: State<'_, OpenRequestQueue>) -> Result<Option<String>, String> {
    let path = queue
        .0
        .lock()
        .map_err(|_| "The open-file queue was poisoned by an earlier panic".to_string())?
        .pop_front();
    Ok(path.map(|path| path.display().to_string()))
}

/// Only a desktop shell is handed files by the operating system this way:
/// `RunEvent::Opened` on macOS and a command line elsewhere. iOS delivers
/// documents through the Files app instead, which is Phase 1 work.
#[cfg_attr(mobile, allow(dead_code))]
fn opened_markdown_paths(urls: &[Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter_map(|url| url.to_file_path().ok())
        .filter(|path| {
            path.extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    extension.eq_ignore_ascii_case("md")
                        || extension.eq_ignore_ascii_case("markdown")
                })
        })
        .collect()
}

#[cfg_attr(mobile, allow(dead_code))]
fn opened_markdown_args(args: &[String], cwd: &str) -> Vec<PathBuf> {
    args.iter()
        .skip(1)
        .filter_map(|arg| {
            if let Ok(url) = Url::parse(arg) {
                return url.to_file_path().ok();
            }
            let path = PathBuf::from(arg);
            Some(if path.is_absolute() {
                path
            } else {
                Path::new(cwd).join(path)
            })
        })
        .filter(|path| is_markdown(path))
        .collect()
}

fn queue_opened_paths(app: &AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }

    let queued = app
        .state::<OpenRequestQueue>()
        .0
        .lock()
        .map(|mut queue| queue.extend(paths))
        .is_ok();
    if !queued {
        return;
    }

    // The queue prevents launch-time loss. This event lets an already-running
    // webview react immediately without polling.
    let _ = app.emit("open-note-requested", ());
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, allow(dead_code))]
fn queue_opened_notes(app: &AppHandle, urls: &[Url]) {
    queue_opened_paths(app, opened_markdown_paths(urls));
}

/// Writes bytes atomically: temp file in the same directory, fsync, rename.
///
/// Same directory matters — `rename` is only atomic within a filesystem, and a
/// temp file in `/tmp` can land on a different volume. fsync before the rename
/// is what makes the rename safe rather than merely quick: without it the
/// rename can be durable while the contents are not, which is how a crash
/// produces an empty note.
#[tauri::command]
fn save_note(handle: String, bytes: String, ledger: State<'_, WriteLedger>) -> Result<(), String> {
    let path = PathBuf::from(&handle);
    let decoded = BASE64
        .decode(bytes.as_bytes())
        .map_err(|error| format!("Rejected a malformed payload for {handle}: {error}"))?;

    let directory = path
        .parent()
        .ok_or_else(|| format!("{handle} has no parent directory to stage a write in"))?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("{handle} is not a file path"))?
        .to_string_lossy()
        .into_owned();

    let temp = directory.join(format!(".{file_name}.simplemark-tmp"));

    // Record before the rename: the watcher may fire the moment it lands, and
    // an unrecorded write would look to us like somebody else's edit.
    ledger
        .0
        .lock()
        .map_err(|_| "The write ledger was poisoned by an earlier panic".to_string())?
        .insert(path.clone(), content_hash(&decoded));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = File::create(&temp)?;
        file.write_all(&decoded)?;
        file.sync_all()?;
        drop(file);
        // Preserve the original file's permissions rather than inheriting the
        // temp file's; a saved note must not change mode behind your back.
        if let Ok(existing) = fs::metadata(&path) {
            let _ = fs::set_permissions(&temp, existing.permissions());
        }
        fs::rename(&temp, &path)
    })();

    if let Err(error) = write_result {
        // Never leave debris behind a failed save, and never report success.
        let _ = fs::remove_file(&temp);
        return Err(format!("Not saved — {}: {error}", path.display()));
    }

    Ok(())
}

/// Watches one note and emits `note-changed-externally` when somebody else
/// writes it.
///
/// The event carries only the path. The shared application layer decides what a
/// change means; this crate must not reach into the document to apply it.
#[cfg(desktop)]
#[tauri::command]
fn watch_note(
    app: AppHandle,
    handle: String,
    ledger: State<'_, WriteLedger>,
    control: State<'_, NoteWatchControl>,
) -> Result<(), String> {
    let path = PathBuf::from(&handle);
    let directory = path
        .parent()
        .ok_or_else(|| format!("{handle} has no parent directory to watch"))?
        .to_path_buf();

    let mut active = control
        .0
        .lock()
        .map_err(|_| "The note watcher registry was poisoned by an earlier panic".to_string())?;
    if active_note_watch_matches(&active, &path) {
        return Ok(());
    }

    // Establish the replacement before retiring the old watcher. A setup
    // failure must leave the known-good watcher running and be visible to the
    // caller rather than silently disabling external-change detection.
    let (event_sender, event_receiver) = channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(event_sender)
        .map_err(|error| format!("Could not watch {handle}: {error}"))?;
    // Watch the directory, not the file: editors that save by rename replace
    // the inode, and a file watch would follow the old one into oblivion.
    watcher
        .watch(&directory, RecursiveMode::NonRecursive)
        .map_err(|error| format!("Could not watch {}: {error}", directory.display()))?;

    let (stop_sender, stop_receiver) = channel::<()>();
    replace_active_note_watch(&mut active, path.clone(), stop_sender);
    drop(active);

    // Clone the narrow state this worker needs. It never reaches back through
    // `AppHandle::state`, whose missing-state path intentionally panics during
    // teardown.
    let ledger = ledger.inner().clone();
    std::thread::spawn(move || {
        // Moving `watcher` into the worker makes its lifetime explicit: notify
        // stops monitoring when this loop exits and the watcher is dropped.
        let _watcher = watcher;
        loop {
            if watcher_was_stopped(&stop_receiver) {
                break;
            }

            let event = match event_receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(event) => event,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break,
            };

            let Ok(event) = event else { continue };
            if !matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
            ) {
                continue;
            }
            if !event.paths.iter().any(|changed| changed == &path) {
                continue;
            }

            // Coalesce: one logical save produces several filesystem events.
            std::thread::sleep(Duration::from_millis(120));
            if watcher_was_stopped(&stop_receiver) {
                break;
            }

            let Ok(current) = fs::read(&path) else {
                continue;
            };
            let hash = content_hash(&current);

            let ours = ledger
                .0
                .lock()
                .map(|ledger| ledger.get(&path).copied() == Some(hash))
                .unwrap_or(false);
            if ours {
                continue;
            }

            // Starts the quiescence timer. An agent rewriting this file fires
            // here many times a second; this only stamps a time, so the burst
            // costs one re-summary once the writes stop rather than one each.
            if let Some(summaries) = app.try_state::<note_summaries::SummaryState>() {
                note_summaries::note_changed_externally(&summaries, &handle);
            }

            let _ = app.emit("note-changed-externally", handle.clone());
        }
    });

    Ok(())
}

/// Stops watching when the document pane no longer owns a real file.
///
/// Switching directly to another note uses `watch_note`, which replaces the
/// prior generation atomically. This command is only for the zero-selection
/// state after the final visible note is closed.
#[tauri::command]
fn stop_watching_note(control: State<'_, NoteWatchControl>) -> Result<(), String> {
    let mut active = control
        .0
        .lock()
        .map_err(|_| "The note watcher registry was poisoned by an earlier panic".to_string())?;
    stop_active_note_watch(&mut active);
    Ok(())
}

/// Watches one explicitly adopted folder for Markdown membership changes.
///
/// The event names the folder only. TypeScript re-lists it through the catalog
/// port, keeping filesystem observation out of the shared application model.
#[cfg(desktop)]
#[tauri::command]
fn watch_workspace_folder(app: AppHandle, handle: String) -> Result<(), String> {
    let directory = PathBuf::from(&handle);
    if !directory.is_dir() {
        return Err(format!("{handle} is not a readable folder"));
    }

    std::thread::spawn(move || {
        let (sender, receiver) = channel::<notify::Result<Event>>();
        let Ok(mut watcher) = notify::recommended_watcher(sender) else {
            return;
        };
        if watcher
            .watch(&directory, RecursiveMode::NonRecursive)
            .is_err()
        {
            return;
        }

        for event in receiver {
            let Ok(event) = event else { continue };
            if !matches!(
                event.kind,
                EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)
            ) {
                continue;
            }
            if !event.paths.iter().any(|path| is_markdown(path)) {
                continue;
            }
            std::thread::sleep(Duration::from_millis(120));
            let _ = app.emit("workspace-folder-changed", directory.display().to_string());
        }
    });

    Ok(())
}

/// iOS placeholders for the two filesystem watches.
///
/// `notify` has no iOS backend, and iCloud is not a plain filesystem anyway: a
/// note can exist as a placeholder before its bytes have been downloaded, so
/// the desktop "the directory changed" signal is the wrong shape even if it
/// were available. The real iOS input is `NSFilePresenter`/`NSFileCoordinator`,
/// which reports when a download completes.
///
/// Until that exists, these resolve rather than fail so that opening a note
/// works — but nothing is being watched. **External changes made on another
/// device are not detected on iOS**, which means ADR-0006's external-bytes
/// adapter currently has no mobile input. This is a known, named gap, not a
/// working watcher.
/// How often iOS looks for somebody else's write.
///
/// `notify` has no iOS backend, and the push alternatives do not fit what this
/// has to watch: a `dispatch` vnode source dies when an atomic save replaces
/// the inode, and `NSMetadataQuery` only ever sees the iCloud container, not
/// the on-device folder the app falls back to. So this asks, on an interval
/// slow enough to be invisible on a battery and quick enough that a note edited
/// on a Mac appears while you are still looking at the phone.
///
/// It is a poll, and the comment says so rather than the name pretending
/// otherwise. `NSFilePresenter` would replace the trigger without touching any
/// of the meaning below — same ledger comparison, same coalescing, same event.
#[cfg(mobile)]
const MOBILE_WATCH_INTERVAL: Duration = Duration::from_millis(1500);

/// Reports when somebody other than this process writes the open note.
///
/// Deliberately the same shape as the desktop watcher, because the difference
/// between them must stay in how a change is noticed and never in what a change
/// means: content is hashed and compared against the write ledger so this app's
/// own saves are silent, and the event carries only the path — the shared
/// application layer decides what a change implies.
#[cfg(mobile)]
#[tauri::command]
fn watch_note(
    app: AppHandle,
    handle: String,
    ledger: State<'_, WriteLedger>,
    control: State<'_, NoteWatchControl>,
) -> Result<(), String> {
    let path = PathBuf::from(&handle);

    let mut active = control
        .0
        .lock()
        .map_err(|_| "The note watcher registry was poisoned by an earlier panic".to_string())?;
    if active_note_watch_matches(&active, &path) {
        return Ok(());
    }

    let (stop_sender, stop_receiver) = channel::<()>();
    replace_active_note_watch(&mut active, path.clone(), stop_sender);
    drop(active);

    let ledger = ledger.inner().clone();
    std::thread::spawn(move || {
        // Whatever is on disk when watching starts is the baseline, not a
        // change. Reading it here means the first poll cannot mistake the file
        // you just opened for somebody else's edit.
        let mut seen = fs::read(&path).ok().map(|bytes| content_hash(&bytes));

        loop {
            std::thread::sleep(MOBILE_WATCH_INTERVAL);
            if watcher_was_stopped(&stop_receiver) {
                break;
            }

            // iCloud materialises lazily, so a file can exist as a placeholder
            // before its bytes arrive. A failed read is that state, not a
            // deletion, and waiting is the honest response.
            let Ok(current) = fs::read(&path) else {
                continue;
            };
            let hash = content_hash(&current);
            if seen == Some(hash) {
                continue;
            }
            seen = Some(hash);

            let ours = ledger
                .0
                .lock()
                .map(|ledger| ledger.get(&path).copied() == Some(hash))
                .unwrap_or(false);
            if ours {
                continue;
            }

            if let Some(summaries) = app.try_state::<note_summaries::SummaryState>() {
                note_summaries::note_changed_externally(&summaries, &handle);
            }

            let _ = app.emit("note-changed-externally", handle.clone());
        }
    });

    Ok(())
}

/// Reports when the adopted folder gains or loses a Markdown file.
///
/// Membership only. The event names the folder and TypeScript re-lists it
/// through the catalog port, which keeps filesystem observation out of the
/// shared application model exactly as it is on desktop.
#[cfg(mobile)]
#[tauri::command]
fn watch_workspace_folder(app: AppHandle, handle: String) -> Result<(), String> {
    let directory = PathBuf::from(&handle);
    if !directory.is_dir() {
        return Err(format!("{handle} is not a readable folder"));
    }

    // Names rather than a count: a note renamed, or one swapped for another
    // between polls, leaves the count identical and the folder different.
    let membership = |directory: &Path| -> Vec<String> {
        let Ok(entries) = fs::read_dir(directory) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| is_markdown(path))
            .filter_map(|path| path.file_name().map(|name| name.to_string_lossy().into_owned()))
            .collect();
        names.sort();
        names
    };

    std::thread::spawn(move || {
        let mut seen = membership(&directory);
        loop {
            std::thread::sleep(MOBILE_WATCH_INTERVAL);
            let current = membership(&directory);
            if current == seen {
                continue;
            }
            seen = current;
            let _ = app.emit("workspace-folder-changed", directory.display().to_string());
        }
    });

    Ok(())
}

/// Raises the operating system's print panel for the document window.
///
/// This exists because WKWebView leaves the webview's own `window.print()`
/// unanswered — the browser shell's one-liner has no macOS equivalent, so the
/// panel must be opened from the native side. It stays a transport all the
/// same: pagination, what is hidden, and what a page looks like are decided by
/// the shared print stylesheet, and this function neither reads the document
/// nor knows that it is Markdown.
#[cfg(desktop)]
#[tauri::command]
fn print_note(window: tauri::WebviewWindow) -> Result<(), String> {
    window
        .print()
        .map_err(|error| format!("Could not open the print panel: {error}"))
}

/// iOS printing goes through `UIPrintInteractionController`, not the webview,
/// so there is no `print()` to forward to. The shared print stylesheet is
/// unaffected; only the transport is missing.
#[cfg(mobile)]
#[tauri::command]
fn print_note(_window: tauri::WebviewWindow) -> Result<(), String> {
    Err("Printing is not available on iOS yet".to_string())
}

/// Sends a standard AppKit text-service action through the responder chain.
///
/// The focused WKWebView remains the target, so macOS owns dictionaries,
/// substitutions, replacements, language settings, and speech. The shared
/// editor neither reimplements those services nor receives document text over
/// IPC. The allow-list is intentionally closed: this is not a generic Cocoa
/// selector bridge.
#[tauri::command]
#[cfg(target_os = "macos")]
fn perform_macos_text_service(service: String) -> Result<(), String> {
    let action = match service.as_str() {
        "show_spelling_and_grammar" => sel!(showGuessPanel:),
        "check_spelling" => sel!(checkSpelling:),
        "toggle_continuous_spell_checking" => sel!(toggleContinuousSpellChecking:),
        "toggle_grammar_checking" => sel!(toggleGrammarChecking:),
        "show_substitutions" => sel!(orderFrontSubstitutionsPanel:),
        "toggle_smart_quotes" => sel!(toggleAutomaticQuoteSubstitution:),
        "toggle_smart_dashes" => sel!(toggleAutomaticDashSubstitution:),
        "toggle_text_replacement" => sel!(toggleAutomaticTextReplacement:),
        "start_speaking" => sel!(startSpeaking:),
        "stop_speaking" => sel!(stopSpeaking:),
        _ => return Err(format!("Unsupported macOS text service: {service}")),
    };
    let marker = MainThreadMarker::new()
        .ok_or_else(|| "macOS text services must run on the main thread".to_string())?;
    let application = NSApplication::sharedApplication(marker);
    // SAFETY: every selector above is a standard NSResponder action, the
    // target is intentionally nil so AppKit resolves the focused responder,
    // and no untrusted selector crosses this boundary.
    let handled = unsafe { application.sendAction_to_from(action, None, None) };
    handled
        .then_some(())
        .ok_or_else(|| "The focused control does not support that macOS text service".to_string())
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn perform_macos_text_service(_service: String) -> Result<(), String> {
    Err("macOS text services are available only on macOS".to_string())
}

#[tauri::command]
#[cfg(target_os = "macos")]
fn set_native_context_menu_shape(shape: macos_context_menu::NativeContextMenuShape) {
    macos_context_menu::set_selection_shape(shape);
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn set_native_context_menu_shape(_shape: serde_json::Value) {}

/// Turns on the native macOS browser-style pinch recognizer. The command
/// crosses no document data; it emits only transient gesture deltas.
#[cfg(target_os = "macos")]
#[tauri::command]
fn enable_page_magnification(window: tauri::WebviewWindow) -> Result<(), String> {
    macos_zoom::enable(&window)
}

/// Other desktop shells load the same TypeScript entrypoint, but do not claim
/// macOS pinch support. Keeping this transport present lets the shared command
/// registration compile on every native target without creating a second zoom
/// implementation outside macOS.
#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn enable_page_magnification(_window: tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

/// Restores one persisted native page magnification or returns Actual Size to
/// the engine default. Values are constrained by the shared UI preference.
#[cfg(target_os = "macos")]
#[tauri::command]
fn set_page_magnification(window: tauri::WebviewWindow, magnification: f64) -> Result<(), String> {
    macos_zoom::set_magnification(&window, magnification)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn set_page_magnification(
    _window: tauri::WebviewWindow,
    _magnification: f64,
) -> Result<(), String> {
    Ok(())
}

/// Keeps the native traffic lights aligned with the whole-page WebKit zoom.
/// The controls live outside the web view, so AppKit cannot infer that scale.
#[cfg(target_os = "macos")]
#[tauri::command]
fn sync_traffic_lights_to_page_zoom(
    window: tauri::WebviewWindow,
    magnification: f64,
) -> Result<(), String> {
    macos_traffic_lights::sync_to_page_zoom(&window, magnification)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
fn sync_traffic_lights_to_page_zoom(
    _window: tauri::WebviewWindow,
    _magnification: f64,
) -> Result<(), String> {
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Must be the first plugin. A Finder open while SimpleMark is already
    // running is a document transition in that window, never permission
    // to create a second application process and another main window.
    //
    // iOS needs no such lock: the operating system already guarantees one
    // process per application, and there is no command line to inspect.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        queue_opened_paths(app, opened_markdown_args(&args, &cwd));
    }));

    let app = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(WriteLedger::default())
        .manage(NoteWatchControl::default())
        .manage(OpenRequestQueue::default())
        .setup(|app| {
            // Summaries are derived data: if the data directory cannot be
            // resolved, the note list shows extracted previews and the app
            // starts normally rather than refusing to run.
            if let Ok(path) = note_summaries::cache_path(&app.handle()) {
                tauri::Manager::manage(app, note_summaries::SummaryState::new(path));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            open_note,
            open_workspace_folder,
            default_workspace,
            read_note_at,
            read_note_data,
            open_document_link,
            inspect_workspace_note,
            list_workspace,
            list_workspace_folder,
            create_note,
            save_new_note,
            rename_note,
            duplicate_note,
            export_note,
            save_note_as,
            trash_note,
            reveal_in_finder,
            take_open_note_request,
            save_note,
            print_note,
            perform_macos_text_service,
            set_native_context_menu_shape,
            app_icons::get_app_icon,
            app_icons::set_app_icon,
            build_provenance,
            ai_chat_completion,
            ai_list_models,
            enable_page_magnification,
            set_page_magnification,
            sync_traffic_lights_to_page_zoom,
            watch_note,
            stop_watching_note,
            watch_workspace_folder,
            note_summaries::note_summaries_available,
            note_summaries::request_note_summaries,
            note_images::download_note_image,
            note_images::read_note_asset
        ])
        .build(tauri::generate_context!())
        .expect("SimpleMark failed to start");

    #[cfg(target_os = "macos")]
    macos_context_menu::install(app.handle())
        .expect("SimpleMark failed to install the native context menu bridge");

    #[cfg(target_os = "macos")]
    macos_note_navigation::install(app.handle());

    #[cfg(target_os = "macos")]
    if let Err(error) = app_icons::restore() {
        eprintln!("SimpleMark could not restore the selected app icon: {error}");
    }

    app.run(|_app, _event| {
        #[cfg(target_os = "macos")]
        if let RunEvent::Opened { urls } = _event {
            queue_opened_notes(_app, &urls);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The D7 contract in the one place this crate can break it.
    #[test]
    fn catalog_entries_carry_a_preview() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(
            directory.path().join("note.md"),
            b"# Title\n\nThe agent rewrites this file while you read it.\n",
        )
        .unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();

        assert_eq!(
            catalog.notes[0].preview.as_deref(),
            Some("The agent rewrites this file while you read it.")
        );
    }

    /// A note with no prose is not an error and not an empty string — it has
    /// no preview, and the row simply shows none.
    #[test]
    fn a_note_without_prose_has_no_preview() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("stub.md"), b"# Just A Heading\n").unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();

        assert_eq!(catalog.notes[0].preview, None);
    }

    /// Opening a folder must not read whole notes. A large file still yields
    /// its preview from the first 8 KiB.
    #[test]
    fn reads_only_a_bounded_prefix_of_each_note() {
        let directory = tempfile::tempdir().unwrap();
        let mut huge = String::from("# Huge\n\nThe opening sentence is right here.\n");
        huge.push_str(&"filler filler filler\n".repeat(250_000));
        fs::write(directory.path().join("huge.md"), huge.as_bytes()).unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();

        assert_eq!(
            catalog.notes[0].preview.as_deref(),
            Some("The opening sentence is right here.")
        );
    }

    #[test]
    fn round_trips_bytes_that_a_string_would_destroy() {
        let awkward: Vec<u8> = vec![b'a', b'\r', 0xF0, 0x9F, 0x92, 0xA9, 0xFF, b'\n'];
        let encoded = BASE64.encode(&awkward);
        assert_eq!(BASE64.decode(encoded.as_bytes()).unwrap(), awkward);
    }

    /// The bundle must be able to name its own commit — that is the entire
    /// point of APP-22, and a build that silently lost the stamp would look
    /// exactly like a working one until somebody trusted a stale app.
    #[test]
    fn the_build_stamps_a_commit_and_a_time() {
        let provenance = build_provenance();
        assert!(!provenance.sha.is_empty());
        assert!(!provenance.built_at.is_empty());
        assert_eq!(provenance.short_sha, short_sha(&provenance.sha));
    }

    #[test]
    fn short_sha_abbreviates_commits_and_leaves_non_commits_intact() {
        assert_eq!(
            short_sha("7670ea436b308c4ba6669ddc47c54565deb6fa26"),
            "7670ea4"
        );
        // Never abbreviate the honest fallback into something SHA-shaped.
        assert_eq!(short_sha("unknown"), "unknown");
    }

    #[test]
    fn identical_content_hashes_identically() {
        assert_eq!(content_hash(b"# note\n"), content_hash(b"# note\n"));
        assert_ne!(content_hash(b"# note\n"), content_hash(b"# note"));
    }

    #[test]
    fn chat_completion_url_appends_the_endpoint_regardless_of_a_trailing_slash() {
        assert_eq!(
            chat_completion_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            chat_completion_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/chat/completions"
        );
    }

    #[test]
    fn models_url_appends_the_endpoint_regardless_of_a_trailing_slash() {
        assert_eq!(
            models_url("https://api.openai.com/v1"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            models_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/models"
        );
    }

    #[test]
    fn chat_completion_body_carries_the_model_and_messages_verbatim() {
        let messages = vec![ChatMessage {
            role: "system".to_string(),
            content: "fix it".to_string(),
        }];
        let body = chat_completion_body("gpt-4o", &messages);
        assert_eq!(body["model"], "gpt-4o");
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "fix it");
    }

    /// Chart data resolves exactly the way a Markdown link does — same
    /// resolver, same refusals — because a chart naming a file and a link
    /// naming a file are the same act (EDITOR-17).
    #[test]
    fn chart_data_reads_a_file_beside_the_note() {
        let dir = tempfile::tempdir().expect("temp dir");
        let note = dir.path().join("note.md");
        std::fs::write(&note, "# note\n").expect("write note");
        std::fs::write(dir.path().join("sales.csv"), "slot,hit\n1,0.94\n").expect("write data");

        let read = read_data_at(note.to_str().expect("note path"), "sales.csv").expect("read data");

        assert_eq!(read, "slot,hit\n1,0.94\n");
    }

    #[test]
    fn chart_data_follows_a_relative_path_out_of_the_notes_folder() {
        let dir = tempfile::tempdir().expect("temp dir");
        let notes = dir.path().join("notes");
        let shared = dir.path().join("shared");
        std::fs::create_dir_all(&notes).expect("notes dir");
        std::fs::create_dir_all(&shared).expect("shared dir");
        let note = notes.join("note.md");
        std::fs::write(&note, "# note\n").expect("write note");
        std::fs::write(shared.join("sales.csv"), "a,b\n1,2\n").expect("write data");

        let read = read_data_at(note.to_str().expect("note path"), "../shared/sales.csv")
            .expect("read data");

        assert_eq!(read, "a,b\n1,2\n");
    }

    #[test]
    fn chart_data_refuses_an_absolute_path_and_a_remote_url() {
        let dir = tempfile::tempdir().expect("temp dir");
        let note = dir.path().join("note.md");
        std::fs::write(&note, "# note\n").expect("write note");
        let handle = note.to_str().expect("note path");

        let absolute = read_data_at(handle, "/etc/hosts").expect_err("absolute must be refused");
        assert!(absolute.contains("tied to one machine"), "{absolute}");

        let remote = read_data_at(handle, "https://vega.github.io/data/cars.json")
            .expect_err("remote must be refused");
        assert!(remote.contains("Remote data"), "{remote}");
    }

    #[test]
    fn chart_data_reports_a_missing_file_rather_than_an_empty_string() {
        let dir = tempfile::tempdir().expect("temp dir");
        let note = dir.path().join("note.md");
        std::fs::write(&note, "# note\n").expect("write note");

        let error = read_data_at(note.to_str().expect("note path"), "missing.csv")
            .expect_err("missing file must be refused");

        assert!(error.contains("unavailable"), "{error}");
    }

    #[test]
    fn replacing_note_watcher_cancels_the_previous_generation() {
        let (first_stop, first_stopped) = channel();
        let (second_stop, second_stopped) = channel();
        let mut active = Some(ActiveNoteWatch {
            path: PathBuf::from("/tmp/first.md"),
            stop: first_stop,
        });

        replace_active_note_watch(&mut active, PathBuf::from("/tmp/second.md"), second_stop);

        assert_eq!(
            first_stopped.recv_timeout(Duration::from_millis(20)),
            Ok(())
        );
        assert!(matches!(
            second_stopped.try_recv(),
            Err(TryRecvError::Empty)
        ));
        assert_eq!(
            active.as_ref().map(|watch| watch.path.as_path()),
            Some(Path::new("/tmp/second.md"))
        );
    }

    #[test]
    fn reopening_the_same_note_deduplicates_its_watcher() {
        let (stop, _stopped) = channel();
        let active = Some(ActiveNoteWatch {
            path: PathBuf::from("/tmp/note.md"),
            stop,
        });

        assert!(active_note_watch_matches(
            &active,
            Path::new("/tmp/note.md")
        ));
        assert!(!active_note_watch_matches(
            &active,
            Path::new("/tmp/other.md")
        ));
    }

    #[test]
    fn dropping_note_watcher_control_stops_the_worker() {
        let (stop, stopped) = channel();
        let active = Some(ActiveNoteWatch {
            path: PathBuf::from("/tmp/note.md"),
            stop,
        });

        drop(active);

        assert!(watcher_was_stopped(&stopped));
    }

    #[test]
    fn closing_the_final_note_explicitly_stops_its_watcher() {
        let (stop, stopped) = channel();
        let mut active = Some(ActiveNoteWatch {
            path: PathBuf::from("/tmp/note.md"),
            stop,
        });

        assert!(stop_active_note_watch(&mut active));
        assert!(active.is_none());
        assert_eq!(stopped.recv_timeout(Duration::from_millis(20)), Ok(()));
        assert!(!stop_active_note_watch(&mut active));
    }

    /// Every menu shortcut, parsed by the parser the menubar really uses.
    ///
    /// An accelerator this crate cannot parse is not a menu item that quietly
    /// loses its shortcut — it fails while the menubar is being built, and the
    /// application comes up with no menus at all. The Linux gate cannot catch
    /// that by construction, so it is caught here, where the parser lives.
    ///
    /// The registry stays the single source of truth: this reads the shortcuts
    /// out of it rather than keeping a second list that could agree with the
    /// grammar while disagreeing with the application.
    #[test]
    fn every_registry_accelerator_parses() {
        use std::str::FromStr;

        let registry = include_str!("../../src/application/commands.ts");
        let accelerators: Vec<&str> = registry
            .split("accelerator: '")
            .skip(1)
            .filter_map(|rest| rest.split('\'').next())
            .collect();

        // A refactor that renames the field must fail loudly rather than
        // silently checking nothing at all.
        assert!(
            accelerators.len() > 20,
            "found only {} accelerators — has commands.ts changed shape?",
            accelerators.len()
        );

        for accelerator in accelerators {
            assert!(
                muda::accelerator::Accelerator::from_str(accelerator).is_ok(),
                "the menubar cannot parse the accelerator {accelerator:?}, so building it would fail"
            );
        }
    }

    #[test]
    fn relative_document_links_follow_the_folder_on_this_device() {
        let directory = tempfile::tempdir().unwrap();
        let note_dir = directory.path().join("notes");
        let shared_dir = directory.path().join("shared");
        fs::create_dir_all(&note_dir).unwrap();
        fs::create_dir_all(&shared_dir).unwrap();
        let note = note_dir.join("index.md");
        let target = shared_dir.join("Decision One.pdf");
        fs::write(&note, b"[Decision](../shared/Decision%20One.pdf)\n").unwrap();
        fs::write(&target, b"pdf").unwrap();

        assert_eq!(
            resolve_document_link(
                &note.to_string_lossy(),
                "../shared/Decision%20One.pdf#page=2"
            )
            .unwrap(),
            ResolvedDocumentLink::Local(target.canonicalize().unwrap())
        );
    }

    #[test]
    fn web_links_remain_web_links() {
        assert_eq!(
            resolve_document_link("/tmp/note.md", "https://example.com/docs?q=1#part").unwrap(),
            ResolvedDocumentLink::External("https://example.com/docs?q=1#part".to_string())
        );
    }

    #[test]
    fn absolute_file_links_are_rejected_as_machine_specific() {
        let error =
            resolve_document_link("/device/notes/note.md", "file:///device-root/secret.pdf")
                .unwrap_err();
        assert!(error.contains("tied to one machine"));
    }

    #[test]
    fn finder_open_accepts_only_local_markdown_paths() {
        let markdown = Url::from_file_path("/tmp/note.markdown").unwrap();
        let uppercase = Url::from_file_path("/tmp/README.MD").unwrap();
        let text = Url::from_file_path("/tmp/note.txt").unwrap();
        let remote = Url::parse("https://example.com/note.md").unwrap();

        assert_eq!(
            opened_markdown_paths(&[markdown, uppercase, text, remote]),
            vec![
                PathBuf::from("/tmp/note.markdown"),
                PathBuf::from("/tmp/README.MD")
            ]
        );
    }

    #[test]
    fn second_instance_arguments_keep_only_markdown_and_resolve_relative_paths() {
        let args = vec![
            "/Applications/SimpleMark.app/Contents/MacOS/simplemark".to_string(),
            "next.md".to_string(),
            "/tmp/also.markdown".to_string(),
            "/tmp/ignore.txt".to_string(),
        ];

        assert_eq!(
            opened_markdown_args(&args, "/tmp/notes"),
            vec![
                PathBuf::from("/tmp/notes/next.md"),
                PathBuf::from("/tmp/also.markdown")
            ]
        );
    }

    #[test]
    fn catalog_lists_only_markdown() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("first.md"), b"# First\n").unwrap();
        fs::write(directory.path().join("second.markdown"), b"# Second\n").unwrap();
        fs::write(directory.path().join("ignore.txt"), b"ignore").unwrap();

        let catalog = workspace_catalog(&directory.path().join("first.md")).unwrap();
        assert_eq!(catalog.notes.len(), 2);
        assert!(catalog.notes.iter().any(|note| note.name == "first.md"));
        assert!(catalog
            .notes
            .iter()
            .any(|note| note.name == "second.markdown"));
    }

    #[test]
    fn explicit_folder_catalog_lists_that_directory_only() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("first.md"), b"# First\n").unwrap();
        fs::write(directory.path().join("ignore.txt"), b"ignore").unwrap();

        let catalog = workspace_catalog_for_directory(directory.path()).unwrap();
        assert_eq!(catalog.handle, directory.path().display().to_string());
        assert_eq!(catalog.notes.len(), 1);
        assert_eq!(catalog.notes[0].name, "first.md");
    }

    #[test]
    fn inspecting_one_note_does_not_adopt_every_markdown_sibling() {
        let directory = tempfile::tempdir().unwrap();
        let opened = directory.path().join("opened.md");
        fs::write(&opened, b"# Opened\n").unwrap();
        fs::write(directory.path().join("unrelated.md"), b"# Unrelated\n").unwrap();

        let catalog = inspected_workspace_note(&opened).unwrap();
        assert_eq!(catalog.notes.len(), 1);
        assert_eq!(catalog.notes[0].name, "opened.md");
    }

    #[test]
    fn create_note_never_overwrites_an_existing_untitled_note() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("Untitled.md"), b"keep me").unwrap();

        let created = create_note(directory.path().display().to_string()).unwrap();
        assert_eq!(created.name, "Untitled 2.md");
        assert_eq!(
            fs::read(directory.path().join("Untitled.md")).unwrap(),
            b"keep me"
        );
        assert_eq!(
            fs::read(directory.path().join("Untitled 2.md")).unwrap(),
            b"# New note\n\n"
        );
    }

    #[test]
    fn new_note_names_are_markdown_filenames_not_paths() {
        assert_eq!(
            markdown_file_name("Project plan").unwrap(),
            "Project plan.md"
        );
        assert_eq!(
            markdown_file_name("Project.markdown").unwrap(),
            "Project.markdown"
        );
        assert!(markdown_file_name("../outside.md").is_err());
        assert!(markdown_file_name("Project.txt").is_err());
    }

    #[test]
    fn first_save_uses_create_new_and_never_replaces_an_existing_note() {
        let directory = tempfile::tempdir().unwrap();
        let destination = directory.path().join("Plan.md");
        fs::write(&destination, b"keep me").unwrap();

        let error = write_new_note(&destination, b"# replacement\n").unwrap_err();

        assert!(error.contains("already exists"));
        assert_eq!(fs::read(&destination).unwrap(), b"keep me");
    }

    #[test]
    fn rename_preserves_bytes_and_refuses_to_replace_an_existing_note() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("draft.md");
        let occupied = directory.path().join("taken.md");
        fs::write(&source, b"# Exact\r\n\r\nbytes").unwrap();
        fs::write(&occupied, b"do not replace").unwrap();

        let collision = match rename_note(source.display().to_string(), "taken".to_string()) {
            Ok(_) => panic!("renaming onto an existing note must fail"),
            Err(error) => error,
        };
        assert!(collision.contains("already exists"));
        assert_eq!(fs::read(&source).unwrap(), b"# Exact\r\n\r\nbytes");
        assert_eq!(fs::read(&occupied).unwrap(), b"do not replace");

        let renamed = rename_note(source.display().to_string(), "renamed".to_string()).unwrap();
        assert_eq!(renamed.name, "renamed.md");
        assert!(!source.exists());
        assert_eq!(
            fs::read(directory.path().join("renamed.md")).unwrap(),
            b"# Exact\r\n\r\nbytes"
        );
    }

    #[test]
    fn duplicate_note_copies_bytes_without_overwriting_prior_copies() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("idea.md");
        fs::write(&source, b"# Exact\r\n\r\nbytes").unwrap();
        fs::write(directory.path().join("idea copy.md"), b"keep me").unwrap();

        let duplicate = duplicate_note(source.display().to_string()).unwrap();

        assert_eq!(duplicate.name, "idea copy 2.md");
        assert_eq!(
            fs::read(directory.path().join("idea copy 2.md")).unwrap(),
            b"# Exact\r\n\r\nbytes"
        );
        assert_eq!(
            fs::read(directory.path().join("idea copy.md")).unwrap(),
            b"keep me"
        );
    }

    #[test]
    fn copy_note_to_copies_bytes_to_a_new_path() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("idea.md");
        fs::write(&source, b"# Exact\r\n\r\nbytes").unwrap();
        let destination = directory.path().join("renamed idea.md");

        let saved = copy_note_to(&source, &destination).unwrap();

        assert_eq!(saved.name, "renamed idea.md");
        assert_eq!(fs::read(&destination).unwrap(), b"# Exact\r\n\r\nbytes");
        assert_eq!(fs::read(&source).unwrap(), b"# Exact\r\n\r\nbytes");
    }

    #[test]
    fn copy_note_to_the_same_path_reads_without_copying() {
        // fs::copy opens the destination for writing before it has finished
        // reading the source, so copying a file onto itself risks truncating
        // it mid-read. The same path must short-circuit instead.
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("idea.md");
        fs::write(&source, b"# Exact\r\n\r\nbytes").unwrap();

        let saved = copy_note_to(&source, &source).unwrap();

        assert_eq!(saved.name, "idea.md");
        assert_eq!(fs::read(&source).unwrap(), b"# Exact\r\n\r\nbytes");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_trash_removes_the_note_without_finder_automation() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("discard.md");
        fs::write(&source, b"disposable").unwrap();

        move_note_to_trash(source.clone()).unwrap();

        assert!(!source.exists());
    }
}
