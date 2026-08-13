"use client";

import { useEffect, useRef, useState } from "react";
import { CircleCheck, Pause, Play, TriangleAlert, UploadCloud, X } from "lucide-react";
import { expectedChunkSize } from "@/lib/chunking";
import { formatBytes, formatEta, formatThroughput } from "@/lib/format";
import type { ApiErrorBody } from "@/types";

/*
 * Direct upload (PRD §8.3 Source B, §9.5, issue 31).
 *
 * The chunk protocol itself (init/chunk/complete) shipped in issues 28-30;
 * this is the browser half — slicing the File client-side, sending chunks
 * sequentially with retry/backoff, and surviving a reload mid-upload.
 *
 * `XMLHttpRequest`, not `fetch`, for the chunk PUT: `fetch` has no upload-
 * progress event, and at the 16 MiB default chunk size a fetch-only
 * implementation would only ever update progress at chunk boundaries —
 * multi-second jumps on a slow link, not the smooth bar/throughput/ETA the
 * "Done when" accuracy bar calls for. `xhr.upload.onprogress` is what makes
 * within-chunk progress possible at all.
 */

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const SESSION_KEY = "labsy-upload";
/** How much history the throughput/ETA rolling window keeps (issue 31's "watch out": unsmoothed numbers jitter). */
const RATE_WINDOW_MS = 5000;
/** Floor between progress-state updates, so a fast link's flood of XHR progress events does not thrash React. */
const PROGRESS_THROTTLE_MS = 150;

export interface UploadCompletion {
  uploadId: string;
  relativePath: string;
  fileName: string;
  fileSize: string;
}

interface Props {
  /** Called once `complete` succeeds; the caller submits `{ source: "upload", uploadId }`. */
  onCompleted: (result: UploadCompletion) => void;
  /** Called whenever the upload stops being in a completed state — cancelled, reset, or a fresh file dropped. */
  onReset: () => void;
}

type Phase = "idle" | "resumable" | "uploading" | "paused" | "completing" | "completed" | "error";

interface SessionRecord {
  uploadId: string;
  fileName: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
}

export function UploadDropzone({ onCompleted, onReset }: Props) {
  // A record left by a previous, interrupted session — offer to resume it
  // rather than starting over (PRD §9.5's client behaviour). Read once, via a
  // lazy initializer rather than a mount effect: this component only ever
  // mounts client-side (behind a button click, never part of the initial
  // page render), so `sessionStorage` is safe to read during the first
  // render, and doing it here — instead of `setState` inside an effect —
  // avoids the extra render cascade.
  const [initialRecord] = useState<SessionRecord | null>(() => getSessionRecord());

  const [phase, setPhase] = useState<Phase>(initialRecord !== null ? "resumable" : "idle");
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState(initialRecord?.fileName ?? "");
  const [fileSize, setFileSize] = useState(initialRecord?.fileSize ?? 0);
  const [uploadedBytes, setUploadedBytes] = useState(0);
  const [rateBps, setRateBps] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resumable, setResumable] = useState<SessionRecord | null>(initialRecord);
  const [result, setResult] = useState<UploadCompletion | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const pausedRef = useRef(false);
  const cancelledRef = useRef(false);
  const runIdRef = useRef(0);
  const samplesRef = useRef<{ t: number; bytes: number }[]>([]);
  const lastProgressUpdateRef = useRef(0);
  /** The last `File` the admin actually picked — the only way `handleResumeAfterPause` (no file input of its own) can keep slicing after a same-session pause. */
  const pendingFileRef = useRef<File | null>(null);

  // Switching away from the Upload tab unmounts this component (its parent
  // renders it via a ternary, not a `hidden` toggle). Without this, a chunk
  // transfer in flight at that moment would keep running orphaned in the
  // background — nothing left to show it, but still sending bytes and, if it
  // finished, still calling `onCompleted` on a component nobody can see. The
  // upload stays resumable regardless (`sessionStorage` survives the unmount);
  // aborting here just makes "switched tabs mid-upload" behave like a pause
  // instead of an invisible background upload.
  useEffect(() => {
    return () => {
      // `cancelledRef`, not just an abort: aborting alone would resolve the
      // in-flight chunk as a plain failure, and with none of the stop flags
      // set the orphaned retry loop would just open a fresh XHR and carry on.
      cancelledRef.current = true;
      xhrRef.current?.abort();
    };
  }, []);

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function resetToIdle() {
    cancelledRef.current = true;
    xhrRef.current?.abort();
    clearSession();
    setPhase("idle");
    setFileName("");
    setFileSize(0);
    setUploadedBytes(0);
    setRateBps(0);
    setErrorMessage(null);
    setResumable(null);
    setResult(null);
    samplesRef.current = [];
    onReset();
  }

  // --- starting a fresh upload -------------------------------------------------

  async function startUpload(file: File) {
    onReset();
    cancelledRef.current = false;
    pausedRef.current = false;
    samplesRef.current = [];
    setResult(null);
    setErrorMessage(null);
    setFileName(file.name);
    setFileSize(file.size);
    setUploadedBytes(0);
    setPhase("uploading");

    try {
      const response = await fetch("/api/uploads/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, totalSize: String(file.size), mimeType: file.type || undefined }),
      });

      if (!response.ok) {
        const body: Partial<ApiErrorBody> = await response.json().catch(() => ({}));
        throw new Error(body.error?.message ?? "The upload could not be started.");
      }

      const init: { uploadId: string; chunkSize: number; totalChunks: number } = await response.json();
      const record: SessionRecord = {
        uploadId: init.uploadId,
        fileName: file.name,
        fileSize: file.size,
        chunkSize: init.chunkSize,
        totalChunks: init.totalChunks,
      };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(record));

      await runUpload(file, record, new Set());
    } catch (error) {
      if (cancelledRef.current) return;
      setPhase("error");
      setErrorMessage(error instanceof Error ? error.message : "The upload could not be started.");
    }
  }

  // --- the resume-after-reload flow --------------------------------------------

  async function handleResumePick(file: File) {
    if (resumable === null) return;

    if (file.name !== resumable.fileName || file.size !== resumable.fileSize) {
      setErrorMessage(
        `That is not the same file. Expected "${resumable.fileName}" (${formatBytes(resumable.fileSize)}), ` +
          `got "${file.name}" (${formatBytes(file.size)}).`,
      );
      return;
    }

    setErrorMessage(null);
    setFileName(file.name);
    setFileSize(file.size);
    setPhase("uploading");

    try {
      const response = await fetch(`/api/uploads/${resumable.uploadId}`);
      if (!response.ok) {
        // The upload is gone server-side (expired, completed, or aborted elsewhere) — nothing to resume.
        clearSession();
        resetToIdle();
        return;
      }
      const status: { received: number[]; status: string } = await response.json();
      if (status.status !== "pending") {
        clearSession();
        resetToIdle();
        return;
      }

      setUploadedBytes(receivedBytes(status.received, resumable));
      await runUpload(file, resumable, new Set(status.received));
    } catch {
      setPhase("error");
      setErrorMessage("The hub could not be reached. Check the connection and retry.");
    }
  }

  function receivedBytes(received: number[], record: SessionRecord): number {
    let bytes = 0;
    for (const index of received) {
      bytes += expectedChunkSize(index, record.totalChunks, record.chunkSize, record.fileSize);
    }
    return bytes;
  }

  // --- the chunk-sending loop ---------------------------------------------------

  async function runUpload(file: File, record: SessionRecord, alreadyReceived: Set<number>) {
    const runId = ++runIdRef.current;
    let completedBytes = receivedBytes([...alreadyReceived], record);
    setUploadedBytes(completedBytes);

    for (let index = 0; index < record.totalChunks; index++) {
      if (alreadyReceived.has(index)) continue;
      if (pausedRef.current || cancelledRef.current) return;

      const start = index * record.chunkSize;
      const end = Math.min(start + record.chunkSize, file.size);
      const blob = file.slice(start, end); // one slice alive at a time — never precomputed for the whole file

      const outcome = await putChunkWithRetry(record.uploadId, index, blob, completedBytes, runId);
      if (runIdRef.current !== runId) return; // superseded by a newer run (e.g. Cancel then a fresh drop)
      if (outcome === "stopped") return; // a user-initiated pause or cancel — handlePause/handleCancel already set the right state
      if (outcome === "failed") {
        pausedRef.current = true;
        setPhase("paused");
        setErrorMessage(`Chunk ${index + 1} of ${record.totalChunks} failed after 3 retries.`);
        return;
      }

      completedBytes += blob.size;
      setUploadedBytes(completedBytes);
    }

    if (cancelledRef.current || runIdRef.current !== runId) return;
    await finishUpload(record.uploadId);
  }

  /**
   * `"stopped"` means a user action (Pause or Cancel) interrupted this chunk —
   * `handlePause`/`handleCancel` already set the right phase and message, and
   * `runUpload` must not treat it as a failure. Only running out of retries is
   * `"failed"`; that is the one case worth telling the admin about.
   */
  async function putChunkWithRetry(
    uploadId: string,
    index: number,
    blob: Blob,
    completedBytesBeforeThisChunk: number,
    runId: number,
  ): Promise<"ok" | "stopped" | "failed"> {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (pausedRef.current || cancelledRef.current || runIdRef.current !== runId) return "stopped";

      const ok = await putChunkOnce(uploadId, index, blob, completedBytesBeforeThisChunk);
      if (ok) return "ok";
      if (pausedRef.current || cancelledRef.current || runIdRef.current !== runId) return "stopped";

      if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]!);
    }
    return "failed";
  }

  function putChunkOnce(
    uploadId: string,
    index: number,
    blob: Blob,
    completedBytesBeforeThisChunk: number,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhrRef.current = xhr;
      xhr.open("PUT", `/api/uploads/${uploadId}/chunk?index=${index}`);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        recordProgress(completedBytesBeforeThisChunk + event.loaded);
      };
      xhr.onload = () => resolve(xhr.status === 200);
      xhr.onerror = () => resolve(false);
      xhr.onabort = () => resolve(false);
      xhr.send(blob);
    });
  }

  /** The rolling-window sampler behind throughput/ETA — trimmed to the last `RATE_WINDOW_MS`. */
  function recordProgress(bytes: number) {
    const now = performance.now();
    samplesRef.current.push({ t: now, bytes });
    while (samplesRef.current.length > 1 && now - samplesRef.current[0]!.t > RATE_WINDOW_MS) {
      samplesRef.current.shift();
    }

    if (now - lastProgressUpdateRef.current < PROGRESS_THROTTLE_MS) return;
    lastProgressUpdateRef.current = now;

    setUploadedBytes(bytes);
    const oldest = samplesRef.current[0]!;
    const dt = (now - oldest.t) / 1000;
    setRateBps(dt > 0 ? (bytes - oldest.bytes) / dt : 0);
  }

  async function finishUpload(uploadId: string) {
    setPhase("completing");
    try {
      const response = await fetch(`/api/uploads/${uploadId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const body: Partial<ApiErrorBody> = await response.json().catch(() => ({}));
        throw new Error(body.error?.message ?? "The upload finished, but could not be finalised.");
      }

      const completion: { filePath: string; fileName: string; fileSize: string } = await response.json();
      clearSession();
      const outcome: UploadCompletion = {
        uploadId,
        relativePath: completion.filePath,
        fileName: completion.fileName,
        fileSize: completion.fileSize,
      };
      setResult(outcome);
      setPhase("completed");
      onCompleted(outcome);
    } catch (error) {
      setPhase("error");
      setErrorMessage(error instanceof Error ? error.message : "The upload could not be finalised.");
    }
  }

  // --- controls ------------------------------------------------------------------

  function handlePause() {
    pausedRef.current = true;
    xhrRef.current?.abort();
    setPhase("paused");
  }

  async function handleResumeAfterPause() {
    setErrorMessage(null);
    pausedRef.current = false;
    setPhase("uploading");

    const record = getSessionRecord();
    if (record === null) {
      resetToIdle();
      return;
    }

    try {
      const response = await fetch(`/api/uploads/${record.uploadId}`);
      if (!response.ok) {
        // Gone server-side (expired, completed, or aborted elsewhere) — nothing left to resume.
        resetToIdle();
        return;
      }
      const status: { received: number[] } = await response.json();

      const file = pendingFileRef.current;
      if (file === null) {
        // The tab was not reloaded, so the File handle is still ours — this
        // branch only matters if it somehow got cleared; guard rather than crash.
        setPhase("error");
        setErrorMessage("Lost the file handle — reload and pick the file again to resume.");
        return;
      }
      await runUpload(file, record, new Set(status.received));
    } catch {
      setPhase("error");
      setErrorMessage("The hub could not be reached. Check the connection and retry.");
    }
  }

  async function handleCancel() {
    cancelledRef.current = true;
    xhrRef.current?.abort();
    const record = getSessionRecord();
    clearSession();
    if (record !== null) {
      await fetch(`/api/uploads/${record.uploadId}`, { method: "DELETE" }).catch(() => {});
    }
    resetToIdle();
  }

  function handleFilePicked(file: File) {
    pendingFileRef.current = file;
    void startUpload(file);
  }

  // --- drag and drop ---------------------------------------------------------

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file !== undefined) handleFilePicked(file);
  }

  const percent = fileSize > 0 ? Math.min(100, Math.round((uploadedBytes / fileSize) * 100)) : 0;
  const remainingBytes = Math.max(0, fileSize - uploadedBytes);
  const etaSeconds = rateBps > 0 ? remainingBytes / rateBps : Infinity;

  if (phase === "idle") {
    return (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`flex cursor-pointer flex-col items-center gap-2 rounded-card border border-dashed px-6 py-10
                    text-center transition-colors ${
                      dragOver ? "border-accent bg-accent/10" : "border-border hover:border-border-hover"
                    }`}
      >
        <UploadCloud className={`size-6 ${dragOver ? "text-accent" : "text-fg-subtle"}`} aria-hidden="true" />
        <p className="text-sm text-fg">Drag and drop a file here, or click to browse</p>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) handleFilePicked(file);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  if (phase === "resumable") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border px-6 py-8 text-center">
        <UploadCloud className="size-6 text-fg-subtle" aria-hidden="true" />
        <div>
          <p className="text-sm text-fg">
            An interrupted upload for <span className="font-mono">{fileName}</span> ({formatBytes(fileSize)}) is
            available.
          </p>
          <p className="mt-1 text-xs text-fg-muted">
            Browsers cannot reopen a file automatically — pick it again to resume.
          </p>
        </div>
        {errorMessage !== null && <p className="text-xs text-danger">{errorMessage}</p>}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => resumeInputRef.current?.click()}
            className="rounded-button bg-accent px-3 py-1.5 text-xs font-medium text-base transition-colors
                       hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          >
            Pick the File
          </button>
          <button
            type="button"
            onClick={resetToIdle}
            className="rounded-button border border-border bg-surface px-3 py-1.5 text-xs text-fg
                       transition-colors hover:border-border-hover hover:bg-surface-hover focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-accent/35"
          >
            Start Fresh
          </button>
        </div>
        <input
          ref={resumeInputRef}
          type="file"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file !== undefined) void handleResumePick(file);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  if (phase === "completed" && result !== null) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-card border border-border bg-inset px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <CircleCheck className="size-4 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0">
            <p className="truncate font-mono text-sm text-fg">{result.fileName}</p>
            <p className="text-xs text-fg-muted tabular-nums">{formatBytes(result.fileSize)} · uploaded</p>
          </div>
        </div>
        <button
          type="button"
          onClick={resetToIdle}
          className="shrink-0 text-xs text-fg-muted underline-offset-2 hover:text-fg hover:underline"
        >
          Change file
        </button>
      </div>
    );
  }

  // uploading / paused / completing / error — the progress panel (PRD §8.3)
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-inset px-4 py-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm text-fg">{fileName}</p>
          <p className="font-mono text-xs text-fg-muted tabular-nums">
            {formatBytes(uploadedBytes)} / {formatBytes(fileSize)} · {percent}%
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {phase === "uploading" && (
            <IconButton label="Pause" onClick={handlePause}>
              <Pause className="size-3.5" aria-hidden="true" />
            </IconButton>
          )}
          {phase === "paused" && (
            <IconButton label="Resume" onClick={() => void handleResumeAfterPause()}>
              <Play className="size-3.5" aria-hidden="true" />
            </IconButton>
          )}
          <IconButton label="Cancel" danger onClick={() => void handleCancel()}>
            <X className="size-3.5" aria-hidden="true" />
          </IconButton>
        </div>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-button bg-border">
        <div
          className="h-full rounded-button bg-accent transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="flex items-center justify-between font-mono text-xs text-fg-muted tabular-nums">
        <span>{phase === "completing" ? "Finishing up…" : formatThroughput(rateBps)}</span>
        <span>{phase === "completing" ? "" : formatEta(etaSeconds)}</span>
      </div>

      {phase === "error" ? (
        <div className="flex items-center gap-2 text-xs text-danger">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      ) : (
        <p className="text-xs text-fg-muted">
          {errorMessage !== null
            ? errorMessage
            : "Upload resumes automatically if the connection drops. You can pause, but keep this tab open."}
        </p>
      )}
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The current in-flight upload's record, or null if there is none — corrupt JSON degrades to "none" rather than throwing. */
function getSessionRecord(): SessionRecord | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  return raw === null ? null : parseSessionRecord(raw);
}

function parseSessionRecord(raw: string): SessionRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSessionRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.uploadId === "string" &&
    typeof v.fileName === "string" &&
    typeof v.fileSize === "number" &&
    typeof v.chunkSize === "number" &&
    typeof v.totalChunks === "number"
  );
}

function IconButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`rounded-button p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2
                  focus-visible:ring-accent/35 ${
                    danger
                      ? "text-fg-subtle hover:bg-danger/10 hover:text-danger"
                      : "text-fg-subtle hover:bg-surface-hover hover:text-fg"
                  }`}
    >
      {children}
    </button>
  );
}
