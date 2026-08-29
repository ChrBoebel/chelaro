"use client";

import {
  type ChangeEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  ApiErrorResponse,
  DocumentListResponse,
  DocumentResource,
  DocumentResponse,
} from "@/lib/documents";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

type Notice = {
  tone: "error" | "success";
  message: string;
};

export function DocumentInbox() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<DocumentResource[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function reloadDocuments() {
    setIsLoading(true);
    setLoadError(null);
    try {
      const payload = await requestDocuments();
      setDocuments(payload.data);
    } catch (error) {
      setLoadError(loadErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void requestDocuments(controller.signal)
      .then((payload) => {
        setDocuments(payload.data);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(loadErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function uploadFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (files.length === 0 || isUploading) return;

    const oversized = files.find((file) => file.size > MAX_UPLOAD_BYTES);
    if (oversized) {
      setNotice({
        tone: "error",
        message: `${oversized.name} ist größer als 25 MB.`,
      });
      return;
    }

    setIsUploading(true);
    setNotice(null);
    const uploaded: DocumentResource[] = [];
    let duplicateCount = 0;

    try {
      for (const file of files) {
        const formData = new FormData();
        formData.set("file", file, file.name);
        const response = await fetch("/api/documents", {
          method: "POST",
          body: formData,
        });
        if (!response.ok) throw new Error(await responseMessage(response));
        const payload = (await response.json()) as DocumentResponse;
        uploaded.push(payload.data);
        if (response.status === 200) duplicateCount += 1;
      }

      setDocuments((current) => {
        const uploadedIds = new Set(uploaded.map((document) => document.id));
        return [...uploaded, ...current.filter((item) => !uploadedIds.has(item.id))];
      });
      const storedCount = uploaded.length - duplicateCount;
      const parts = [
        storedCount > 0
          ? `${storedCount} ${storedCount === 1 ? "Beleg" : "Belege"} gespeichert`
          : null,
        duplicateCount > 0
          ? `${duplicateCount} bereits vorhanden`
          : null,
      ].filter(Boolean);
      setNotice({ tone: "success", message: `${parts.join(" · ")}.` });
    } catch (error) {
      setNotice({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Der Upload konnte nicht abgeschlossen werden.",
      });
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void uploadFiles(event.target.files);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    void uploadFiles(event.dataTransfer.files);
  }

  return (
    <section className="pt-10 sm:pt-14" aria-labelledby="documents-title">
      <PageHeader
        titleId="documents-title"
        eyebrow="Dokumentenarchiv"
        title="Deine Belege."
        description="Originale werden unverändert gespeichert und mit einem eindeutigen Fingerabdruck belegt."
        actions={(
          <p className="font-mono text-xs tabular-nums text-muted" aria-live="polite">
            {isLoading
              ? "Wird synchronisiert …"
              : `${documents.length} ${documents.length === 1 ? "Dokument" : "Dokumente"}`}
          </p>
        )}
      />

      <section
        className="mt-9 border-y border-line bg-surface/45 px-4 py-5 sm:px-6 sm:py-6"
        data-dragging={isDragging ? "true" : "false"}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setIsDragging(false);
          }
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        aria-labelledby="upload-title"
      >
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-paper text-accent shadow-[0_1px_2px_rgba(20,25,20,0.05)]"
            >
              <UploadIcon />
            </span>
            <div>
              <h2 id="upload-title" className="text-sm font-semibold text-ink">
                Belege hinzufügen
              </h2>
              <p className="mt-1 text-pretty text-sm leading-5 text-muted">
                PDF, PNG oder JPEG · maximal 25 MB pro Datei
              </p>
            </div>
          </div>

          <input
            ref={inputRef}
            id="document-upload"
            className="sr-only"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            multiple
            onChange={handleInput}
            disabled={isUploading}
            tabIndex={-1}
            aria-hidden="true"
          />
          <Button
            size="regular"
            onClick={() => inputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? "Wird gespeichert …" : "Dateien auswählen"}
          </Button>
        </div>
        <p
          className="mt-4 text-sm empty:mt-0"
          data-tone={notice?.tone}
          aria-live="polite"
        >
          {notice?.message}
        </p>
      </section>

      <section className="mt-10" aria-labelledby="archive-title">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <h2 id="archive-title" className="text-sm font-semibold text-ink">
            Archiv
          </h2>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.14em] text-muted sm:block">
            Original · SHA-256
          </span>
        </div>

        {loadError ? (
          <div className="flex flex-col gap-4 border-b border-line py-7 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-ink">Archiv nicht erreichbar</p>
              <p className="mt-1 text-sm leading-6 text-muted">{loadError}</p>
            </div>
            <Button
              variant="secondary"
              size="regular"
              className="self-start sm:self-auto"
              onClick={() => void reloadDocuments()}
            >
              Erneut versuchen
            </Button>
          </div>
        ) : isLoading ? (
          <DocumentSkeleton />
        ) : documents.length === 0 ? (
          <div className="border-b border-line py-12 text-center">
            <p className="text-sm font-medium text-ink">Noch keine Belege</p>
            <p className="mt-1 text-sm text-muted">
              Der erste Upload erscheint hier – unverändert und nachweisbar.
            </p>
          </div>
        ) : (
          <ol>
            {documents.map((document, index) => (
              <DocumentRow key={document.id} document={document} index={index + 1} />
            ))}
          </ol>
        )}
      </section>
    </section>
  );
}

function DocumentRow({
  document,
  index,
}: {
  document: DocumentResource;
  index: number;
}) {
  return (
    <li className="group grid min-h-[76px] grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-line sm:grid-cols-[2.5rem_minmax(0,1.5fr)_minmax(8rem,0.6fr)_minmax(8rem,0.55fr)_2.75rem] sm:gap-5">
      <span className="font-mono text-[10px] tabular-nums text-muted">
        {String(index).padStart(2, "0")}
      </span>
      <div className="min-w-0 py-4">
        <p className="truncate text-sm font-semibold tracking-[-0.01em] text-ink">
          {document.filename}
        </p>
        <p className="mt-1 font-mono text-[10px] text-muted sm:hidden">
          {formatBytes(document.size_bytes)} · {formatDate(document.created_at)}
        </p>
      </div>
      <div className="hidden min-w-0 sm:block">
        <p className="text-xs tabular-nums text-muted">
          {formatBytes(document.size_bytes)}
        </p>
        <p className="mt-1 truncate font-mono text-[10px] text-muted">
          {document.sha256.slice(0, 12)}…
        </p>
      </div>
      <div className="hidden sm:block">
        <p className="text-xs tabular-nums text-muted">
          {formatDate(document.created_at)}
        </p>
        <StatusBadge tone="confirmed" className="mt-1 min-h-5 border-0 bg-transparent px-0 py-0 text-[10px]">
          Gespeichert
        </StatusBadge>
      </div>
      <a
        href={`/api/documents/${document.id}/content`}
        className="grid size-11 place-items-center rounded-xl text-muted transition-[background-color,color,transform] duration-150 hover:bg-surface hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-[0.96]"
        aria-label={`${document.filename} herunterladen`}
      >
        <DownloadIcon />
      </a>
    </li>
  );
}

function DocumentSkeleton() {
  return (
    <div aria-busy="true" aria-label="Dokumente werden geladen">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          aria-hidden="true"
          className="grid min-h-[76px] grid-cols-[2rem_minmax(0,1fr)_2.75rem] items-center gap-3 border-b border-line sm:grid-cols-[2.5rem_minmax(0,1.5fr)_minmax(8rem,0.6fr)_minmax(8rem,0.55fr)_2.75rem] sm:gap-5"
        >
          <span className="h-2 w-3 animate-pulse rounded bg-line" />
          <span className="h-3 w-2/3 animate-pulse rounded bg-line" />
          <span className="hidden h-3 w-16 animate-pulse rounded bg-line sm:block" />
          <span className="hidden h-3 w-20 animate-pulse rounded bg-line sm:block" />
          <span className="size-8 animate-pulse rounded-xl bg-line" />
        </div>
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

async function responseMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorResponse;
    const messages: Record<string, string> = {
      api_not_configured: "Die lokale Verbindung ist noch nicht eingerichtet.",
      api_unavailable: "Der lokale Finanzdienst ist gerade nicht erreichbar.",
      empty_document: "Die ausgewählte Datei ist leer.",
      file_too_large: "Die Datei ist größer als 25 MB.",
      unsupported_document_type: "Bitte verwende eine PDF-, PNG- oder JPEG-Datei.",
    };
    return messages[payload.error.code] ?? payload.error.message;
  } catch {
    return "Die Anfrage konnte nicht abgeschlossen werden.";
  }
}

async function requestDocuments(signal?: AbortSignal): Promise<DocumentListResponse> {
  const response = await fetch("/api/documents?limit=50", {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(await responseMessage(response));
  return (await response.json()) as DocumentListResponse;
}

function loadErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Dokumente konnten nicht geladen werden.";
}

function UploadIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M9 12.5V3.75M5.75 7 9 3.75 12.25 7M3.5 11.5v2.25c0 .97.78 1.75 1.75 1.75h7.5c.97 0 1.75-.78 1.75-1.75V11.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 18 18" fill="none">
      <path d="M9 3.25V12m0 0 3.25-3.25M9 12 5.75 8.75M4 14.75h10" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
