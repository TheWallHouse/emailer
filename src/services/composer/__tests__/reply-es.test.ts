import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { i18next } from "@/i18n"
import type { MessageRow } from "@/services/db/messages"
import { BASE_TIME } from "@/services/db/__tests__/fixtures"
import {
  buildForwardQuote,
  buildQuotedHistory,
  ensureSubjectPrefix,
  formatQuoteDate,
} from "../reply"

/**
 * Outgoing quote/forward headers follow the interface language when the
 * reply is built; Spanish mirrors Gmail's wording. (English output is
 * pinned by reply.test.ts.)
 */

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    subject: "Lunch plans",
    from_name: "Alice",
    from_address: "alice@example.com",
    to_json: JSON.stringify([{ name: "Me", email: "me@example.com" }]),
    cc_json: null,
    date: BASE_TIME,
    body_html: "<p>Original message text</p>",
    body_text: null,
    ...overrides,
  } as MessageRow
}

describe("outgoing headers in Spanish", () => {
  beforeEach(async () => {
    await i18next.changeLanguage("es")
  })
  afterEach(async () => {
    await i18next.changeLanguage("en")
  })

  it("formats the quote date Gmail-style, 24h, UTC", () => {
    expect(formatQuoteDate(BASE_TIME)).toBe("mar, 14 nov 2023, 22:13")
    expect(formatQuoteDate(0)).toBe("jue, 1 ene 1970, 00:00")
  })

  it("writes the reply quote header", () => {
    expect(buildQuotedHistory(makeMessage())).toContain(
      "<p>El mar, 14 nov 2023, 22:13, Alice &lt;alice@example.com&gt; escribió:</p>"
    )
  })

  it("writes the forwarded-message block", () => {
    const html = buildForwardQuote(makeMessage())
    expect(html).toContain("<p>---------- Mensaje reenviado ----------</p>")
    expect(html).toContain(
      "De: Alice &lt;alice@example.com&gt;<br>Fecha: mar, 14 nov 2023, 22:13<br>Asunto: Lunch plans<br>Para: Me &lt;me@example.com&gt;"
    )
  })

  it("keeps the Re:/Fwd: subject prefixes, like Gmail", () => {
    expect(ensureSubjectPrefix("Lunch plans", "Re:")).toBe("Re: Lunch plans")
    expect(ensureSubjectPrefix("Lunch plans", "Fwd:")).toBe("Fwd: Lunch plans")
  })
})
