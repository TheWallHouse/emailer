import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { invoke } from "@tauri-apps/api/core"
import {
  listen,
  type Event,
  type EventCallback,
  type UnlistenFn,
} from "@tauri-apps/api/event"

import {
  isAutostartEnabled,
  isTrayAvailable,
  onComposeRequest,
  pushTrayLabels,
  setAutostartEnabled,
  syncTrayLabels,
} from "../tray"
import { i18next } from "@/i18n"

/**
 * Desktop-integration bridge (task 1.2, spec desktop-integration). Every
 * wrapper is best-effort: outside the Tauri runtime the commands/events
 * reject and the wrappers must degrade — tray reported unavailable,
 * autostart read reported disabled, compose subscription resolved to a
 * no-op unsubscribe — because the settings UI wires them
 * fire-and-forget.
 */

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }))

const invokeMock = vi.mocked(invoke)
const listenMock = vi.mocked(listen)

beforeEach(() => {
  invokeMock.mockReset()
  listenMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("tray availability", () => {
  it("reports the Rust command's answer", async () => {
    invokeMock.mockResolvedValueOnce(true)
    expect(await isTrayAvailable()).toBe(true)
    expect(invokeMock).toHaveBeenCalledWith("tray_available")
  })

  it("degrades to unavailable when the command rejects (no tray platform)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("command not found"))
    expect(await isTrayAvailable()).toBe(false)
  })
})

describe("autostart", () => {
  it("reads the OS registration state", async () => {
    invokeMock.mockResolvedValueOnce(true)
    expect(await isAutostartEnabled()).toBe(true)
    expect(invokeMock).toHaveBeenCalledWith("autostart_is_enabled")
  })

  it("reads disabled when the command rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("not supported"))
    expect(await isAutostartEnabled()).toBe(false)
  })

  it("registers with the enabled flag carried through", async () => {
    invokeMock.mockResolvedValueOnce(undefined)
    await setAutostartEnabled(true)
    expect(invokeMock).toHaveBeenCalledWith("autostart_set_enabled", {
      enabled: true,
    })
  })

  it("rethrows a failed registration after warning — the toggle must reflect reality", async () => {
    invokeMock.mockRejectedValueOnce(new Error("registration failed"))
    await expect(setAutostartEnabled(false)).rejects.toThrow(
      "registration failed"
    )
  })
})

describe("compose request subscription", () => {
  it("subscribes to the compose-request event name", async () => {
    listenMock.mockResolvedValue(vi.fn() as unknown as UnlistenFn)
    await onComposeRequest(() => {})
    expect(listenMock).toHaveBeenCalledWith(
      "compose-request",
      expect.any(Function)
    )
  })

  it("delivers desktop compose requests to the handler and unsubscribes", async () => {
    // Assigned inside the mocked listen() callback, which TS's control-flow
    // analysis cannot see — the cast keeps the declared union instead of
    // narrowing to null (which made `captured?.(…)` type as never).
    let captured = null as EventCallback<unknown> | null
    let unlisten = null as UnlistenFn | null
    listenMock.mockImplementationOnce(
      async (_event: string, handler: EventCallback<unknown>) => {
        captured = handler
        unlisten = () => {
          captured = null
        }
        return unlisten
      }
    )

    let calls = 0
    const off = await onComposeRequest(() => {
      calls += 1
    })
    captured?.({} as Event<unknown>)
    expect(calls).toBe(1)
    off()
    expect(captured).toBeNull()
    expect(unlisten).not.toBeNull()
  })

  it("resolves to a no-op unsubscribe outside the Tauri runtime", async () => {
    listenMock.mockRejectedValueOnce(new Error("window.__TAURI__ missing"))
    const unlisten = await onComposeRequest(() => {})
    expect(typeof unlisten).toBe("function")
    expect(() => unlisten()).not.toThrow()
  })
})

describe("tray labels", () => {
  afterEach(async () => {
    await i18next.changeLanguage("en")
  })

  it("pushes the localized menu labels and a {count} tooltip template", async () => {
    invokeMock.mockResolvedValue(null)
    await pushTrayLabels()
    expect(invokeMock).toHaveBeenCalledWith("set_tray_labels", {
      labels: {
        open: "Open Emailer",
        compose: "Compose",
        quit: "Quit",
        unreadTooltip: "Emailer — {count} unread",
      },
    })
  })

  it("re-pushes on a language change until unsubscribed", async () => {
    invokeMock.mockResolvedValue(null)
    const off = syncTrayLabels()
    await i18next.changeLanguage("es")
    expect(invokeMock).toHaveBeenLastCalledWith("set_tray_labels", {
      labels: {
        open: "Abrir Emailer",
        compose: "Redactar",
        quit: "Salir",
        unreadTooltip: "Emailer — {count} sin leer",
      },
    })
    off()
    const calls = invokeMock.mock.calls.length
    await i18next.changeLanguage("en")
    expect(invokeMock.mock.calls.length).toBe(calls)
  })

  it("degrades to a no-op outside the Tauri runtime", async () => {
    invokeMock.mockRejectedValue(new Error("no tauri"))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    await expect(pushTrayLabels()).resolves.toBeUndefined()
  })
})
