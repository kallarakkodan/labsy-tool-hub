# 31 — Upload dropzone: progress, pause, retry, resume

Status: ready-for-human
Phase: P4
Blocked by: 30, 24
Spec: PRD §8.3 (Source B), PRD §9.5 (client behaviour), PRD §13 row 4

## Why

Meera's 8 GB upload over Wi-Fi *will* fail. A non-resumable upload is a feature
that does not work. This closes P4.

## Scope

- Drag-and-drop zone: 8px radius, dashed `--border`; accent border and
  `--accent-muted` fill on drag-over.
- On file selection the chunked upload begins immediately and the zone becomes a
  progress panel: filename, `1.42 GB / 8.10 GB`, percentage, throughput and ETA
  in mono `tabular-nums`, a 4px accent progress bar, **Pause** and **Cancel**.
- Copy under the bar, verbatim: *"Upload resumes automatically if the connection
  drops. You can pause, but keep this tab open."*
- Slice the `File` client-side at `chunkSize` from `init` and `PUT` sequentially.
- **Retry**: on chunk failure, retry that chunk 3× with 1s/2s/4s backoff; on
  further failure, pause and surface a **Resume** button.
- **Resume across reload**: store the in-flight upload id in `sessionStorage`. On
  load, `GET /api/uploads/[id]` and offer to resume — the user re-picks the file
  (browsers cannot persist a `File` handle), the client verifies name and size
  match, and skips already-received chunks.
- Form submit stays disabled until the upload completes; on completion the
  returned path populates the form's file source.
- Enable the `Upload` tab of the segmented control from issue 24.

## Done when

- [ ] An 8 GB file uploads with accurate progress, throughput, and ETA (PRD §14)
- [ ] Killing the network mid-upload and restoring it resumes from the last
      completed chunk with **no duplicate bytes**
- [x] Cancel removes all temp chunks server-side — the client calls the same
      `DELETE` already proven end to end in issues 28/29's tests
- [ ] Reloading mid-upload offers resume, and a mismatched re-pick is refused

## Comments

Implementation complete: drag-and-drop zone, `XMLHttpRequest`-based chunk PUT
with `upload.onprogress` (needed for smooth within-chunk progress — `fetch`
has no upload-progress event), 3x retry with 1s/2s/4s backoff, a rolling
5-second throughput/ETA window, `sessionStorage`-backed resume-across-reload
with an explicit name/size mismatch refusal, and the Upload tab wired into
issue 24's form. `expectedChunkSize` (the last-chunk-boundary arithmetic) is
factored into `lib/chunking.ts` and shared with `lib/storage.ts`'s
server-side check, with a dedicated unit test.

Code-reviewed twice and two real bugs were caught and fixed in that pass: a
manual Pause mid-chunk was surfacing "failed after 3 retries" instead of the
calm pause state (the abort was indistinguishable from a genuine failure),
and nothing aborted the in-flight XHR on unmount, so switching away from the
Upload tab mid-chunk would leave an orphaned upload finishing invisibly in
the background.

**What is not verified**: this repo has no component-testing infrastructure
(no jsdom/RTL anywhere), consistent with issues 25/27 before it, and I do not
have the admin password to log in and drive the actual browser — the same
constraint noted on those issues. The API layer this component drives
(init/chunk/complete/abort) is fully verified against the real dev server in
issues 28–30, including a real multi-chunk upload with `shasum` and `cmp`
confirmation. What's specifically unverified here is the browser-only
surface: actual drag-and-drop, a real 8 GB transfer's throughput/ETA
accuracy, and a genuine network-kill-and-restore. Marked `ready-for-human`
for that manual pass, same as issue 36's acceptance verification.

## Watch out

- Throughput and ETA must be smoothed (a rolling window), or the numbers jitter
  unreadably between chunks.
- The name+size verification on resume is the only guard against a user picking
  the wrong file — make the mismatch message explicit.
- Do not hold more than one chunk's `Blob` slice alive at a time.
