import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { StandardRouter } from "../src/delivery/standard-router.mjs";
import { AsgiCoreProfileAdapter } from "../src/delivery/asgi-core-profile.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = "src/delivery/asgi-core-profile.mjs";

const stubHandler = (handle) => ({ handle: handle ?? (() => Object.freeze({ status: 200 })) });
const routerWith = (routes) => new StandardRouter({ routes });

test("constructor exactness and frozen surfaces", () => {
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler() }]);
  for (const bad of [undefined, null, "router", {}, { router: {} }, { router, extra: 1 }, { notRouter: router }]) {
    assert.throws(() => new AsgiCoreProfileAdapter(bad), TypeError);
  }
  const adapter = new AsgiCoreProfileAdapter({ router });
  assert.ok(adapter instanceof AsgiCoreProfileAdapter);
  assert.ok(Object.isFrozen(adapter));
  assert.ok(Object.isFrozen(AsgiCoreProfileAdapter));
  assert.ok(Object.isFrozen(AsgiCoreProfileAdapter.prototype));
  assert.deepEqual(Object.keys(adapter), []);
});

test("handle returns a Promise", async () => {
  const router = routerWith([{
    method: "GET",
    path: "/x",
    handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const result = adapter.handle({ scope: { type: "http", method: "GET", path: "/x", headers: [] }, body: undefined });
  assert.ok(result instanceof Promise);
  await result;
});

test("malformed scope short-circuits to a frozen 400 profile response without calling router", async () => {
  let called = false;
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => { called = true; return Object.freeze({ status: 200 }); }) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });

  const badScopes = [
    undefined,
    null,
    "scope",
    {},
    { type: "websocket", method: "GET", path: "/x", headers: [] },
    { type: "http", method: 1, path: "/x", headers: [] },
    { type: "http", method: "GET", path: 1, headers: [] },
    { type: "http", method: "GET", path: "/x", headers: "not-array" },
    { type: "http", method: "GET", path: "/x", headers: [["only-one"]] },
    { type: "http", method: "GET", path: "/x", headers: [[1, "v"]] },
    { type: "http", method: "GET", path: "/x", headers: [["name", 1]] },
  ];

  for (const scope of badScopes) {
    const events = await adapter.handle({ scope, body: undefined });
    assert.equal(events.length, 2);
    assert.equal(events[0].type, "http.response.start");
    assert.equal(events[0].status, 400);
    assert.equal(events[1].type, "http.response.body");
    assert.equal(events[1].more_body, false);
    assert.ok(Object.isFrozen(events));
    assert.ok(Object.isFrozen(events[0]));
    assert.ok(Object.isFrozen(events[1]));
  }
  assert.equal(called, false);
});

test("valid scope dispatches router.handle exactly once with frozen plain message", async () => {
  let callCount = 0;
  let received;
  const routerResponse = Object.freeze({
    status: 201,
    headers: Object.freeze({ "Content-Type": "application/json", "X-Request-Id": "r1" }),
    body: Object.freeze({ ok: true }),
  });
  const router = routerWith([{
    method: "POST",
    path: "/customers",
    handler: stubHandler(async (message) => {
      callCount += 1;
      received = message;
      return routerResponse;
    }),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });

  const scope = {
    type: "http",
    method: "POST",
    path: "/customers",
    headers: [
      ["x-actor-id", "a1"],
      [new TextEncoder().encode("x-tenant-id"), new TextEncoder().encode("t1")],
      ["X-Actor-Id", "a2"],
    ],
    asgi: { version: "3.0" },
    http_version: "1.1",
    scheme: "http",
    client: ["127.0.0.1", 1234],
    server: ["127.0.0.1", 80],
    query_string: new Uint8Array(),
    root_path: "",
  };
  const body = Object.freeze({ name: "acme" });
  const events = await adapter.handle({ scope, body });

  assert.equal(callCount, 1);
  assert.ok(Object.isFrozen(received));
  assert.equal(received.method, "POST");
  assert.equal(received.path, "/customers");
  assert.equal(received.body, body);
  assert.ok(Object.isFrozen(received.headers));
  assert.equal(Object.getPrototypeOf(received.headers), Object.prototype);
  assert.equal(received.headers["x-actor-id"], "a2");
  assert.equal(received.headers["x-tenant-id"], "t1");

  assert.equal(events.length, 2);
  assert.deepEqual(events[0], {
    type: "http.response.start",
    status: 201,
    headers: [["content-type", "application/json"], ["x-request-id", "r1"]],
  });
  assert.deepEqual(events[1], { type: "http.response.body", body: routerResponse.body, more_body: false });
  assert.ok(Object.isFrozen(events[0]));
  assert.ok(Object.isFrozen(events[0].headers));
  assert.ok(Object.isFrozen(events[1]));
});

test("response header pairs are sorted by name for determinism", async () => {
  const router = routerWith([{
    method: "GET",
    path: "/orders",
    handler: stubHandler(() => Object.freeze({
      status: 200,
      headers: Object.freeze({ zeta: "1", alpha: "2", Mid: "3" }),
      body: Object.freeze({}),
    })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const events = await adapter.handle({ scope: { type: "http", method: "GET", path: "/orders", headers: [] }, body: undefined });
  assert.deepEqual(events[0].headers, [["alpha", "2"], ["mid", "3"], ["zeta", "1"]]);
});

test("malformed router response rejects with TypeError", async () => {
  for (const badResponse of [
    Object.freeze({ status: "200", headers: {}, body: {} }),
    Object.freeze({ status: 200, headers: "bad", body: {} }),
    Object.freeze({ status: 200, headers: {}, body: {}, extra: 1 }),
    Object.freeze({ headers: {}, body: {} }),
    "not-an-object",
    null,
  ]) {
    const router = routerWith([{ method: "GET", path: "/x", handler: stubHandler(() => badResponse) }]);
    const adapter = new AsgiCoreProfileAdapter({ router });
    await assert.rejects(
      () => adapter.handle({ scope: { type: "http", method: "GET", path: "/x", headers: [] }, body: undefined }),
      TypeError,
    );
  }
});

test("call rejects a non-function send without invoking the router", async () => {
  let called = false;
  const router = routerWith([{ method: "GET", path: "/x", handler: stubHandler(() => { called = true; return Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) }); }) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };

  for (const badSend of [undefined, null, "send", {}, 1]) {
    await assert.rejects(
      () => adapter.call({ scope, body: undefined, send: badSend }),
      TypeError,
    );
  }
  assert.equal(called, false);
});

test("call awaits send for each event in order and returns the same events as handle", async () => {
  const routerResponse = Object.freeze({
    status: 201,
    headers: Object.freeze({ "content-type": "application/json" }),
    body: Object.freeze({ ok: true }),
  });
  const router = routerWith([{
    method: "POST",
    path: "/customers",
    handler: stubHandler(async () => routerResponse),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };

  const sent = [];
  const send = async (event) => {
    await Promise.resolve();
    sent.push(event);
  };

  const events = await adapter.call({ scope, body: undefined, send });

  assert.equal(sent.length, 2);
  assert.equal(sent[0].type, "http.response.start");
  assert.equal(sent[1].type, "http.response.body");
  assert.deepEqual(events, sent);

  const directEvents = await adapter.handle({ scope, body: undefined });
  assert.deepEqual(events, directEvents);
});

test("call propagates a rejecting send and stops without sending further events", async () => {
  const router = routerWith([{
    method: "GET",
    path: "/x",
    handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };

  const sent = [];
  const send = async (event) => {
    sent.push(event);
    if (event.type === "http.response.start") {
      throw new Error("send failed");
    }
  };

  await assert.rejects(() => adapter.call({ scope, body: undefined, send }), /send failed/);
  assert.equal(sent.length, 1);
});

test("source imports no server/framework/runtime-nondeterminism surface", async () => {
  const source = await readFile(path.join(root, profilePath), "utf8");
  const forbiddenTokens = [
    "node:fs", "node:net", "node:http", "node:https", "fetch(", "process.env", "Date.now", "Math.random",
    "fastapi", "FastAPI", "django", "Django", "uvicorn", "Uvicorn", "hypercorn", "Hypercorn",
    "express", "Express", "koa", "Koa",
  ];
  for (const token of forbiddenTokens) {
    assert.equal(source.includes(token), false, `${profilePath} must not contain ${token}`);
  }
});
