#!/usr/bin/env bash
# Install a SimpleMark built from origin/main (APP-22).
#
# The problem this solves: several agents merge into main continuously, and the
# installed bundle version is 0.1.0 forever, so "does my app have that merge?"
# had no answer except the bundle's file timestamp. This builds the exact commit
# origin/main points at, stamps that commit into the app, and installs it.
#
# Two rules shape everything here:
#
# * Build the commit, not the checkout. This machine carries a worktree per
#   task, each on a different branch with its own uncommitted work. Building
#   "here" would produce a bundle nobody can identify. A detached worktree at
#   the resolved SHA is the only source that can honestly be called main.
# * Never destroy a working app for a build that did not happen. The existing
#   bundle is replaced only after a new one exists and has been verified, so a
#   failed compile, an absent toolchain, or a full disk leaves you with the app
#   you already had.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="${SIMPLEMARK_INSTALL_DIR:-/Applications}"
TARGET="$TARGET_DIR/SimpleMark.app"
REMOTE="${SIMPLEMARK_REMOTE:-origin}"
REF="${SIMPLEMARK_REF:-$REMOTE/main}"
BUILD_DIR=""

die() {
  echo "install-main: $*" >&2
  exit 1
}

note() {
  echo "install-main: $*"
}

cleanup() {
  if [ -n "$BUILD_DIR" ] && [ -d "$BUILD_DIR" ]; then
    git -C "$ROOT" worktree remove --force "$BUILD_DIR" >/dev/null 2>&1 || rm -rf "$BUILD_DIR"
  fi
}
trap cleanup EXIT

# The rustup shims are missing on this machine (~/.cargo/bin does not exist),
# so `cargo` is frequently absent from PATH even though a toolchain is
# installed. Find it, and if there genuinely is none, say the fix rather than
# letting `npm run build:native` fail with a bare "command not found".
ensure_cargo() {
  if command -v cargo >/dev/null 2>&1; then
    return
  fi
  local candidate
  for candidate in "$HOME"/.cargo/bin "$HOME"/.rustup/toolchains/*/bin; do
    if [ -x "$candidate/cargo" ]; then
      PATH="$candidate:$PATH"
      export PATH
      note "using cargo at $candidate/cargo (rustup shims are not on PATH)"
      return
    fi
  done
  die "cargo not found. Install Rust, or run 'rustup default stable' to restore the shims."
}

require_tools() {
  command -v git >/dev/null 2>&1 || die "git is required"
  command -v npm >/dev/null 2>&1 || die "npm is required"
  command -v ditto >/dev/null 2>&1 || die "ditto is required (macOS)"
}

# Replacing the bundle under a running app corrupts the process using it.
#
# Scoped to the bundle actually being replaced rather than to any SimpleMark
# anywhere: a build running out of a worktree, or an install staged into a
# different directory, threatens nothing here, and a refusal that fires when
# nothing is at risk is the kind that gets worked around.
refuse_if_running() {
  if pgrep -f "^${TARGET}/Contents/MacOS/simplemark" >/dev/null 2>&1; then
    die "$TARGET is running. Quit it first — replacing a running bundle corrupts it."
  fi
}

require_tools
ensure_cargo
refuse_if_running

note "fetching $REMOTE"
git -C "$ROOT" fetch "$REMOTE" --quiet || die "could not fetch $REMOTE"

SHA="$(git -C "$ROOT" rev-parse "$REF")" || die "could not resolve $REF"
note "building $REF at $SHA"

BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/simplemark-main-build.XXXXXX")"
rm -rf "$BUILD_DIR"
git -C "$ROOT" worktree add --detach "$BUILD_DIR" "$SHA" >/dev/null 2>&1 \
  || die "could not create a clean build worktree at $SHA"

# Confirm the build source really is that commit and carries nothing else. A
# stray file here would end up in a bundle stamped as a commit it is not.
built_sha="$(git -C "$BUILD_DIR" rev-parse HEAD)"
[ "$built_sha" = "$SHA" ] || die "build worktree is at $built_sha, expected $SHA"
[ -z "$(git -C "$BUILD_DIR" status --porcelain)" ] || die "build worktree is not clean"

( cd "$BUILD_DIR" && npm ci --no-audit --no-fund >/dev/null 2>&1 ) || die "npm ci failed"
( cd "$BUILD_DIR" && SIMPLEMARK_BUILD_SHA="$SHA" npm run build:native ) || die "native build failed"

BUNDLE="$BUILD_DIR/src-tauri/target/release/bundle/macos/SimpleMark.app"
[ -d "$BUNDLE" ] || die "the build reported success but produced no bundle at $BUNDLE"
[ -x "$BUNDLE/Contents/MacOS/simplemark" ] || die "the bundle has no executable"

# Stage beside the target first: a copy that fails midway must not be the thing
# that replaced your working app.
STAGED="$TARGET_DIR/.SimpleMark.app.install-main.$$"
rm -rf "$STAGED"
ditto "$BUNDLE" "$STAGED" || { rm -rf "$STAGED"; die "could not stage the new bundle into $TARGET_DIR"; }

refuse_if_running
rm -rf "$TARGET"
mv "$STAGED" "$TARGET" || die "could not move the staged bundle into place"

note "installed $TARGET"
note "commit $SHA"
note "verify in the app: About SimpleMark shows commit ${SHA:0:7}"
