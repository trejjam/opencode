import { describe, expect, test } from "bun:test"
import { once } from "node:events"
import { createServer } from "node:http"
import { bareServerAddress, legacyPairingLink, pairingLink, redeemPairingLink } from "./pairing"

describe("pairing link", () => {
  test("reads the server address and code from opencode pair links", () => {
    expect(pairingLink(" http://192.168.1.2:49374/auth/connect/abc_DEF-123 ")).toEqual({
      urls: ["http://192.168.1.2:49374"],
      code: "abc_DEF-123",
    })
  })

  test("reads every server address from opencode pair QR codes", () => {
    expect(
      pairingLink(
        JSON.stringify({ code: "abc_DEF-123", urls: ["http://192.168.1.2:49374", "http://100.64.0.3:49374"] }),
      ),
    ).toEqual({
      urls: ["http://192.168.1.2:49374", "http://100.64.0.3:49374"],
      code: "abc_DEF-123",
    })
  })

  test("rejects other URLs", () => {
    expect(pairingLink("http://192.168.1.2:49374/auth/connect/")).toBeUndefined()
    expect(pairingLink("http://192.168.1.2:49374/auth/connect/abc/extra")).toBeUndefined()
    expect(pairingLink("http://192.168.1.2:49374/connect#abc")).toBeUndefined()
    expect(pairingLink("opencode-ios://auth/connect/abc")).toBeUndefined()
    expect(pairingLink("192.168.1.2:49374")).toBeUndefined()
  })

  test("rejects malformed QR payloads", () => {
    expect(pairingLink(JSON.stringify({ code: "abc", urls: [] }))).toBeUndefined()
    expect(pairingLink(JSON.stringify({ code: "a/b", urls: ["http://192.168.1.2:49374"] }))).toBeUndefined()
    expect(pairingLink(JSON.stringify({ code: "abc", urls: ["opencode-ios://host"] }))).toBeUndefined()
    expect(pairingLink(JSON.stringify({ urls: ["http://192.168.1.2:49374"] }))).toBeUndefined()
    expect(pairingLink("{not json")).toBeUndefined()
  })

  test("treats only a host without a path as a server address typed into the pairing link field", () => {
    expect(bareServerAddress("192.168.1.2:4096")).toBe("http://192.168.1.2:4096")
    expect(bareServerAddress("https://opencode.example.com/")).toBe("https://opencode.example.com")
    expect(bareServerAddress("localhost")).toBe("http://localhost")
    expect(bareServerAddress("devbox:4096")).toBe("http://devbox:4096")
    expect(bareServerAddress("[::1]:4096")).toBe("http://[::1]:4096")
    expect(bareServerAddress("abc_DEF-123")).toBeUndefined()
    expect(bareServerAddress("http://192.168.1.2:4096/auth/connect/")).toBeUndefined()
    expect(bareServerAddress("http://192.168.1.2:4096/auth/connect/…")).toBeUndefined()
    expect(bareServerAddress("http://192.168.1.2:4096/connect")).toBeUndefined()
  })

  test("recognizes the credential links that servers printed before one-time links", () => {
    expect(legacyPairingLink("http://192.168.1.2:49374/connect#eyJ1c2VybmFtZSI6Im9wZW5jb2RlIn0")).toBe(true)
    expect(legacyPairingLink("http://192.168.1.2:49374/connect?data=eyJ1c2VybmFtZSI6Im9wZW5jb2RlIn0")).toBe(true)
    expect(legacyPairingLink("http://192.168.1.2:49374/connect")).toBe(false)
    expect(legacyPairingLink("http://192.168.1.2:49374/auth/connect/abc")).toBe(false)
  })

  test.each([undefined, { "CF-Access-Client-Id": "client", "CF-Access-Client-Secret": "access" }])(
    "redeems with custom headers and preserves them when preferring the first reachable address (%p)",
    async (headers) => {
      const requests: Array<{
        address: string
        path: string
        authorization: string | null
        client: string | null
        secret: string | null
      }> = []
      const servers = ["first", "second"].map((address) =>
        createServer((request, response) => {
          response.setHeader("access-control-allow-origin", "*")
          response.setHeader("access-control-allow-headers", "*")
          response.setHeader("access-control-allow-methods", "GET, OPTIONS")

          if (request.method === "OPTIONS") {
            response.writeHead(204)
            response.end()

            return
          }

          requests.push({
            address,
            path: request.url ?? "",
            authorization: request.headers.authorization ?? null,
            client: String(request.headers["cf-access-client-id"] ?? "") || null,
            secret: String(request.headers["cf-access-client-secret"] ?? "") || null,
          })
          response.setHeader("content-type", "application/json")

          if (address === "second") {
            response.end(JSON.stringify({ token: "paired-token" }))

            return
          }

          if (request.url?.startsWith("/auth/connect/")) {
            response.writeHead(401)
            response.end(JSON.stringify({ _tag: "UnauthorizedError", message: "Code already redeemed" }))

            return
          }

          response.end(JSON.stringify({ version: "2.0.0", pid: 1, urls: [], paths: { tmp: "/tmp/opencode" } }))
        }).listen(0, "127.0.0.1"),
      )

      try {
        await Promise.all(servers.map((server) => once(server, "listening")))
        const urls = servers.map((server) => {
          const address = server.address()

          if (!address || typeof address === "string") throw new Error("Pairing server did not bind a port")

          return `http://127.0.0.1:${address.port}`
        })

        expect(await redeemPairingLink({ urls, code: "pair-code" }, headers)).toEqual({
          type: "paired",
          pairing: { url: urls[0], password: "paired-token", ...(headers ? { headers } : {}) },
        })
        expect(
          requests
            .filter((request) => request.path.startsWith("/auth/connect/"))
            .sort((a, b) => a.address.localeCompare(b.address)),
        ).toEqual(
          ["first", "second"].map((address) => ({
            address,
            path: "/auth/connect/pair-code",
            authorization: null,
            client: headers ? "client" : null,
            secret: headers ? "access" : null,
          })),
        )
        expect(requests.filter((request) => request.path === "/api/info")).toEqual([
          {
            address: "first",
            path: "/api/info",
            authorization: `Basic ${btoa("opencode:paired-token")}`,
            client: headers ? "client" : null,
            secret: headers ? "access" : null,
          },
        ])
      } finally {
        await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))))
      }
    },
  )
})
