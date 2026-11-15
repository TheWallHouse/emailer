import { useEffect, useRef } from "react"
import { ChevronDown, ChevronUp, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { i18next } from "@/i18n"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import type { FindSnapshot } from "./find-session"

/**
 * The reading-pane find bar (task 1.1, mail-reading spec "Find in
 * message"). Floats over the top-right of the message column so opening
 * and closing never reflows the thread — the spec's "close without losing
 * the reading position" is structural, not a scroll save.
 *
 * Count format is "1 of 3" (spec scenario); no matches reads "0 matches"
 * with the navigation buttons disabled (spec "No matches"). When collapsed
 * messages carry bodies that were not searched, their count rides along as
 * "N in collapsed messages" (design D5) — expanding them joins the search
 * through the frame registration seam.
 *
 * Keys: Enter = next match, Shift+Enter = previous, Escape closes (the
 * reference's accepted → next behavior, plus the shift variant). The
 * global shortcut hook handles Escape OUTSIDE the input; the input's own
 * handler covers focus-in-field.
 */

interface FindBarProps {
  snapshot: FindSnapshot
  onTermChange: (term: string) => void
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
}

export function FindBar({
  snapshot,
  onTermChange,
  onNext,
  onPrevious,
  onClose,
}: FindBarProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus on open (the reference's find-input.focus()); repeat Ctrl/Cmd+F
  // while already open simply leaves the caret where it is.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const hasTerm = snapshot.term !== ""
  const noMatches = hasTerm && snapshot.total === 0

  return (
    <div
      data-testid="find-bar"
      className="absolute top-2 right-4 z-20 flex items-center gap-1 rounded-lg border border-border bg-background p-1 shadow-md"
      role="search"
      aria-label={t("reader.findBar.find")}
    >
      <Input
        ref={inputRef}
        data-testid="find-input"
        value={snapshot.term}
        placeholder={t("reader.findBar.find")}
        aria-label={t("reader.findBar.find")}
        className="h-7 w-48 text-sm md:w-60"
        onChange={(event) => onTermChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            onClose()
          } else if (event.key === "Enter") {
            event.preventDefault()
            if (event.shiftKey) onPrevious()
            else onNext()
          }
        }}
      />
      <span
        data-testid="find-count"
        aria-live="polite"
        className="min-w-16 px-1 text-center text-xs text-muted-foreground tabular-nums"
      >
        {formatCount(snapshot)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        data-testid="find-previous"
        className="size-7"
        title={t("reader.findBar.previous")}
        aria-label={t("reader.findBar.previous")}
        disabled={noMatches}
        onClick={onPrevious}
      >
        <ChevronUp className="size-4" />
        <span className="sr-only">{t("reader.findBar.previous")}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        data-testid="find-next"
        className="size-7"
        title={t("reader.findBar.next")}
        aria-label={t("reader.findBar.next")}
        disabled={noMatches}
        onClick={onNext}
      >
        <ChevronDown className="size-4" />
        <span className="sr-only">{t("reader.findBar.next")}</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        data-testid="find-close"
        className="size-7"
        title={t("reader.findBar.close")}
        aria-label={t("reader.findBar.close")}
        onClick={onClose}
      >
        <X className="size-4" />
        <span className="sr-only">{t("reader.findBar.close")}</span>
      </Button>
    </div>
  )
}

/**
 * The spec's position count ("1 of 3"), "0 matches" when the term has no
 * occurrence, and the collapsed-messages hint (design D5) whenever
 * unsearched collapsed bodies exist. Empty term → nothing.
 */
function formatCount(snapshot: FindSnapshot): string {
  if (snapshot.term === "") return ""
  const position =
    snapshot.total === 0
      ? i18next.t("reader.findBar.noMatches")
      : i18next.t("reader.findBar.position", {
          current: snapshot.active + 1,
          total: snapshot.total,
        })
  if (snapshot.collapsed === 0) return position
  return `${position} · ${i18next.t("reader.findBar.collapsed", { count: snapshot.collapsed })}`
}
