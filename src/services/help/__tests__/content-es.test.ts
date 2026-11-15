import { afterEach, describe, expect, it } from "vitest"

import { i18next } from "@/i18n"

import {
  HELP_CARDS,
  HELP_CATEGORIES,
  getHelpCards,
  helpCategoryLabel,
} from "../content"
import { HELP_CARDS_ES } from "../content.es"
import { searchHelpCards } from "../search"

/**
 * The Spanish help catalog (content.es.ts) must stay in lockstep with the
 * English source of truth (content.ts): every card translated, nothing
 * extra, the same paragraph structure, and the localized catalog must
 * keep the English ids/categories/order plus the English keywords.
 */
describe("Spanish help catalog", () => {
  afterEach(async () => {
    await i18next.changeLanguage("en")
  })

  it("translates every English card, with the same paragraph count", () => {
    for (const card of HELP_CARDS) {
      const es = HELP_CARDS_ES[card.id]
      expect(es, `missing Spanish card "${card.id}"`).toBeDefined()
      expect(es.title.trim().length).toBeGreaterThan(0)
      expect(es.body.length, `paragraphs of "${card.id}"`).toBe(
        card.body.length
      )
      for (const paragraph of es.body) {
        expect(paragraph.trim().length).toBeGreaterThan(0)
      }
      expect(es.keywords.length).toBeGreaterThan(0)
    }
  })

  it("has no translation for a card that no longer exists", () => {
    const ids = new Set(HELP_CARDS.map((card) => card.id))
    for (const id of Object.keys(HELP_CARDS_ES)) {
      expect(ids.has(id), `stale Spanish card "${id}"`).toBe(true)
    }
  })

  it("English stays the untouched source catalog", () => {
    expect(getHelpCards("en")).toBe(HELP_CARDS)
    expect(helpCategoryLabel("Getting started")).toBe("Getting started")
  })

  it("localizes cards and categories, keeping ids, order and English keywords", async () => {
    const cards = getHelpCards("es")
    expect(cards.map((card) => card.id)).toEqual(
      HELP_CARDS.map((card) => card.id)
    )
    const snooze = cards.find((card) => card.id === "snooze")
    expect(snooze?.title).toBe("Posponer una conversación")
    expect(snooze?.keywords).toContain("snooze")
    expect(snooze?.keywords).toContain("posponer")

    await i18next.changeLanguage("es")
    expect(helpCategoryLabel("Getting started")).toBe("Primeros pasos")
    for (const category of HELP_CATEGORIES) {
      expect(helpCategoryLabel(category)).not.toBe("")
    }
  })

  it("Spanish search finds cards by Spanish words, unaccented words and English keywords", async () => {
    await i18next.changeLanguage("es")
    expect(searchHelpCards("posponer")[0]?.id).toBe("snooze")
    expect(searchHelpCards("snooze")[0]?.id).toBe("snooze")
    expect(searchHelpCards("codigo fuente")[0]?.id).toBe("message-source")
    expect(searchHelpCards("primeros pasos").length).toBeGreaterThan(0)
  })
})
