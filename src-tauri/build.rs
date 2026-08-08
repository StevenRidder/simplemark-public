use std::path::Path;
use std::process::Command;

/// Build provenance (APP-22).
///
/// An installed bundle carries no other evidence of which commit produced it:
/// `CFBundleShortVersionString` is `0.1.0` on every build this project has ever
/// made, so "does this app contain that merge?" has until now been answered by
/// reading the bundle's file timestamp and hoping. These two values make it a
/// fact you can read instead.
///
/// `SIMPLEMARK_BUILD_SHA` may be supplied by the caller, and
/// `scripts/install-main.sh` always does. That is deliberate rather than
/// redundant: this script's working directory is one checkout among many on a
/// machine that carries a worktree per task, and the installer's whole promise
/// is that the bundle came from `origin/main` specifically. Letting the caller
/// state the commit keeps the promise with the one who can actually prove it,
/// and `rerun-if-env-changed` means a different commit forces a real rebuild
/// rather than reusing an artifact stamped with the previous one.
///
/// A local build has no such caller, so it depends entirely on `watch_paths`
/// noticing that HEAD moved. See that function for why the old watch list was
/// silently empty in a worktree, and what it cost.
///
/// `unknown` is an expected value, not a failure being papered over. A build
/// from a source archive has no git metadata at all, and a bundle that names a
/// commit it could not read would be worse than one that admits it has none.
fn main() {
    println!("cargo:rustc-env=SIMPLEMARK_BUILD_SHA={}", resolve_sha());
    println!("cargo:rustc-env=SIMPLEMARK_BUILD_TIME={}", build_time());
    println!(
        "cargo:rustc-env=SIMPLEMARK_BUILD_REPOSITORY={}",
        resolve_repository()
    );

    println!("cargo:rerun-if-env-changed=SIMPLEMARK_BUILD_SHA");
    println!("cargo:rerun-if-env-changed=SIMPLEMARK_BUILD_REPOSITORY");
    for path in watch_paths() {
        println!("cargo:rerun-if-changed={path}");
    }

    build_intelligence_bridge();

    tauri_build::build()
}

/// Compiles the Foundation Models bridge and links it into this binary.
///
/// Apple silicon macOS only. Apple Intelligence requires Apple silicon, so the
/// x86_64 leg is not a gap to fill later — the feature genuinely cannot exist
/// there, and gating on the architecture keeps that leg building untouched.
///
/// A missing or too-old Swift toolchain is not a build failure. It sets no
/// `simplemark_intelligence` cfg, the Rust side compiles its unavailable path,
/// and the app ships with extracted previews only — the same outcome as a Mac
/// with Apple Intelligence switched off.
fn build_intelligence_bridge() {
    println!("cargo:rerun-if-changed=swift/SimpleMarkIntelligence.swift");
    println!("cargo:rustc-check-cfg=cfg(simplemark_intelligence)");
    println!("cargo:rerun-if-env-changed=SIMPLEMARK_REQUIRE_INTELLIGENCE");

    // Degrading quietly is right for a contributor on an older Mac and wrong
    // for a release: a green build that silently dropped a capability is
    // exactly how the Graphviz CSP defect shipped. The caller that can promise
    // the toolchain is the one that says so, the same way
    // `SIMPLEMARK_BUILD_SHA` works.
    let required = supplied("SIMPLEMARK_REQUIRE_INTELLIGENCE")
        .is_some_and(|value| value != "0" && !value.eq_ignore_ascii_case("false"));

    let target = std::env::var("TARGET").unwrap_or_default();
    if !target.starts_with("aarch64-apple-darwin") {
        assert!(
            !required,
            "SIMPLEMARK_REQUIRE_INTELLIGENCE is set but TARGET is {target}. \
             Foundation Models needs aarch64-apple-darwin; set it only on that leg."
        );
        return;
    }

    let Ok(out_dir) = std::env::var("OUT_DIR") else {
        return;
    };

    let refuse = |reason: &str| {
        assert!(
            !required,
            "SIMPLEMARK_REQUIRE_INTELLIGENCE is set but the Foundation Models \
             bridge cannot be built: {reason}. This build would ship a macOS \
             app with note summaries silently missing."
        );
        println!("cargo:warning={reason}; note summaries disabled");
    };

    // FoundationModels ships in the macOS 26 SDK. An older SDK compiles every
    // other file in this crate perfectly well, so probe rather than assume.
    let sdk = match run("xcrun", &["--show-sdk-version"]) {
        Some(version) => version,
        None => {
            refuse("no macOS SDK found");
            return;
        }
    };
    let major: u32 = sdk.split('.').next().unwrap_or("0").parse().unwrap_or(0);
    if major < 26 {
        refuse(&format!("macOS SDK {sdk} predates FoundationModels"));
        return;
    }

    let library = format!("{out_dir}/libSimpleMarkIntelligence.a");
    let compiled = Command::new("swiftc")
        .args([
            "-O",
            "-target",
            "arm64-apple-macosx26.0",
            "-emit-library",
            "-static",
            "-module-name",
            "SimpleMarkIntelligence",
            "-o",
            &library,
            "swift/SimpleMarkIntelligence.swift",
        ])
        .status()
        .map(|status| status.success())
        .unwrap_or(false);

    if !compiled {
        refuse("swiftc failed");
        return;
    }

    println!("cargo:rustc-link-search=native={out_dir}");
    println!("cargo:rustc-link-lib=static=SimpleMarkIntelligence");
    // The Swift runtime the static library depends on.
    println!("cargo:rustc-link-search=native=/usr/lib/swift");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rustc-cfg=simplemark_intelligence");
}

/// Files whose change must force this script to run again.
///
/// This list used to be the literal `../.git/HEAD`, which did nothing at all in
/// a linked worktree: there `.git` is a *file* naming the real gitdir, so the
/// path never exists, no watch is registered, and cargo serves the cached build
/// script output forever — stamping every later build with whichever commit
/// happened to be checked out for the first one. This machine carries a worktree
/// per task, so that was the ordinary case rather than the exotic one, and it
/// produced a bundle that reported a commit it did not contain.
///
/// `git rev-parse --git-path` answers correctly for both layouts and routes
/// per-worktree files (`HEAD`) apart from shared ones (`refs/`) on its own,
/// which is the part that is easy to get wrong by hand.
///
/// The branch tip is watched too. HEAD on a branch is a symref, so committing on
/// the branch you are already on moves the ref while HEAD's own bytes stay put —
/// the case the previous comment called out as unreachable. It is reachable; it
/// just needed asking git for the name first. A packed ref has no file to watch,
/// and `exists` drops it rather than registering a path that will never change.
fn watch_paths() -> Vec<String> {
    let mut paths: Vec<String> = ["HEAD", "ORIG_HEAD"]
        .iter()
        .filter_map(|name| git_path(name))
        .collect();

    if let Some(reference) = git(&["symbolic-ref", "--quiet", "HEAD"]) {
        if let Some(tip) = git_path(&reference) {
            paths.push(tip);
        }
    }

    paths
}

/// Where git keeps `name` for *this* working tree, if it is a file on disk.
fn git_path(name: &str) -> Option<String> {
    let path = git(&["rev-parse", "--git-path", name])?;
    Path::new(&path).exists().then_some(path)
}

fn resolve_sha() -> String {
    if let Some(supplied) = supplied("SIMPLEMARK_BUILD_SHA") {
        return supplied;
    }
    git(&["rev-parse", "HEAD"]).unwrap_or_else(|| "unknown".to_string())
}

/// UTC, second resolution, no added dependency. `date` is POSIX and this build
/// already requires a shell toolchain to exist.
fn build_time() -> String {
    if let Some(supplied) = supplied("SIMPLEMARK_BUILD_TIME") {
        return supplied;
    }
    run("date", &["-u", "+%Y-%m-%dT%H:%M:%SZ"]).unwrap_or_else(|| "unknown".to_string())
}

/// Which repository this build should ask about updates, as `owner/name`.
///
/// Read from the build's own `origin` rather than written into the source. The
/// canonical repository is private, and `scripts/mirror` refuses to publish any
/// source naming it — so a constant would either leak the private identity into
/// the public mirror or have to be wrong there. Reading the remote is also the
/// behaviour a fork wants: it checks itself, with no configuration, and the
/// public mirror checks the public mirror.
///
/// `unknown` when there is no git, no remote, or an unrecognised URL shape. The
/// update check then reports that it cannot run rather than guessing a target.
fn resolve_repository() -> String {
    if let Some(supplied) = supplied("SIMPLEMARK_BUILD_REPOSITORY") {
        return supplied;
    }
    git(&["remote", "get-url", "origin"])
        .and_then(|url| normalise_repository(&url))
        .unwrap_or_else(|| "unknown".to_string())
}

/// `owner/name` from either remote form, HTTPS or SSH.
fn normalise_repository(url: &str) -> Option<String> {
    let without_suffix = url.trim().strip_suffix(".git").unwrap_or(url.trim());
    // `git@host:owner/name` and `https://host/owner/name` both end in the two
    // segments we want, so take them from the end rather than parsing the host.
    let tail = without_suffix
        .rsplit(['/', ':'])
        .take(2)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>();
    if tail.len() != 2 || tail.iter().any(|part| part.is_empty()) {
        return None;
    }
    Some(tail.join("/"))
}

fn supplied(name: &str) -> Option<String> {
    let value = std::env::var(name).ok()?.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn git(args: &[&str]) -> Option<String> {
    run("git", args)
}

fn run(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}
