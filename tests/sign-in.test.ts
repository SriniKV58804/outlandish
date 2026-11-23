import assert from "node:assert/strict";
import test from "node:test";
import { signInCallback } from "../lib/server/redirects.ts";

test("email sign-in returns to the same approved origin where the browser holds its verifier", () => {
  const host = "workspace.example";
  const origin = "https://" + host;
  assert.equal(signInCallback(origin, undefined, host, false), origin + "/auth/confirm");
  assert.equal(signInCallback(origin, origin, undefined, false), origin + "/auth/confirm");
  assert.equal(signInCallback("http://localhost:3015", undefined, undefined, true), "http://localhost:3015/auth/confirm");
  for (const untrusted of [null, "http://localhost:3015", "http://workspace.example", "https://workspace.example.other", "null"]) {
    assert.equal(signInCallback(untrusted, undefined, host, false), null);
  }
});
