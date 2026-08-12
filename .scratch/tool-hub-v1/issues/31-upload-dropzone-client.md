# 31 — Upload dropzone: progress, pause, retry, resume

Status: ready-for-agent
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
- [ ] Cancel removes all temp chunks server-side
- [ ] Reloading mid-upload offers resume, and a mismatched re-pick is refused

## Watch out

- Throughput and ETA must be smoothed (a rolling window), or the numbers jitter
  unreadably between chunks.
- The name+size verification on resume is the only guard against a user picking
  the wrong file — make the mismatch message explicit.
- Do not hold more than one chunk's `Blob` slice alive at a time.
