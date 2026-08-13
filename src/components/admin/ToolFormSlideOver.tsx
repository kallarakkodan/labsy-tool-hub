"use client";

import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { FolderSearch, Image as ImageIcon, LoaderCircle, X } from "lucide-react";
import { formatBytes, formatDate } from "@/lib/format";
import type { CategoryCount } from "@/lib/tools";
import { slugify, toolCreateSchema } from "@/lib/validation";
import type { ApiErrorBody, SerializedAdminTool } from "@/types";
import { CategoryCombobox } from "./CategoryCombobox";
import { ServerBrowserModal, type BrowseSelection } from "./ServerBrowserModal";

/*
 * Add/Edit slide-over (PRD §8.3, issue 24; Browse Server wired in issue 27).
 *
 * The form validates with `react-hook-form` for field-level UX (required,
 * length), but the gate that decides whether a request goes out is a manual
 * `toolCreateSchema.safeParse` on the assembled payload — the same schema
 * `POST /api/admin/tools` re-parses (CONTEXT §6). That is deliberately not
 * wired up through `zodResolver`: `file` is a discriminated union, and
 * react-hook-form's path types do not resolve `"file.relativePath"` cleanly
 * against a union, so this form keeps a flat `serverPath` field and only
 * nests it into `{ source: "serverPath", relativePath }` at submit time.
 *
 * This issue ships Server Path only — the Upload tab stays visibly present but
 * disabled until issue 31. A manual paste into the path input still works and
 * is revalidated server-side regardless of how the value got there (PRD §8.3).
 */

interface FormValues {
  name: string;
  slug: string;
  description: string;
  category: string;
  version: string;
  serverPath: string;
  iconUrl: string;
  notes: string;
  published: boolean;
  visibility: "public" | "admin";
}

/** Zod issue path -> the flat field that owns it. */
const FIELD_FOR_PATH: Record<string, keyof FormValues> = {
  name: "name",
  slug: "slug",
  description: "description",
  category: "category",
  version: "version",
  iconUrl: "iconUrl",
  notes: "notes",
  published: "published",
  visibility: "visibility",
  "file.relativePath": "serverPath",
};

interface Props {
  mode: "create" | "edit";
  tool?: SerializedAdminTool;
  categories: CategoryCount[];
  /** Every other tool's slug, lowercased — for the on-blur uniqueness check. */
  existingSlugs: Set<string>;
  onClose: () => void;
  /** Called after a successful save; the caller refreshes the list and closes. */
  onSaved: () => void;
}

export function ToolFormSlideOver({ mode, tool, categories, existingSlugs, onClose, onSaved }: Props) {
  const form = useForm<FormValues>({
    defaultValues: {
      name: tool?.name ?? "",
      slug: tool?.slug ?? "",
      description: tool?.description ?? "",
      category: tool?.category ?? "",
      version: tool?.version ?? "",
      serverPath: tool?.filePath ?? "",
      iconUrl: tool?.iconUrl ?? "",
      notes: tool?.notes ?? "",
      published: tool?.published ?? true,
      visibility: tool?.visibility ?? "public",
    },
  });
  const { register, handleSubmit, watch, getValues, setValue, setError, control, formState } = form;
  const { errors, isDirty } = formState;

  // Edit mode starts "edited": a slug already in use by links elsewhere must
  // never silently rewrite itself because the name changed.
  const [slugEdited, setSlugEdited] = useState(mode === "edit");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [entered, setEntered] = useState(false);
  const [iconBroken, setIconBroken] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  /** Size/mtime from a fresh Browse Server pick, shown until the path is edited by hand. */
  const [browsedInfo, setBrowsedInfo] = useState<{ size: string; mtime: string } | null>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    // Skipped while the browse modal is open, which has its own Escape handler
    // (both listen on `document`) — otherwise one keypress would close the
    // browser *and* trigger this form's dirty-state confirm in the same beat.
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !browserOpen) requestClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, browserOpen]);

  function requestClose() {
    if (isDirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  }

  const published = watch("published");
  const visibility = watch("visibility");
  const iconUrl = watch("iconUrl");
  const serverPath = watch("serverPath");

  const iconUrlValid =
    iconUrl.trim() !== "" && (/^https?:\/\//.test(iconUrl.trim()) || iconUrl.trim().startsWith("/"));

  function handleBrowseSelect(file: BrowseSelection) {
    setValue("serverPath", file.relativePath, { shouldDirty: true, shouldValidate: true });
    setBrowsedInfo({ size: file.size, mtime: file.mtime });
    setBrowserOpen(false);
  }

  async function onValid(values: FormValues) {
    setFormError(null);

    const payload: Record<string, unknown> = {
      name: values.name,
      description: values.description,
      category: values.category,
      version: values.version,
      iconUrl: values.iconUrl.trim(),
      notes: values.notes.trim() === "" ? null : values.notes,
      published: values.published,
      visibility: values.visibility,
      file: { source: "serverPath", relativePath: values.serverPath.trim() },
    };

    // Only a slug the admin actually typed is sent as a decision (CONTEXT §6 —
    // `lib/admin-tools.ts`'s `resolveSlug`). Omitted, the server derives one
    // from the name and silently de-dupes; sent, a collision is a hard error.
    const typedSlug = values.slug.trim();
    if (slugEdited && typedSlug !== "") payload.slug = typedSlug;

    const parsed = toolCreateSchema.safeParse(payload);
    if (!parsed.success) {
      let mapped = false;
      for (const issue of parsed.error.issues) {
        const field = FIELD_FOR_PATH[issue.path.join(".")];
        if (field !== undefined) {
          setError(field, { type: "manual", message: issue.message });
          mapped = true;
        }
      }
      if (!mapped) setFormError(parsed.error.issues[0]?.message ?? "That form is not valid.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(
        mode === "create" ? "/api/admin/tools" : `/api/admin/tools/${tool!.id}`,
        {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );

      if (!response.ok) {
        const body: Partial<ApiErrorBody> = await response.json().catch(() => ({}));
        const message = body.error?.message ?? "The tool could not be saved.";
        if (body.error?.code === "SLUG_TAKEN") {
          setError("slug", { type: "manual", message });
        } else {
          setFormError(message);
        }
        return;
      }

      onSaved();
    } catch {
      setFormError("The hub could not be reached. Check the connection and retry.");
    } finally {
      setSubmitting(false);
    }
  }

  function checkSlugUniqueness() {
    const value = getValues("slug").trim();
    if (!slugEdited || value === "") return;
    if (existingSlugs.has(value.toLowerCase())) {
      setError("slug", { type: "manual", message: `The slug "${value}" is already in use` });
    }
  }

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-labelledby="tool-form-heading">
      <div
        onClick={requestClose}
        className={`absolute inset-0 bg-base/70 transition-opacity duration-200 ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      />

      <form
        onSubmit={handleSubmit(onValid)}
        className={`absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l
                    border-border bg-surface shadow-overlay transition-transform duration-200
                    ease-out-quart motion-reduce:transition-none ${
                      entered ? "translate-x-0" : "translate-x-full"
                    }`}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 id="tool-form-heading" className="text-[15px] font-semibold text-fg">
            {mode === "create" ? "Add New Tool" : `Edit ${tool?.name}`}
          </h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="rounded-button p-1.5 text-fg-subtle transition-colors hover:bg-surface-hover
                       hover:text-fg focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-accent/35"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="flex flex-col gap-5">
            <Field label="Tool Name" htmlFor="tool-name" error={errors.name?.message}>
              <input
                id="tool-name"
                autoFocus
                {...register("name", {
                  required: "required",
                  minLength: { value: 2, message: "at least 2 characters" },
                  maxLength: { value: 80, message: "at most 80 characters" },
                  onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                    if (!slugEdited) setValue("slug", slugify(event.target.value), { shouldDirty: true });
                  },
                })}
                className={inputClass}
              />
            </Field>

            <Field label="Slug" htmlFor="tool-slug" error={errors.slug?.message} hint="Used in the URL. Editable.">
              <input
                id="tool-slug"
                {...register("slug", {
                  required: "required",
                  maxLength: { value: 80, message: "at most 80 characters" },
                  onChange: () => setSlugEdited(true),
                  onBlur: checkSlugUniqueness,
                })}
                className={`${inputClass} font-mono`}
              />
            </Field>

            <Field
              label="Description"
              htmlFor="tool-description"
              error={errors.description?.message}
              trailing={<Counter value={watch("description")} max={280} />}
            >
              <textarea
                id="tool-description"
                rows={3}
                {...register("description", {
                  required: "required",
                  maxLength: { value: 280, message: "at most 280 characters" },
                })}
                className={inputClass}
              />
            </Field>

            <Field label="Category" htmlFor="tool-category" error={errors.category?.message}>
              <Controller
                control={control}
                name="category"
                rules={{ required: "required", maxLength: { value: 40, message: "at most 40 characters" } }}
                render={({ field }) => (
                  <CategoryCombobox
                    id="tool-category"
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    categories={categories}
                  />
                )}
              />
            </Field>

            <Field label="Version" htmlFor="tool-version" error={errors.version?.message}>
              <input
                id="tool-version"
                {...register("version", {
                  required: "required",
                  maxLength: { value: 40, message: "at most 40 characters" },
                })}
                className={`${inputClass} font-mono`}
              />
            </Field>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-fg">File source</span>
              <div className="flex w-fit rounded-button border border-border bg-inset p-0.5">
                <span className="rounded-button bg-surface-hover px-3 py-1.5 text-xs font-medium text-fg">
                  Server Path
                </span>
                <span
                  title="Direct upload arrives with issue 31"
                  className="cursor-not-allowed rounded-button px-3 py-1.5 text-xs font-medium text-fg-subtle"
                >
                  Upload
                </span>
              </div>

              <Field
                label=""
                htmlFor="tool-server-path"
                error={errors.serverPath?.message}
                hint="Relative to the storage root, e.g. isos/ubuntu-22.04.4-live-server-amd64.iso"
              >
                <div className="flex gap-2">
                  <input
                    id="tool-server-path"
                    {...register("serverPath", {
                      required: "select a file",
                      maxLength: 4096,
                      onChange: () => setBrowsedInfo(null),
                    })}
                    className={`${inputClass} flex-1 font-mono`}
                  />
                  <button
                    type="button"
                    onClick={() => setBrowserOpen(true)}
                    className="flex shrink-0 items-center gap-1.5 rounded-button border border-border
                               bg-surface px-3 py-2 text-sm text-fg transition-colors
                               hover:border-border-hover hover:bg-surface-hover focus-visible:outline-none
                               focus-visible:ring-2 focus-visible:ring-accent/35"
                  >
                    <FolderSearch className="size-4" aria-hidden="true" />
                    Browse Server
                  </button>
                </div>
              </Field>
              {browsedInfo !== null ? (
                <p className="font-mono text-xs text-fg-muted tabular-nums">
                  {formatBytes(browsedInfo.size)} · {formatDate(browsedInfo.mtime)}
                </p>
              ) : (
                tool !== undefined &&
                serverPath === tool.filePath && (
                  <p className="font-mono text-xs text-fg-muted tabular-nums">
                    Current file — {tool.fileName}
                  </p>
                )
              )}
            </div>

            <Field
              label="Icon URL"
              htmlFor="tool-icon-url"
              error={errors.iconUrl?.message}
              hint="An http(s) URL or a path starting with /"
            >
              <div className="flex items-center gap-3">
                <input
                  id="tool-icon-url"
                  {...register("iconUrl", {
                    maxLength: { value: 2048, message: "too long" },
                    onChange: () => setIconBroken(false),
                  })}
                  className={`${inputClass} flex-1`}
                />
                <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-button border border-border bg-inset">
                  {iconUrlValid && !iconBroken ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={iconUrl.trim()}
                      alt=""
                      className="size-full object-contain"
                      onError={() => setIconBroken(true)}
                    />
                  ) : (
                    <ImageIcon className="size-4 text-fg-subtle" aria-hidden="true" />
                  )}
                </div>
              </div>
            </Field>

            <Field
              label="Notes"
              htmlFor="tool-notes"
              error={errors.notes?.message}
              trailing={<Counter value={watch("notes")} max={2000} />}
            >
              <textarea
                id="tool-notes"
                rows={4}
                {...register("notes", { maxLength: { value: 2000, message: "at most 2000 characters" } })}
                className={inputClass}
              />
            </Field>

            <Switch
              label="Published"
              helper="Off saves this tool as a draft — hidden from the public catalogue."
              checked={published}
              onChange={(next) => setValue("published", next, { shouldDirty: true })}
            />

            <Switch
              label="Internal only"
              helper="Hidden from the public catalogue. Only visible while signed in to the admin panel."
              checked={visibility === "admin"}
              onChange={(next) =>
                setValue("visibility", next ? "admin" : "public", { shouldDirty: true })
              }
            />
          </div>
        </div>

        {formError !== null && (
          <div role="alert" className="mx-6 mb-3 rounded-card border border-danger/40 bg-danger/10 px-4 py-3">
            <p className="text-sm text-danger">{formError}</p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={requestClose}
            className="rounded-button border border-border bg-surface px-4 py-2 text-sm text-fg
                       transition-colors hover:border-border-hover hover:bg-surface-hover
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || serverPath.trim() === ""}
            className="flex items-center gap-2 rounded-button bg-accent px-4 py-2 text-sm font-medium
                       text-base transition-colors hover:bg-accent-hover focus-visible:outline-none
                       focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed
                       disabled:opacity-50"
          >
            {submitting && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {mode === "create" ? "Add Tool" : "Save Changes"}
          </button>
        </div>
      </form>

      {/*
       * A sibling of `<form>`, not a child of it: the form carries the slide-in
       * `transition-transform`, which makes it a containing block for any
       * `position: fixed` descendant. Nesting the modal inside would clip its
       * viewport-wide overlay to the 560px panel instead of covering the screen.
       */}
      {browserOpen && (
        <ServerBrowserModal onClose={() => setBrowserOpen(false)} onSelect={handleBrowseSelect} />
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-card border border-border bg-inset px-3 py-2 text-sm text-fg placeholder:text-fg-subtle " +
  "focus:border-border-hover focus:outline-none focus:ring-2 focus:ring-accent/35";

function Field({
  label,
  htmlFor,
  error,
  hint,
  trailing,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label !== "" && (
        <div className="flex items-baseline justify-between">
          <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
            {label}
          </label>
          {trailing}
        </div>
      )}
      {children}
      {error !== undefined ? (
        <p className="text-xs text-danger">{error}</p>
      ) : hint !== undefined ? (
        <p className="text-xs text-fg-muted">{hint}</p>
      ) : null}
    </div>
  );
}

function Counter({ value, max }: { value: string; max: number }) {
  return (
    <span className="font-mono text-xs text-fg-subtle tabular-nums">
      {value.length}/{max}
    </span>
  );
}

function Switch({
  label,
  helper,
  checked,
  onChange,
}: {
  label: string;
  helper: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-card border border-border bg-inset px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-fg">{label}</span>
        <span className="text-xs text-fg-muted">{helper}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`shrink-0 rounded-button border px-3 py-1.5 text-xs font-medium transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 ${
                      checked
                        ? "border-accent/40 bg-accent/10 text-accent"
                        : "border-border bg-surface text-fg-muted hover:border-border-hover hover:bg-surface-hover"
                    }`}
      >
        {checked ? "On" : "Off"}
      </button>
    </div>
  );
}
