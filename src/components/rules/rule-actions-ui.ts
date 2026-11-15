import { i18next } from "@/i18n"
import type { Category, RuleAction, RuleActionType } from "@/services/rules"

/**
 * Non-component pieces of the rule dialog, split out so the dialog file
 * stays a components-only module (react-refresh). The criteria help text
 * and the action vocabulary mirror services/search/parser.ts (the exact
 * operator set) and services/rules/actions.ts (the closed action union).
 */

/** The criteria help line under the advanced query input. A function, so
 * it follows the active language. */
export function criteriaHelp(): string {
  return i18next.t("settingsMail.ruleActions.criteriaHelp")
}

/** Action-type dropdown options; labels are getters (localized at read
 * time, never frozen at import). */
export const ACTION_TYPE_OPTIONS: readonly {
  readonly value: RuleActionType
  readonly label: string
}[] = [
  {
    value: "archive",
    get label() {
      return i18next.t("settingsMail.ruleActions.types.archive")
    },
  },
  {
    value: "trash",
    get label() {
      return i18next.t("settingsMail.ruleActions.types.trash")
    },
  },
  {
    value: "mark_as_spam",
    get label() {
      return i18next.t("settingsMail.ruleActions.types.markAsSpam")
    },
  },
  {
    value: "mark_read",
    get label() {
      return i18next.t("settingsMail.ruleActions.types.markRead")
    },
  },
  {
    value: "star",
    get label() {
      return i18next.t("settingsMail.ruleActions.types.star")
    },
  },
  {
    value: "add_labels",
    get label() {
      return i18next.t("settingsMail.ruleActions.types.addLabels")
    },
  },
  {
    value: "remove_labels",
    get label() {
      return i18next.t("settingsMail.ruleActions.types.removeLabels")
    },
  },
  {
    value: "move",
    get label() {
      return i18next.t("settingsMail.ruleActions.types.move")
    },
  },
  // Task 3.4 (design D4): names a category for the categorization pass —
  // no delivery effect (the executor ignores it; no announcement change).
  {
    value: "set_category",
    get label() {
      return i18next.t("settingsMail.ruleActions.types.setCategory")
    },
  },
]

/** Category values as the UI shows them (the storage values are
 * lowercase; the tabs are titled with the capitalized forms). Getters
 * reuse the sidebar's category names, so they follow the language. */
export const CATEGORY_LABELS: Readonly<Record<Category, string>> = {
  get primary() {
    return i18next.t("sidebar.categories.primary")
  },
  get updates() {
    return i18next.t("sidebar.categories.updates")
  },
  get promotions() {
    return i18next.t("sidebar.categories.promotions")
  },
  get social() {
    return i18next.t("sidebar.categories.social")
  },
  get newsletters() {
    return i18next.t("sidebar.categories.newsletters")
  },
}

export function actionChipLabel(action: RuleAction): string {
  switch (action.type) {
    case "archive":
      return i18next.t("settingsMail.ruleActions.types.archive")
    case "trash":
      return i18next.t("settingsMail.ruleActions.types.trash")
    case "mark_as_spam":
      return i18next.t("settingsMail.ruleActions.types.markAsSpam")
    case "mark_read":
      return i18next.t("settingsMail.ruleActions.types.markRead")
    case "star":
      return i18next.t("settingsMail.ruleActions.types.star")
    case "add_labels":
      return i18next.t("settingsMail.ruleActions.chips.label", {
        labels: (action.labels ?? []).join(", "),
      })
    case "remove_labels":
      return i18next.t("settingsMail.ruleActions.chips.remove", {
        labels: (action.labels ?? []).join(", "),
      })
    case "move":
      return i18next.t("settingsMail.ruleActions.chips.move", {
        folder: action.folder ?? "",
      })
    case "set_category":
      return i18next.t("settingsMail.ruleActions.chips.category", {
        category: CATEGORY_LABELS[action.category ?? "primary"],
      })
  }
}

/** Inverse of db.ts's storage wrapper: the raw query inside criteria_json
 * (a bare JSON string is tolerated, same as parseRuleCriteria). */
export function queryFromCriteriaJson(criteriaJson: string): string {
  try {
    const stored: unknown = JSON.parse(criteriaJson)
    if (typeof stored === "string") return stored
    if (typeof stored === "object" && stored !== null) {
      const query = (stored as { query?: unknown }).query
      if (typeof query === "string") return query
    }
  } catch {
    // Corrupt criteria render as an empty query — edit re-saves it fixed.
  }
  return ""
}
