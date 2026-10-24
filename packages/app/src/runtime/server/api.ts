import { OpenCode, type OpenCodeClient } from "@opencode/client/promise"
import type { ServerConnection } from "@/runtime/server/registry"
import { decode64 } from "@/runtime/persistence/base64"

export function authTokenFromCredentials(input: { password: string }) {
  return btoa(`opencode:${input.password}`)
}

export function authFromToken(token: string | null) {
  const decoded = decode64(token ?? undefined)

  if (!decoded) return
  const separator = decoded.indexOf(":")

  if (separator === -1) return

  return {
    password: decoded.slice(separator + 1),
  }
}

export function serverHeaders(server: ServerConnection.HttpBase): Record<string, string> | undefined {
  const headers = Object.fromEntries([
    ...(server.password ? [["authorization", `Basic ${authTokenFromCredentials({ password: server.password })}`]] : []),
    ...Object.entries(server.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  ])

  return Object.keys(headers).length ? headers : undefined
}

export function serverConnectionIdentity(server: ServerConnection.HttpBase) {
  return JSON.stringify([server.url, server.password ?? "", Object.entries(serverHeaders(server) ?? {}).sort()])
}

export function createApiForServer(input: {
  server: ServerConnection.HttpBase
  fetch?: typeof globalThis.fetch
}): OpenCodeClient {
  return OpenCode.make({
    baseUrl: input.server.url,
    fetch: input.fetch,
    headers: serverHeaders(input.server),
  })
}

export type ServerApi = OpenCodeClient
