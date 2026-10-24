import { expect, test } from "bun:test"
import { authFromToken, authTokenFromCredentials, serverConnectionIdentity, serverHeaders } from "./api"

test.each([
  [btoa("opencode:secret"), { password: "secret" }],
  [btoa("legacy:secret:with:colons"), { password: "secret:with:colons" }],
  [btoa(":secret"), { password: "secret" }],
  ["not base64", undefined],
  [btoa("missing-separator"), undefined],
])("authFromToken(%p) extracts only the password", (token, expected) => {
  expect(authFromToken(token)).toEqual(expected)
})

test("authTokenFromCredentials ignores usernames in legacy saved credentials", () => {
  const credentials = { username: "legacy", password: "secret" }
  expect(authTokenFromCredentials(credentials)).toBe(btoa("opencode:secret"))
})

test.each([
  { http: {}, expected: undefined },
  { http: { headers: {} }, expected: undefined },
  { http: { password: "secret" }, expected: { authorization: `Basic ${btoa("opencode:secret")}` } },
  {
    http: { password: "secret", headers: { "CF-Access-Client-Id": "client", "CF-Access-Client-Secret": "access" } },
    expected: {
      authorization: `Basic ${btoa("opencode:secret")}`,
      "cf-access-client-id": "client",
      "cf-access-client-secret": "access",
    },
  },
  {
    http: { password: "secret", headers: { Authorization: "Bearer first", aUtHoRiZaTiOn: "Bearer custom" } },
    expected: { authorization: "Bearer custom" },
  },
])("merges effective headers with case-insensitive custom overrides (%p)", ({ http, expected }) => {
  expect(serverHeaders({ url: "https://opencode.example", ...http })).toEqual(expected)
})

test("connection identity canonicalizes effective header names and order, but tracks credential edits", () => {
  const server = {
    url: "https://opencode.example",
    password: "secret",
    headers: { "CF-Access-Client-Id": "client", Authorization: "Bearer custom" },
  }
  const identity = serverConnectionIdentity(server)

  expect(
    serverConnectionIdentity({ ...server, headers: { authorization: "Bearer custom", "cf-access-client-id": "client" } }),
  ).toBe(identity)
  expect(serverConnectionIdentity({ ...server, url: "https://other.example" })).not.toBe(identity)
  expect(serverConnectionIdentity({ ...server, password: "updated" })).not.toBe(identity)
  expect(serverConnectionIdentity({ ...server, headers: { ...server.headers, Authorization: "Bearer updated" } })).not.toBe(
    identity,
  )
  expect(serverConnectionIdentity({ ...server, headers: undefined })).not.toBe(identity)
  expect(serverConnectionIdentity({ url: server.url, headers: {} })).toBe(serverConnectionIdentity({ url: server.url }))
})
