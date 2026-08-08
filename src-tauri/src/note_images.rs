//! Images a paste brought with it, kept beside the note (ADR-0008).
//!
//! The window's content policy blocks a remote `<img>` and blocks `fetch` to
//! anything but the IPC origin, so an article's pictures can only work if this
//! side fetches them. Everything the webview cannot bound is bounded here: the
//! scheme, the address, the redirect count, the size, and the response type.
//!
//! No cookies and no credentials are ever sent — `reqwest` is built without a
//! cookie store — so this cannot reach anything the person is signed in to.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Write as _;
use std::net::IpAddr;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

/// A note folder is not a download sink.
const MAX_IMAGE_BYTES: u64 = 24 * 1024 * 1024;
/// An image does not need `reqwest`'s default ten.
const MAX_REDIRECTS: usize = 4;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredImage {
    pub src: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedImage {
    /// Base64 so the bytes survive the IPC boundary without being decoded as text.
    pub bytes: String,
    pub media_type: String,
}

/// Stable, cross-process identity for exact bytes. Mirrors `note_preview`.
fn content_digest(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The response types worth writing to disk.
///
/// `image/svg+xml` is deliberately absent: DESIGN.md §7 requires that all SVG
/// pass DOMPurify, there is no sanitiser on this side, and writing unsanitised
/// markup into the person's folder to satisfy a paste is exactly the silent
/// risk §4.4 exists to prevent. An SVG keeps its remote URL instead.
pub fn extension_for_media_type(media_type: &str) -> Option<&'static str> {
    let bare = media_type.split(';').next().unwrap_or_default().trim().to_ascii_lowercase();
    match bare.as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/avif" => Some("avif"),
        "image/bmp" => Some("bmp"),
        "image/x-icon" | "image/vnd.microsoft.icon" => Some("ico"),
        "image/tiff" => Some("tiff"),
        _ => None,
    }
}

fn media_type_for_extension(extension: &str) -> &'static str {
    match extension.to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "tiff" | "tif" => "image/tiff",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// A narrow escape hatch that exists only inside `cargo test`, never in a
/// shipped build: the test suite proves the loopback/private-address refusal
/// with an in-process `TcpListener` that itself binds to `127.0.0.1`, which
/// `is_private_host` correctly refuses. Without this, every "happy path"
/// download test would be indistinguishable from the attack the check
/// exists to stop. Trust is granted to one specific ephemeral port at a
/// time — the OS-assigned port a test's own fixture just bound — never to
/// the host in general, so the dedicated refusal test (which never starts a
/// listener on the low, fixed ports it asserts against) still observes a
/// real refusal.
///
/// Trust is keyed on `(host, port)`, not port alone: every fixture binds the
/// literal string `"127.0.0.1"`, so that is the only host this ever admits.
/// A port-only registry would let a redirect to, say,
/// `http://192.168.1.4:<a-trusted-port>/` slip through in a test binary —
/// narrower is better for an escape hatch sitting inside a security check,
/// even though nothing outside `cargo test` can reach this code at all.
#[cfg(not(test))]
mod trusted_loopback {
    pub fn is_trusted(_host: Option<&str>, _port: Option<u16>) -> bool {
        false
    }
}

#[cfg(test)]
mod trusted_loopback {
    use std::collections::HashSet;
    use std::sync::{Mutex, OnceLock};

    const FIXTURE_HOST: &str = "127.0.0.1";

    fn ports() -> &'static Mutex<HashSet<u16>> {
        static PORTS: OnceLock<Mutex<HashSet<u16>>> = OnceLock::new();
        PORTS.get_or_init(|| Mutex::new(HashSet::new()))
    }

    pub fn trust(port: u16) {
        ports().lock().expect("trusted port set poisoned").insert(port);
    }

    pub fn is_trusted(host: Option<&str>, port: Option<u16>) -> bool {
        host.is_some_and(|host| host == FIXTURE_HOST)
            && port.is_some_and(|port| ports().lock().expect("trusted port set poisoned").contains(&port))
    }
}

/// Pasted HTML is untrusted input; it may not aim the app at the person's own
/// network. Literal addresses only — this does not resolve DNS, so a hostname
/// pointing at a private address still reaches it. A documented limit.
fn is_private_host(host: &str) -> bool {
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    // A trailing dot is the root label in a fully-qualified name — DNS
    // treats "localhost." exactly as "localhost" — and macOS additionally
    // resolves any `*.localhost` name to loopback (RFC 6761 §6.3 reserves
    // the whole label for that). Neither form needs to be exotic to matter:
    // both are one character away from the plain name already checked.
    let bare = bare.strip_suffix('.').unwrap_or(bare);
    let lower = bare.to_ascii_lowercase();
    if lower == "localhost" || lower == "localhost.localdomain" || lower.ends_with(".localhost") {
        return true;
    }
    match bare.parse::<IpAddr>() {
        Ok(IpAddr::V4(address)) => is_private_v4(address),
        Ok(IpAddr::V6(address)) => {
            // A literal IPv6 address can still *name* an IPv4 address, in
            // several fixed, well-known encodings; the v4 rules must apply
            // to the address a socket would actually reach, or each of
            // these is a free pass around every v4 check above (`url::Url`
            // does not spell any of them back out as plain `a.b.c.d` in
            // `host_str`, so none would otherwise reach the V4 arm).
            if let Some(embedded) = ipv4_embedded_in_v6(&address) {
                return is_private_v4(embedded);
            }
            // Not attempted: IPv6-to-IPv4 tunnelling variants beyond these
            // fixed, well-known prefixes, and anything that would need more
            // than the address's own bits to resolve (a routing table, a
            // resolver) — that is out of scope for the same reason DNS
            // resolution is, per the function doc above.
            address.is_loopback()
                || address.is_unspecified()
                // Unique-local (fc00::/7) and link-local (fe80::/10).
                || matches!(address.segments()[0] & 0xfe00, 0xfc00)
                || matches!(address.segments()[0] & 0xffc0, 0xfe80)
        }
        Err(_) => false,
    }
}

fn is_private_v4(address: std::net::Ipv4Addr) -> bool {
    address.is_loopback()
        || address.is_private()
        || address.is_link_local()
        || address.is_unspecified()
        || address.is_broadcast()
}

/// Unwraps an IPv4 address literally encoded inside an IPv6 one, across the
/// handful of fixed, well-known prefixes that do this. Each is cheap to
/// recognise — a match on the address's own 16-bit groups, no lookup table —
/// so there is no reason to leave any of them unhandled just because reaching
/// one in practice needs a NAT64 gateway, a 6to4 relay, or a Teredo tunnel.
fn ipv4_embedded_in_v6(address: &std::net::Ipv6Addr) -> Option<std::net::Ipv4Addr> {
    // IPv4-mapped, `::ffff:a.b.c.d` (RFC 4291 §2.5.5.2) — the modern, common
    // form. `Ipv6Addr` has a dedicated method for this one.
    if let Some(mapped) = address.to_ipv4_mapped() {
        return Some(mapped);
    }
    match address.segments() {
        // Deprecated IPv4-compatible, `::a.b.c.d` (RFC 4291 §2.5.5.1). `::`
        // and `::1` fit this same all-zero-prefix bit pattern, but RFC 4291
        // itself carves those two values out as the unspecified and
        // loopback addresses rather than this form, so they are excluded
        // here and left for the plain `is_unspecified`/`is_loopback` checks
        // below.
        [0, 0, 0, 0, 0, 0, hi, lo] if (hi, lo) != (0, 0) && (hi, lo) != (0, 1) => {
            Some(v4_from_halves(hi, lo))
        }
        // NAT64 well-known prefix, `64:ff9b::/96` (RFC 6052).
        [0x0064, 0xff9b, 0, 0, 0, 0, hi, lo] => Some(v4_from_halves(hi, lo)),
        // 6to4, `2002:V4ADDR::/48` (RFC 3056) — the embedded address is the
        // prefix itself, plain, not obfuscated.
        [0x2002, hi, lo, ..] => Some(v4_from_halves(hi, lo)),
        // Teredo, `2001:0000::/32` (RFC 4380) — the client's real address
        // sits in the low 32 bits, bitwise-complemented so that a NAT
        // device rewriting an embedded literal IPv4 address in transit
        // cannot silently corrupt the tunnel.
        [0x2001, 0, _, _, _, _, hi, lo] => Some(v4_from_halves(!hi, !lo)),
        _ => None,
    }
}

fn v4_from_halves(hi: u16, lo: u16) -> std::net::Ipv4Addr {
    std::net::Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8)
}

/// The folder the note lives in. A handle that is not an existing file is one
/// of the shell's display strings ("Not saved"), not a path.
fn note_directory(document_handle: &str) -> Result<PathBuf, String> {
    let note = Path::new(document_handle);
    if !note.is_file() {
        return Err("This note has not been saved yet, so there is no folder to keep images in.".into());
    }
    note.parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "This note has no containing folder.".to_string())
}

/// The same rule the browser asset adapter states: note-relative, no escape.
fn resolve_beside_note(document_handle: &str, href: &str) -> Result<PathBuf, String> {
    const REFUSAL: &str = "An image reference must name a file beside the note.";
    let candidate = href.trim();
    if candidate.is_empty()
        || candidate.starts_with('/')
        || candidate.starts_with('~')
        || candidate.contains('\\')
        || candidate.contains(':')
    {
        return Err(REFUSAL.into());
    }
    let relative = Path::new(candidate);
    if relative.components().any(|component| !matches!(component, Component::Normal(_))) {
        return Err(REFUSAL.into());
    }
    Ok(note_directory(document_handle)?.join(relative))
}

/// Whether a URL is one this shell may fetch: http(s) scheme, and a host that
/// is neither loopback nor a private range (or the test suite's own throwaway
/// fixture — see `trusted_loopback`). Shared between the initial request and
/// every redirect hop, because a bound checked once on the URL a person
/// pasted and never again is a bound a compromised or malicious host can
/// route straight through with a 302.
fn is_fetchable(url: &reqwest::Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && !(url.host_str().is_some_and(is_private_host)
            && !trusted_loopback::is_trusted(url.host_str(), url.port()))
}

/// `Policy::limited` only counts hops; it does not look at where they lead.
/// A response from a host this app was allowed to ask can still answer with
/// `Location: http://169.254.169.254/...`, and reqwest would follow that
/// without this policy — silently turning the one-time host check on the
/// pasted URL into no check at all after the first hop. Every redirect
/// target is held to the same scheme and address rules as the original URL.
fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            // Mirrors `Policy::limited`'s own counting: `previous()` holds the
            // initial URL plus each redirect already followed, so this errors
            // on the attempt that would be the fifth hop, letting exactly
            // `MAX_REDIRECTS` (4) redirects through — matching the "at most 4
            // redirects" bound `Policy::limited(MAX_REDIRECTS)` used to give us
            // before this policy also had to check where each hop leads.
            if attempt.previous().len() > MAX_REDIRECTS {
                return attempt.error("Too many redirects while downloading the image.");
            }
            if !is_fetchable(attempt.url()) {
                return attempt.error("Redirected to an address this app will not fetch.");
            }
            attempt.follow()
        }))
        .build()
        .map_err(|error| format!("Could not prepare the image download: {error}"))
}

/// Downloads one image into `<note folder>/assets/`, named by its content hash.
///
/// Every refusal is an ordinary `Err` the shell shows verbatim; the caller
/// keeps the remote URL, visibly unchanged, rather than reporting a success it
/// did not have.
#[tauri::command]
pub async fn download_note_image(
    document_handle: String,
    url: String,
) -> Result<StoredImage, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| format!("That image address is not a URL: {url}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("Only http and https images are downloaded, not {}.", parsed.scheme()));
    }
    if parsed.host_str().is_some_and(is_private_host)
        && !trusted_loopback::is_trusted(parsed.host_str(), parsed.port())
    {
        return Err("That image is on a private address, so it was not downloaded.".into());
    }

    // Resolve the destination before spending a request on it.
    let assets = note_directory(&document_handle)?.join("assets");

    let response = http_client()?
        .get(parsed)
        .send()
        .await
        .map_err(|error| format!("Could not download the image: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("The image server answered {}.", response.status()));
    }

    let media_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let extension = extension_for_media_type(&media_type)
        .ok_or_else(|| format!("That address is not an image this app stores ({media_type})."))?;

    if response.content_length().is_some_and(|length| length > MAX_IMAGE_BYTES) {
        return Err("That image is too large to keep beside the note.".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Could not read the image: {error}"))?;
    if bytes.len() as u64 > MAX_IMAGE_BYTES {
        return Err("That image is too large to keep beside the note.".into());
    }

    let digest = content_digest(&bytes);
    let name = format!("{}.{extension}", &digest[..16]);
    let destination = assets.join(&name);
    let src = format!("assets/{name}");

    // Identical bytes are one file: a second paste of the same picture writes
    // nothing and reuses the reference.
    if destination.exists() {
        return Ok(StoredImage { src });
    }

    std::fs::create_dir_all(&assets)
        .map_err(|error| format!("Could not create the assets folder: {error}"))?;

    // Same pattern as `save_note` in `lib.rs`: write to a temp file beside
    // the destination, fsync, then rename into place. Without this, a crash
    // or power loss mid-write can leave a truncated file sitting under the
    // final content-hash name — and the `destination.exists()` dedup check
    // above would then treat that partial file as a complete download
    // forever, serving a corrupt image on every read with no way for a
    // re-paste to ever repair it (identical bytes reuse the "existing" file
    // rather than rewriting it).
    let temp = assets.join(format!(".{name}.simplemark-tmp"));
    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, &destination)
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("Could not save the image: {error}"));
    }
    Ok(StoredImage { src })
}

/// Reads a note-relative image so the editor can show it under a policy that
/// admits `blob:` but not the filesystem.
#[tauri::command]
pub fn read_note_asset(document_handle: String, href: String) -> Result<LoadedImage, String> {
    let path = resolve_beside_note(&document_handle, &href)?;
    let bytes = std::fs::read(&path).map_err(|error| format!("Could not read {href}: {error}"))?;
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or_default();
    Ok(LoadedImage {
        bytes: BASE64.encode(bytes),
        media_type: media_type_for_extension(extension).to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    /// Binds a one-shot HTTP server on an OS-assigned loopback port and
    /// returns the base URL it is listening on, alongside the port itself.
    fn bind_and_serve(response: Vec<u8>) -> (String, u16) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut discard = [0_u8; 1024];
                let _ = stream.read(&mut discard);
                let _ = stream.write_all(&response);
            }
        });
        (format!("http://127.0.0.1:{port}"), port)
    }

    /// A one-shot HTTP server whose port is registered as trusted, so a
    /// direct download from it is not mistaken for the attack
    /// `trusted_loopback` exists to let past. Returns the base URL.
    fn serve(response: Vec<u8>) -> String {
        let (base, port) = bind_and_serve(response);
        // This fixture's own loopback address must not trip the private-address
        // refusal under test — see `trusted_loopback`. The refusal itself is
        // still exercised by `pasted_html_cannot_aim_the_app_at_a_private_address`,
        // which asserts against fixed ports this fixture never binds.
        trusted_loopback::trust(port);
        base
    }

    /// A one-shot HTTP server whose port is deliberately left *untrusted* —
    /// for the one test that needs to prove a redirect destination is
    /// refused on its own merits, not because the fixture serving it asked
    /// to be trusted. See `a_redirect_cannot_be_used_to_reach_a_private_address`.
    fn serve_untrusted(response: Vec<u8>) -> String {
        bind_and_serve(response).0
    }

    fn png_response(body: &[u8]) -> Vec<u8> {
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(body);
        response
    }

    fn note_in_temp_dir() -> (tempfile::TempDir, String) {
        let dir = tempfile::tempdir().expect("tempdir");
        let note = dir.path().join("note.md");
        std::fs::write(&note, b"# Note\n").expect("write note");
        let handle = note.display().to_string();
        (dir, handle)
    }

    #[test]
    fn extension_comes_from_the_content_type() {
        assert_eq!(extension_for_media_type("image/png"), Some("png"));
        assert_eq!(extension_for_media_type("image/jpeg; charset=binary"), Some("jpg"));
        assert_eq!(extension_for_media_type("IMAGE/WEBP"), Some("webp"));
        assert_eq!(extension_for_media_type("image/avif"), Some("avif"));
    }

    #[test]
    fn svg_is_refused_because_nothing_here_can_sanitise_it() {
        assert_eq!(extension_for_media_type("image/svg+xml"), None);
        assert_eq!(extension_for_media_type("text/html"), None);
    }

    #[test]
    fn a_download_lands_in_assets_named_by_its_content_hash() {
        let (dir, handle) = note_in_temp_dir();
        let base = serve(png_response(b"fake-png-bytes"));

        let stored = tauri::async_runtime::block_on(download_note_image(handle, format!("{base}/a.png")))
            .expect("download");

        let digest = content_digest(b"fake-png-bytes");
        assert_eq!(stored.src, format!("assets/{}.png", &digest[..16]));
        assert!(dir.path().join(&stored.src).exists());
    }

    #[test]
    fn identical_bytes_reuse_one_file() {
        let (dir, handle) = note_in_temp_dir();
        let first = serve(png_response(b"same-bytes"));
        let second = serve(png_response(b"same-bytes"));

        let a = tauri::async_runtime::block_on(download_note_image(handle.clone(), format!("{first}/a.png")))
            .expect("first");
        let b = tauri::async_runtime::block_on(download_note_image(handle, format!("{second}/b.png")))
            .expect("second");

        assert_eq!(a.src, b.src);
        let entries = std::fs::read_dir(dir.path().join("assets")).expect("read assets").count();
        assert_eq!(entries, 1);
    }

    #[test]
    fn a_non_image_response_is_refused_and_writes_nothing() {
        let (dir, handle) = note_in_temp_dir();
        let base = serve(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 5\r\n\r\nhello".to_vec(),
        );

        let error = tauri::async_runtime::block_on(download_note_image(handle, format!("{base}/a.png")))
            .expect_err("refusal");

        assert!(error.contains("not an image"), "{error}");
        assert!(!dir.path().join("assets").exists());
    }

    #[test]
    fn a_redirect_cannot_be_used_to_reach_a_private_address() {
        // The private-address refusal is checked once, up front, on the URL a
        // person pasted. A compromised or malicious public host must not be
        // able to hand that check right back with a redirect.
        //
        // The redirect target below is a second, real loopback fixture that
        // answers with a genuine PNG — but its port was never registered
        // with `trusted_loopback`. If the per-hop re-check in `http_client`
        // were ever deleted, `reqwest` would simply follow the redirect,
        // fetch that PNG, and this would return `Ok`, not `Err`: the point
        // is that this test fails loudly on that regression rather than
        // passing either way. (A URL that nothing answers, like
        // `169.254.169.254`, cannot tell a refusal apart from a connection
        // that was merely attempted and failed — both produce the same
        // "Could not download" wrapper — so it would not have caught this.)
        let (_dir, handle) = note_in_temp_dir();
        let target = serve_untrusted(png_response(b"attacker-controlled-bytes"));
        let base = serve(
            format!("HTTP/1.1 302 Found\r\nLocation: {target}/evil.png\r\nContent-Length: 0\r\n\r\n").into_bytes(),
        );

        let error = tauri::async_runtime::block_on(download_note_image(handle, format!("{base}/a.png")))
            .expect_err("refusal");

        assert!(error.contains("Could not download"), "{error}");
    }

    #[test]
    fn an_oversized_response_is_refused() {
        let (_dir, handle) = note_in_temp_dir();
        let body = vec![0_u8; 64];
        let mut response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\n\r\n",
            MAX_IMAGE_BYTES + 1
        )
        .into_bytes();
        response.extend_from_slice(&body);
        let base = serve(response);

        let error = tauri::async_runtime::block_on(download_note_image(handle, format!("{base}/a.png")))
            .expect_err("refusal");

        assert!(error.contains("too large"), "{error}");
    }

    #[test]
    fn only_http_urls_are_fetched() {
        let (_dir, handle) = note_in_temp_dir();
        for url in ["file:///etc/passwd", "data:image/png;base64,AAAA", "ftp://example.com/a.png"] {
            let error = tauri::async_runtime::block_on(download_note_image(handle.clone(), url.to_string()))
                .expect_err("refusal");
            assert!(error.contains("http"), "{url}: {error}");
        }
    }

    #[test]
    fn pasted_html_cannot_aim_the_app_at_a_private_address() {
        let (_dir, handle) = note_in_temp_dir();
        for url in [
            "http://localhost:8080/a.png",
            "http://127.0.0.1/a.png",
            "http://10.0.0.5/a.png",
            "http://192.168.1.4/a.png",
            "http://169.254.169.254/latest/meta-data",
            "http://[::1]/a.png",
            // IPv4-mapped IPv6 notation for the same loopback address; a
            // literal-address check that only inspects `IpAddr::V6` bits
            // without unwrapping this would wave it straight through.
            "http://[::ffff:127.0.0.1]/a.png",
            // A trailing root-label dot and the reserved `*.localhost`
            // suffix both still resolve to loopback.
            "http://localhost./a.png",
            "http://sub.localhost/a.png",
            // Deprecated IPv4-compatible IPv6 for 127.0.0.1 (RFC 4291 §2.5.5.1).
            "http://[::7f00:1]/a.png",
            // NAT64 well-known prefix (RFC 6052) embedding 10.0.0.5.
            "http://[64:ff9b::a00:5]/a.png",
            // 6to4 (RFC 3056) embedding 192.168.1.4.
            "http://[2002:c0a8:104::]/a.png",
            // Teredo (RFC 4380): the low 32 bits are 10.0.0.5, complemented.
            "http://[2001::f5ff:fffa]/a.png",
        ] {
            let error = tauri::async_runtime::block_on(download_note_image(handle.clone(), url.to_string()))
                .expect_err("refusal");
            assert!(error.contains("private"), "{url}: {error}");
        }
    }

    #[test]
    fn a_note_that_is_not_a_file_has_no_folder_to_write_beside() {
        let base = serve(png_response(b"bytes"));
        let error = tauri::async_runtime::block_on(download_note_image(
            "Not saved".to_string(),
            format!("{base}/a.png"),
        ))
        .expect_err("refusal");
        assert!(error.contains("saved"), "{error}");
    }

    #[test]
    fn an_asset_reads_back_with_its_media_type() {
        let (dir, handle) = note_in_temp_dir();
        std::fs::create_dir_all(dir.path().join("assets")).expect("mkdir");
        std::fs::write(dir.path().join("assets/a.png"), b"png-bytes").expect("write");

        let loaded = read_note_asset(handle, "assets/a.png".to_string()).expect("read");

        assert_eq!(BASE64.decode(loaded.bytes).expect("decode"), b"png-bytes");
        assert_eq!(loaded.media_type, "image/png");
    }

    #[test]
    fn an_asset_href_may_not_leave_the_note_folder() {
        let (_dir, handle) = note_in_temp_dir();
        for href in ["../outside.png", "/etc/passwd", "~/secret.png", "https://example.com/a.png"] {
            let error = read_note_asset(handle.clone(), href.to_string()).expect_err("refusal");
            assert!(error.contains("beside the note"), "{href}: {error}");
        }
    }
}
