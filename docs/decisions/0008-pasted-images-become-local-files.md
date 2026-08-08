# ADR-0008: Pasted images become local files, fetched by the app's own narrow command

- **Status:** Accepted
- **Date:** 2026-08-08
- **Decision owners:** SimpleMark maintainers

## Context

Pasting an article from a browser takes the HTML path (`DESIGN.md` §4.2), which faithfully preserves
headings, marks, lists, tables — and `<img>` elements whose `src` is a remote CDN URL. That reference is
then written into the `.md` file verbatim.

Three things are wrong with leaving it there.

1. **It does not render in the packaged app.** The window's content policy is
   `img-src 'self' data: blob: asset: http://asset.localhost`. A remote image resolves to nothing and the
   note shows `File unavailable:` where the picture should be.
2. **The note is not portable.** It depends on a content-delivery host that can rewrite the URL, expire it,
   or require a session. `DESIGN.md` §5 tier 1 asks that a note keep working as an ordinary Markdown file;
   an image that only exists on someone else's server does not meet that.
3. **It is not what the person asked for.** They pasted an article. An article has its pictures.

Fixing it means the app fetches something from the network on the person's behalf. Until now, SimpleMark's
only outbound request has been the diagram "Fix it" call: unreachable until an API key is configured in
Settings and a button is clicked. `RENDERERS.md` already named the boundary this crosses — consent-gated
remote data "would be the app's first *implicit*, automatic network access" — and asked for a decision
before anything took that step.

There is also a mechanical gap. Even with the bytes on disk, **there is no working relative-image path in
the packaged app today**: no asset protocol is registered, no filesystem plugin is enabled, and
`assets/x.png` resolves against the bundled frontend rather than the note's folder. The `asset:` term in
the content policy is currently inert.

## Decision

**A rich-HTML paste that references remote images downloads them into an `assets/` folder beside the note
and rewrites each reference to a standard relative Markdown link. The fetch is performed by one narrow,
bounded command in the Rust shell. The paste itself is the consent.**

1. **The paste is the gesture.** No preference, no prompt, no Allow/Ask/Block. The person performed an
   explicit action on content they chose, and the request goes only to hosts that content already named.
   A prompt on every paste would train people to dismiss it, and a preference would be a setting almost
   nobody would find before their first article looked broken. This is narrower than the email-client
   analogy that prompted the question: SimpleMark does not display untrusted documents it did not import.
2. **The fetch lives in Rust, and is bounded there.** `http`/`https` only; no cookies and no credentials;
   at most 4 redirects; a 24 MB ceiling; a response-type allowlist of raster image types; and a refusal
   for literal loopback and private-range hosts, so pasted content cannot aim the app at the person's own
   network. The address check is on literal addresses, not resolved DNS — a documented limit, not a
   hidden one.
3. **SVG is not downloaded.** §7 requires that all SVG pass DOMPurify, and the shell has no sanitizer.
   An SVG image keeps its remote URL rather than putting unsanitised markup into the person's folder.
4. **Filenames are content addresses.** The first 16 hex characters of the SHA-256 of the bytes, plus an
   extension from the response type. Identical images collapse to one file, and re-pasting is idempotent.
5. **Failure is visible and local.** A refused or failed download changes nothing: the remote URL stays in
   the document, exactly as it arrived. Nothing is silently dropped and nothing reports success.
6. **Relative images render through a command, not a protocol.** The note-relative reference is read back
   by an audited command and displayed via a `blob:` URL, which the content policy already allows. No
   asset-protocol scope glob is introduced, because the set of folders a person may open notes from is not
   knowable in advance.
7. **The document only ever holds ordinary Markdown.** `![alt](assets/<hash>.<ext>)` — never a `blob:`
   URL, an absolute path, or an adapter-private identifier.
8. **A host that cannot write beside the note composes no port** and keeps the remote URLs, which is what
   a browser can honestly do.

## Consequences

### Positive

- Pasted articles render in the packaged app, which they did not before, and keep rendering offline.
- Notes become self-contained and survive the source going away.
- The first relative-image rendering path in the desktop shell arrives with an audited resolver rather
  than a broad filesystem grant.
- The content policy is unchanged. No remote origin is added, so the policy stays closed by default.

### Costs

- A paste now causes network requests the person did not individually approve. The bounds in decision 2
  are what makes that acceptable, and they are testable rather than aspirational.
- Requests reveal to the origin host that someone fetched those images, at a time and address of the
  person's machine. Pasting a page from a browser that already loaded them mostly repeats a disclosure
  already made, but not always — a paste can travel further than the tab it came from.
- `assets/` accumulates files. An image whose paste was undone stays on disk, unreferenced. Cleaning that
  up is deliberately not attempted here; silently deleting a file in the person's folder is a worse
  failure than an orphan.
- The capability manifest's claim that network access is limited to one user-configured call is no longer
  true and is corrected in the same change.

## Rejected alternatives

- **Widen `img-src` to `https:`.** One line, and it would make remote images render. It also permanently
  turns every note into something that phones home when opened, makes reading a note observable by
  whoever hosts its images, and leaves the file non-portable. The policy test that forbids a remote origin
  is protecting a real property.
- **Prompt per paste, or an Allow/Ask/Block preference.** Correct for an email client, which renders
  documents chosen by strangers. Here the person is the importer, and the prompt's answer is "yes"
  essentially every time — which makes it a click to train away, not a decision.
- **Enable Tauri's asset protocol with a scope glob.** The scope is static; the folders a person keeps
  notes in are not. It would either be too narrow to work or broad enough to be the general filesystem
  grant this project has avoided.
- **Embed images as `data:` URIs in the Markdown.** Self-contained and dependency-free, but it makes the
  `.md` file enormous, unreadable in any other editor, and hostile to diffs — against `DESIGN.md` §5's
  premise that the file stays an ordinary Markdown file a human can read.
- **Fetch from the webview and pass bytes down.** Blocked by the connection policy, and it would send
  cookies and reveal the request to page-adjacent code. The Rust side sends nothing.

## Follow-up

- Re-download for notes captured before this change is not offered; those notes keep their remote URLs.
- If SimpleMark ever renders documents it did not import, decision 1 must be revisited — the reasoning
  rests entirely on the person being the importer.
- An `assets/` reclamation command, if it is ever built, reports what it would remove before removing it.
