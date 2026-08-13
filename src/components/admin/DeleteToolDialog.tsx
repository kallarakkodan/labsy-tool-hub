"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import type { ApiErrorBody, DeleteEligibility, SerializedAdminTool } from "@/types";

/*
 * The destructive confirm dialog (PRD §8.2, §16 D4, issue 25).
 *
 * Eligibility for the second, dangerous choice is decided entirely server-side
 * by `GET .../delete-eligibility` and just rendered here — this component does
 * not re-derive "is it a symlink" or "is it shared" itself. A client-side
 * version of that check would be trivially bypassed by calling
 * `DELETE .../[id]?deleteFile=true` directly, and would drift from the real
 * rule the handler enforces regardless (`lib/admin-tools.ts`'s
 * `checkFileDeleteEligibility`).
 */

type Choice = "catalogue" | "file";

interface Props {
  tool: SerializedAdminTool;
  onClose: () => void;
  /** Called after a successful delete; the caller closes and refreshes the list. */
  onDeleted: () => void;
}

export function DeleteToolDialog({ tool, onClose, onDeleted }: Props) {
  const [entered, setEntered] = useState(false);
  const [eligibility, setEligibility] = useState<DeleteEligibility | null>(null);
  const [choice, setChoice] = useState<Choice>("catalogue");
  const [typedName, setTypedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/admin/tools/${tool.id}/delete-eligibility`)
      .then((response) => (response.ok ? response.json() : { eligible: false, reason: null }))
      .then((body: DeleteEligibility) => {
        if (!cancelled) setEligibility(body);
      })
      .catch(() => {
        if (!cancelled) setEligibility({ eligible: false, reason: null });
      });

    return () => {
      cancelled = true;
    };
  }, [tool.id]);

  const fileDeleteOffered = eligibility?.eligible === true;
  const nameMatches = typedName === tool.name;
  const confirmDisabled =
    submitting || eligibility === null || (choice === "file" && !nameMatches);

  async function handleConfirm() {
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(
        `/api/admin/tools/${tool.id}?deleteFile=${choice === "file"}`,
        { method: "DELETE" },
      );

      if (!response.ok) {
        const body: Partial<ApiErrorBody> = await response.json().catch(() => ({}));
        setError(body.error?.message ?? "The tool could not be deleted.");
        return;
      }

      onDeleted();
    } catch {
      setError("The hub could not be reached. Check the connection and retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-tool-heading"
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-base/70 transition-opacity duration-200 ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      />

      <div
        className={`relative flex w-full max-w-[440px] flex-col rounded-card border border-border
                    bg-surface shadow-overlay transition-all duration-200 ease-out-quart
                    motion-reduce:transition-none ${
                      entered ? "scale-100 opacity-100" : "scale-95 opacity-0"
                    }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <h2 id="delete-tool-heading" className="text-[15px] font-semibold text-fg">
                Delete {tool.name}?
              </h2>
              <p className="mt-0.5 text-xs text-fg-muted">This cannot be undone.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-button p-1.5 text-fg-subtle transition-colors hover:bg-surface-hover
                       hover:text-fg focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-accent/35"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-col gap-3 px-5 py-4">
          <div role="radiogroup" aria-label="Deletion scope" className="flex flex-col gap-3">
            <ChoiceOption
              selected={choice === "catalogue"}
              onSelect={() => setChoice("catalogue")}
              label="Remove from catalogue"
              hint="The file stays on disk. You can re-register it later."
            />

            {eligibility === null ? (
              <div className="flex items-center gap-2 rounded-card border border-border bg-inset px-3 py-2.5 text-xs text-fg-muted">
                <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                Checking whether the file can be deleted…
              </div>
            ) : fileDeleteOffered ? (
              <ChoiceOption
                selected={choice === "file"}
                onSelect={() => setChoice("file")}
                label="Remove and permanently delete the file from the server"
                hint="The artifact is unlinked from disk. This is the unrecoverable option."
                danger
              />
            ) : (
              <p className="rounded-card border border-border bg-inset px-3 py-2.5 text-xs text-fg-muted">
                File deletion is not offered{eligibility.reason !== null ? `: ${eligibility.reason}` : "."}
              </p>
            )}
          </div>

          {choice === "file" && fileDeleteOffered && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="delete-confirm-name" className="text-xs text-fg-muted">
                Type <span className="font-mono text-fg">{tool.name}</span> to confirm
              </label>
              <input
                id="delete-confirm-name"
                autoFocus
                value={typedName}
                onChange={(event) => setTypedName(event.target.value)}
                autoComplete="off"
                className="w-full rounded-card border border-border bg-inset px-3 py-2 text-sm text-fg
                           focus:border-danger/60 focus:outline-none focus:ring-2 focus:ring-danger/35"
              />
            </div>
          )}

          {error !== null && (
            <div role="alert" className="rounded-card border border-danger/40 bg-danger/10 px-3 py-2.5">
              <p className="text-xs text-danger">{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-button border border-border bg-surface px-4 py-2 text-sm text-fg
                       transition-colors hover:border-border-hover hover:bg-surface-hover
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmDisabled}
            className="flex items-center gap-2 rounded-button bg-danger px-4 py-2 text-sm font-medium
                       text-base transition-colors hover:bg-danger/90 focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-danger/35 disabled:cursor-not-allowed
                       disabled:opacity-50"
          >
            {submitting && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {choice === "file" ? "Delete Tool and File" : "Remove from Catalogue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ChoiceOption({
  selected,
  onSelect,
  label,
  hint,
  danger = false,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  hint: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`flex items-start gap-3 rounded-card border px-3 py-2.5 text-left transition-colors
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 ${
                    selected
                      ? danger
                        ? "border-danger/50 bg-danger/10"
                        : "border-accent/40 bg-accent/10"
                      : "border-border bg-inset hover:border-border-hover"
                  }`}
    >
      <span
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-button border ${
          selected ? (danger ? "border-danger" : "border-accent") : "border-border-hover"
        }`}
      >
        {selected && (
          <span className={`size-2 rounded-button ${danger ? "bg-danger" : "bg-accent"}`} />
        )}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className={`text-sm font-medium ${danger ? "text-danger" : "text-fg"}`}>{label}</span>
        <span className="text-xs text-fg-muted">{hint}</span>
      </span>
    </button>
  );
}
