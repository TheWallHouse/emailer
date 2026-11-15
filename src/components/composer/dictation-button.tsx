import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import type { Editor } from "@tiptap/react"
import { useTranslation } from "react-i18next"
import { Loader2, Mic, Square, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Popover, PopoverContent } from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "sonner"

import { getExecutor } from "@/services/db/executor"
import {
  beginDictation,
  dictationSupported,
  DictationCancelledError,
  type ActiveDictation,
} from "@/services/voice/dictation"
import {
  cancelWhisperModelDownload,
  downloadWhisperModel,
  getWhisperDownloadSnapshot,
  getWhisperModelDir,
  subscribeWhisperDownload,
  whisperModelPresent,
  WHISPER_TOTAL_BYTES,
} from "@/services/voice/model"
import { getDictationLanguage } from "@/services/voice/settings"

/**
 * Composer dictation control (parity-round-3 task 7.2, spec ai-assistance
 * "Voice dictation in the composer"): a toolbar mic that records via the
 * dictation service (MediaRecorder → 16 kHz mono WAV temp file → local
 * whisper) and inserts the transcript AT THE CURSOR through the same
 * focused-chain insertion the snippet picker uses — typed-input-like, no
 * pending-offer bar (dictation is the user's own voice going in directly;
 * the cancel path is the explicit discard affordance).
 *
 * First-use download (spec "First-use download"): the model is NOT
 * fetched until the feature is first used. A mic press with no model
 * opens the consent popover — the ~148 MB size stated BEFORE anything
 * downloads — then downloads with visible progress and starts the
 * recording only after the download completes. Cancelling the download
 * (or the popover) enables nothing.
 *
 * Cancel (spec "Cancel mid-dictation"): the ✕ beside the mic aborts the
 * recording, deletes the temp file and inserts nothing — the composer
 * text is untouched. It stays available while transcription runs (a
 * late cancel still inserts nothing).
 *
 * Hidden entirely outside the Tauri runtime / without MediaRecorder
 * (dictationSupported) — unconfigured affordances hide, never error.
 */

type Phase = "idle" | "consent" | "recording" | "transcribing"

/** Rough human size for the consent copy (decimal MB — the same "~148
 * MB" number the model catalog and design D3 state). */
function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`
}

/** Transcript text → inline HTML: escaped, newlines as <br> (mirrors the
 * snippet body's single-block inline conversion). The transcript is the
 * user's OWN voice — trusted input, no untrusted-text treatment; it just
 * must not be parsed as markup. */
function dictationTextToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
  return escaped.replace(/\n/g, "<br>")
}

export function DictationButton({ editor }: { editor: Editor | null }) {
  const { t } = useTranslation()
  const supported = useMemo(() => dictationSupported(), [])
  const [phase, setPhase] = useState<Phase>("idle")
  const [consentError, setConsentError] = useState<string | null>(null)
  const sessionRef = useRef<ActiveDictation | null>(null)
  // Set on unmount: an in-flight async chain (download-then-record) must
  // not open the microphone after the composer is gone, and an open
  // session must be cancelled — a leaked stream keeps the mic hot with
  // the cancel affordance already unmounted.
  const disposedRef = useRef(false)
  // Set when the consent popover is dismissed while its download runs:
  // the in-flight chain must not resurrect into a recording.
  const consentAbandonedRef = useRef(false)
  const download = useSyncExternalStore(
    subscribeWhisperDownload,
    getWhisperDownloadSnapshot
  )

  useEffect(() => {
    return () => {
      disposedRef.current = true
      const session = sessionRef.current
      sessionRef.current = null
      if (session) void session.cancel()
    }
  }, [])

  const startRecording = useCallback(async () => {
    try {
      const session = await beginDictation()
      if (disposedRef.current) {
        // Unmounted while the mic permission dialog was up — release
        // immediately instead of recording into a dead composer.
        await session.cancel()
        return
      }
      sessionRef.current = session
      setPhase("recording")
    } catch (error) {
      if (disposedRef.current) return
      console.warn("[composer] dictation start failed", error)
      toast.error(
        error instanceof Error
          ? error.message
          : t("composer.dictation.startFailed")
      )
      setPhase("idle")
    }
  }, [t])

  const stopAndInsert = useCallback(async () => {
    const session = sessionRef.current
    if (!session || !editor || editor.isDestroyed) return
    setPhase("transcribing")
    try {
      // The language setting is read at TRANSCRIBE time (task 7.2) — a
      // change in settings applies to the very next utterance.
      let language = ""
      try {
        language = await getDictationLanguage(getExecutor())
      } catch {
        // No executor (unit edge): auto-detect.
      }
      const text = await session.stop(language)
      if (editor.isDestroyed) return
      editor.chain().focus().insertContent(dictationTextToHtml(text)).run()
    } catch (error) {
      if (error instanceof DictationCancelledError) return // silent discard
      console.warn("[composer] dictation failed", error)
      toast.error(
        error instanceof Error
          ? error.message
          : t("composer.dictation.transcriptionFailed")
      )
    } finally {
      sessionRef.current = null
      setPhase("idle")
    }
  }, [editor, t])

  const cancel = useCallback(async () => {
    const session = sessionRef.current
    sessionRef.current = null
    setPhase("idle")
    if (session) await session.cancel()
  }, [])

  const handleMicClick = useCallback(() => {
    if (phase === "recording") {
      void stopAndInsert()
      return
    }
    if (phase !== "idle") return
    // Route on the persisted download row (the model module's read):
    // completed → record; anything else (or a failed settings read) →
    // the first-use consent popover.
    void (async () => {
      try {
        if (await whisperModelPresent(getExecutor())) {
          await startRecording()
        } else {
          setPhase("consent")
        }
      } catch {
        setPhase("consent")
      }
    })()
  }, [phase, startRecording, stopAndInsert])

  const startDownloadAndRecord = useCallback(async () => {
    setConsentError(null)
    consentAbandonedRef.current = false
    try {
      const modelDir = await getWhisperModelDir()
      const completed = await downloadWhisperModel(getExecutor(), modelDir)
      // Dismissing the popover mid-download abandons the chain: the
      // component's contract is "cancelling the download (or the popover)
      // enables nothing" — recording must not start without a visible
      // consent surface.
      if (!completed || consentAbandonedRef.current || disposedRef.current) {
        setPhase("idle")
        return
      }
      await startRecording()
    } catch (error) {
      setConsentError(
        error instanceof Error
          ? error.message
          : t("composer.dictation.downloadFailed")
      )
    }
  }, [startRecording, t])

  if (!supported) return null

  const downloading = download.state === "downloading"
  const downloadPercent =
    downloading && download.total
      ? Math.min(100, Math.round((download.received / download.total) * 100))
      : null
  const busy = phase === "recording" || phase === "transcribing"

  return (
    <div className="flex items-center gap-0.5">
      <Popover
        open={phase === "consent"}
        onOpenChange={(open) => {
          if (!open && phase === "consent") {
            if (download.state === "downloading") {
              // Stop the in-flight download and abort the record chain —
              // dismissing the surface is a cancellation.
              consentAbandonedRef.current = true
              void cancelWhisperModelDownload().catch(() => {})
            }
            setPhase("idle")
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                aria-label={
                  phase === "recording"
                    ? t("composer.dictation.stop")
                    : t("composer.dictation.dictate")
                }
                title={
                  phase === "recording"
                    ? t("composer.dictation.stopTitle")
                    : t("composer.dictation.dictateTitle")
                }
                data-testid="dictation-button"
                aria-pressed={phase === "recording"}
                disabled={editor === null || phase === "transcribing"}
                onClick={handleMicClick}
              >
                {phase === "transcribing" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : phase === "recording" ? (
                  <span className="flex items-center gap-1">
                    <span
                      data-testid="dictation-recording-dot"
                      aria-hidden
                      className="size-2 animate-pulse rounded-full bg-red-500"
                    />
                    <Square aria-hidden className="size-3.5" />
                  </span>
                ) : (
                  <Mic aria-hidden />
                )}
              </Button>
            }
          />
          {phase !== "consent" ? (
            <TooltipContent side="bottom">
              {phase === "recording"
                ? t("composer.dictation.stop")
                : t("composer.dictation.dictate")}
            </TooltipContent>
          ) : null}
        </Tooltip>
        <PopoverContent className="w-80" data-testid="dictation-consent">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-foreground">
              {t("composer.dictation.consentTitle")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("composer.dictation.consentBody", {
                size: formatBytes(WHISPER_TOTAL_BYTES),
              })}
            </p>
            {downloading ? (
              <>
                <p
                  data-testid="dictation-download-progress"
                  role="status"
                  className="text-xs text-muted-foreground"
                >
                  {download.total === null
                    ? t("composer.dictation.downloading", {
                        received: formatBytes(download.received),
                      })
                    : downloadPercent === null
                      ? t("composer.dictation.downloadingOf", {
                          received: formatBytes(download.received),
                          total: formatBytes(download.total),
                        })
                      : t("composer.dictation.downloadingPercent", {
                          received: formatBytes(download.received),
                          total: formatBytes(download.total),
                          percent: downloadPercent,
                        })}
                </p>
                {downloadPercent !== null && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${downloadPercent}%` }}
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                {consentError ? (
                  <p
                    data-testid="dictation-download-error"
                    role="alert"
                    className="text-xs text-destructive"
                  >
                    {t("composer.dictation.downloadError", {
                      error: consentError,
                    })}
                  </p>
                ) : null}
                <div className="flex items-center justify-end gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid="dictation-consent-cancel"
                    onClick={() => setPhase("idle")}
                  >
                    {t("composer.dictation.notNow")}
                  </Button>
                  <Button
                    size="sm"
                    data-testid="dictation-download-start"
                    onClick={() => {
                      void startDownloadAndRecord()
                    }}
                  >
                    {t("composer.dictation.downloadAndDictate")}
                  </Button>
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {busy ? (
        <Button
          variant="ghost"
          size="sm"
          aria-label={t("composer.dictation.cancel")}
          title={t("composer.dictation.cancelTitle")}
          data-testid="dictation-cancel"
          onClick={() => {
            void cancel()
          }}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  )
}
