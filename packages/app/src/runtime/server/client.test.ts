import { describe, expect, test } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client/promise"
import { createRoot } from "solid-js"
import { createOpenCodeEventSource, createServerTransport } from "./client"

const permission = {
  id: "evt_permission",
  created: 1,
  type: "permission.asked",
  location: { directory: "/repo", workspaceID: "workspace_1" },
  data: {
    id: "perm_1",
    sessionID: "ses_1",
    action: "read",
    resources: ["src/**"],
    source: { type: "tool", messageID: "msg_1", id: "call_1" },
  },
} satisfies Extract<OpenCodeEvent, { type: "permission.asked" }>

function setup() {
  return createRoot((dispose) => ({ ...createOpenCodeEventSource(), dispose }))
}

describe("server event stream", () => {
  test("publishes the original current event with exact data", () => {
    const server = setup()
    const received: OpenCodeEvent[] = []
    let requestID: string | undefined

    server.event.on("permission.asked", (event) => {
      requestID = event.data.id
    })
    server.event.listen((event) => received.push(event))
    server.publish(permission)

    expect(requestID).toBe("perm_1")
    expect(received).toEqual([permission])
    expect(received[0]).toBe(permission)
    server.dispose()
  })

  test("filters locations without changing workspace identity", () => {
    const server = setup()
    const repo: OpenCodeEvent[] = []
    const other: OpenCodeEvent[] = []
    const all: OpenCodeEvent[] = []
    let workspaceID: string | undefined

    const global = {
      id: "evt_connected",
      type: "server.connected",
      data: {},
    } satisfies Extract<OpenCodeEvent, { type: "server.connected" }>

    const repoEvents = server.event.location("/repo")
    repoEvents.on("permission.asked", (event) => {
      workspaceID = event.location?.workspaceID
    })
    repoEvents.listen((event) => repo.push(event))
    server.event.location("/other").listen((event) => other.push(event))
    server.event.listen((event) => all.push(event))
    server.publish(permission)
    server.publish(global)

    expect(repo).toEqual([permission])
    expect(workspaceID).toBe("workspace_1")
    expect(other).toEqual([])
    expect(all).toEqual([permission, global])
    server.dispose()
  })

  test("isolates servers and clears subscriptions with their owner", () => {
    const first = setup()
    const second = setup()
    const received = { first: 0, second: 0 }

    first.event.listen(() => received.first++)
    second.event.listen(() => received.second++)
    first.publish(permission)
    first.dispose()
    first.publish(permission)
    second.publish(permission)

    expect(received).toEqual({ first: 1, second: 1 })
    second.dispose()
  })
})

test("rotates HTTP, SSE and PTY ticket headers together, including header-only edits", async () => {
  const requests: Array<{ url: string; authorization: string | null; client: string | null }> = []

  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init)
    requests.push({
      url: request.url,
      authorization: request.headers.get("authorization"),
      client: request.headers.get("cf-access-client-id"),
    })

    if (new URL(request.url).pathname === "/api/event")
      return new Response('data: {"type":"server.connected","data":{}}\n\n', {
        headers: { "content-type": "text/event-stream" },
      })

    // Stop at the HTTP ticket boundary: a browser WebSocket cannot send these custom headers.
    if (new URL(request.url).pathname.endsWith("/connect-token"))
      return Response.json({ _tag: "UnauthorizedError", message: "Authentication required" }, { status: 401 })

    return Response.json({
      version: "2.0.0-test",
      pid: 1,
      urls: [request.url],
      paths: { tmp: "/tmp/opencode" },
    })
  }) as typeof globalThis.fetch

  const transport = createServerTransport({
    http: { url: "http://127.0.0.1:4100", password: "first" },
    fetch,
  })

  const initialPty = transport.pty

  await transport.api.server.info()

  const replacement = transport.update({
    url: "http://127.0.0.1:4200",
    password: "second",
    headers: { "CF-Access-Client-Id": "first-client" },
  })

  await transport.api.server.info()

  expect(replacement).toBe(transport.api)
  expect(transport.pty).not.toBe(initialPty)
  expect(transport.url).toBe("http://127.0.0.1:4200")
  expect(requests).toEqual([
    {
      url: "http://127.0.0.1:4100/api/info",
      authorization: `Basic ${btoa("opencode:first")}`,
      client: null,
    },
    {
      url: "http://127.0.0.1:4200/api/info",
      authorization: `Basic ${btoa("opencode:second")}`,
      client: "first-client",
    },
  ])

  const previousPty = transport.pty
  const previousApi = transport.api
  transport.update({
    url: "http://127.0.0.1:4200",
    password: "second",
    headers: { "cf-access-client-id": "updated-client", aUtHoRiZaTiOn: "Bearer custom" },
  })

  expect(transport.api).not.toBe(previousApi)
  expect(transport.pty).not.toBe(previousPty)
  requests.length = 0

  await transport.api.server.info()
  const events: OpenCodeEvent[] = []
  for await (const event of transport.api.event.subscribe()) events.push(event)
  expect(events).toEqual([{ type: "server.connected", data: {} }])
  await expect(transport.pty.connect({ ptyID: "pty_1" })).rejects.toThrow()

  expect(requests).toEqual(
    ["/api/info", "/api/event", "/api/pty/pty_1/connect-token"].map((path) => ({
      url: `http://127.0.0.1:4200${path}`,
      authorization: "Bearer custom",
      client: "updated-client",
    })),
  )
})
