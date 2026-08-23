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
    { type: "http", method: "", path: "/x", headers: [] },
    { type: "http", method: "GET", path: "", headers: [] },
    { type: "http", method: "GET", path: "customers", headers: [] },
    { type: "http", method: "post", path: "/x", headers: [] },
    { type: "http", method: "GE T", path: "/x", headers: [] },
    { type: "http", method: "GET\n", path: "/x", headers: [] },
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
    assert.ok(Object.isFrozen(events[0].headers));
    for (const pair of events[0].headers) {
      assert.ok(Object.isFrozen(pair));
    }
  }
  assert.equal(called, false);
});

test("callFromReceive malformed receive-event 400 profile response has frozen header pairs", async () => {
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => Object.freeze({ status: 200 })) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };
  const receive = async () => ({ type: "http.disconnect" });
  const send = async () => {};

  const events = await adapter.callFromReceive({ scope, receive, send });
  assert.equal(events[0].status, 400);
  assert.ok(Object.isFrozen(events[0].headers));
  for (const pair of events[0].headers) {
    assert.ok(Object.isFrozen(pair));
  }
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

test("callFromReceive rejects non-function receive/send without invoking receive or router", async () => {
  let called = false;
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => { called = true; return Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) }); }) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };

  const goodReceive = async () => ({ type: "http.request", body: new Uint8Array(), more_body: false });
  const goodSend = async () => {};

  for (const [receive, send] of [
    [undefined, goodSend],
    [null, goodSend],
    ["receive", goodSend],
    [goodReceive, undefined],
    [goodReceive, null],
    [goodReceive, "send"],
  ]) {
    await assert.rejects(() => adapter.callFromReceive({ scope, receive, send }), TypeError);
  }
  assert.equal(called, false);
});

test("callFromReceive rejects a non-function decodeBody without invoking router", async () => {
  let called = false;
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => { called = true; return Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) }); }) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };
  const receive = async () => ({ type: "http.request", body: new Uint8Array(), more_body: false });
  const send = async () => {};

  await assert.rejects(() => adapter.callFromReceive({ scope, receive, send, decodeBody: "not-a-fn" }), TypeError);
  assert.equal(called, false);
});

test("callFromReceive collects multi-chunk http.request body in order before dispatching", async () => {
  let received;
  const router = routerWith([{
    method: "POST",
    path: "/customers",
    handler: stubHandler(async (message) => {
      received = message;
      return Object.freeze({ status: 201, headers: Object.freeze({}), body: Object.freeze({ ok: true }) });
    }),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };

  const events = [
    { type: "http.request", body: new TextEncoder().encode("ab"), more_body: true },
    { type: "http.request", body: new TextEncoder().encode("cd"), more_body: true },
    { type: "http.request", body: new TextEncoder().encode("ef"), more_body: false },
  ];
  let i = 0;
  const receive = async () => events[i++];
  const sent = [];
  const send = async (event) => { sent.push(event); };

  const result = await adapter.callFromReceive({ scope, receive, send });

  assert.equal(i, 3);
  assert.ok(received.body instanceof Uint8Array);
  assert.equal(new TextDecoder().decode(received.body), "abcdef");
  assert.equal(sent.length, 2);
  assert.deepEqual(result, sent);
});

test("callFromReceive short-circuits to a 400 profile response on a malformed receive event without calling router", async () => {
  let called = false;
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => { called = true; return Object.freeze({ status: 200 }); }) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };

  const badEvents = [
    undefined,
    null,
    "event",
    { type: "http.disconnect" },
    { type: "http.request", body: "not-bytes", more_body: false },
    { type: "http.request", body: 123, more_body: false },
  ];

  for (const badEvent of badEvents) {
    const sent = [];
    const receive = async () => badEvent;
    const send = async (event) => { sent.push(event); };
    const events = await adapter.callFromReceive({ scope, receive, send });
    assert.equal(events.length, 2);
    assert.equal(events[0].status, 400);
    assert.deepEqual(sent, events);
  }
  assert.equal(called, false);
});

test("callFromReceive short-circuits to a 400 profile response on invalid scope without ever calling receive", async () => {
  let receiveCalled = false;
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => Object.freeze({ status: 200 })) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const receive = async () => { receiveCalled = true; return { type: "http.request", body: new Uint8Array(), more_body: false }; };
  const sent = [];
  const send = async (event) => { sent.push(event); };

  const events = await adapter.callFromReceive({ scope: { type: "websocket" }, receive, send });
  assert.equal(events.length, 2);
  assert.equal(events[0].status, 400);
  assert.equal(receiveCalled, false);
  assert.deepEqual(sent, events);
});

test("callFromReceive short-circuits to a 400 profile response on a path missing the leading slash without ever calling receive", async () => {
  let receiveCalled = false;
  const router = routerWith([{ method: "GET", path: "/customers", handler: stubHandler(() => Object.freeze({ status: 200 })) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "customers", headers: [] };
  const receive = async () => { receiveCalled = true; return { type: "http.request", body: new Uint8Array(), more_body: false }; };
  const sent = [];
  const send = async (event) => { sent.push(event); };

  const events = await adapter.callFromReceive({ scope, receive, send });
  assert.equal(events.length, 2);
  assert.equal(events[0].status, 400);
  assert.equal(receiveCalled, false);
  assert.deepEqual(sent, events);
});

test("callFromReceive short-circuits to a 400 profile response on a malformed method token without ever calling receive", async () => {
  let receiveCalled = false;
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => Object.freeze({ status: 200 })) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "post", path: "/customers", headers: [] };
  const receive = async () => { receiveCalled = true; return { type: "http.request", body: new Uint8Array(), more_body: false }; };
  const sent = [];
  const send = async (event) => { sent.push(event); };

  const events = await adapter.callFromReceive({ scope, receive, send });
  assert.equal(events.length, 2);
  assert.equal(events[0].status, 400);
  assert.equal(receiveCalled, false);
  assert.deepEqual(sent, events);
});

test("callFromReceive propagates a rejecting receive", async () => {
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) })) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };
  const receive = async () => { throw new Error("receive failed"); };
  const send = async () => {};

  await assert.rejects(() => adapter.callFromReceive({ scope, receive, send }), /receive failed/);
});

test("callFromReceive with decodeBody applies it to the merged bytes and short-circuits on decode failure", async () => {
  let received;
  const router = routerWith([{
    method: "POST",
    path: "/customers",
    handler: stubHandler(async (message) => {
      received = message;
      return Object.freeze({ status: 201, headers: Object.freeze({}), body: Object.freeze({ ok: true }) });
    }),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };

  const jsonBytes = new TextEncoder().encode(JSON.stringify({ name: "acme" }));
  const goodReceive = async () => ({ type: "http.request", body: jsonBytes, more_body: false });
  const decodeBody = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

  await adapter.callFromReceive({ scope, receive: goodReceive, send: async () => {}, decodeBody });
  assert.deepEqual(received.body, { name: "acme" });

  const badBytes = new TextEncoder().encode("not-json{");
  const badReceive = async () => ({ type: "http.request", body: badBytes, more_body: false });
  const sent = [];
  const events = await adapter.callFromReceive({ scope, receive: badReceive, send: async (e) => sent.push(e), decodeBody });
  assert.equal(events.length, 2);
  assert.equal(events[0].status, 400);
  assert.deepEqual(sent, events);
});

test("callFromReceive does not change existing call/handle behavior", async () => {
  const router = routerWith([{
    method: "GET",
    path: "/x",
    handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };
  const handleEvents = await adapter.handle({ scope, body: undefined });
  const callSent = [];
  const callEvents = await adapter.call({ scope, body: undefined, send: async (e) => callSent.push(e) });
  assert.deepEqual(handleEvents, callEvents);
  assert.deepEqual(callSent, callEvents);
});

test("call without encodeResponseBody preserves existing object response body", async () => {
  const router = routerWith([{
    method: "GET",
    path: "/x",
    handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({ ok: true }) })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };
  const sent = [];
  const events = await adapter.call({ scope, body: undefined, send: async (e) => sent.push(e) });
  assert.deepEqual(events[1].body, { ok: true });
  assert.deepEqual(sent, events);
});

test("call with encodeResponseBody converts the success response body to Uint8Array and returns the same sent events", async () => {
  const router = routerWith([{
    method: "GET",
    path: "/x",
    handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({ ok: true }) })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };
  const encodeResponseBody = (body) => new TextEncoder().encode(JSON.stringify(body));
  const sent = [];
  const events = await adapter.call({ scope, body: undefined, send: async (e) => sent.push(e), encodeResponseBody });

  assert.equal(events[0].type, "http.response.start");
  assert.ok(events[1].body instanceof Uint8Array);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(events[1].body)), { ok: true });
  assert.deepEqual(sent, events);
});

test("call with encodeResponseBody applies to invalid-scope 400 profile events", async () => {
  const router = routerWith([{ method: "GET", path: "/x", handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) })) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const encodeResponseBody = (body) => new TextEncoder().encode(JSON.stringify(body));
  const sent = [];
  const events = await adapter.call({ scope: { type: "websocket" }, body: undefined, send: async (e) => sent.push(e), encodeResponseBody });
  assert.equal(events[0].status, 400);
  assert.ok(events[1].body instanceof Uint8Array);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(events[1].body)).error.code, "PROFILE_SCOPE_INVALID");
  assert.deepEqual(sent, events);
});

test("callFromReceive with encodeResponseBody applies to decode-error 400 profile events", async () => {
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) })) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };
  const badBytes = new TextEncoder().encode("not-json{");
  const receive = async () => ({ type: "http.request", body: badBytes, more_body: false });
  const decodeBody = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
  const encodeResponseBody = (body) => new TextEncoder().encode(JSON.stringify(body));
  const sent = [];
  const events = await adapter.callFromReceive({ scope, receive, send: async (e) => sent.push(e), decodeBody, encodeResponseBody });
  assert.equal(events[0].status, 400);
  assert.ok(events[1].body instanceof Uint8Array);
  assert.deepEqual(sent, events);
});

test("callFromReceive with encodeResponseBody applies to a malformed receive-event 400 profile response", async () => {
  let called = false;
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => { called = true; return Object.freeze({ status: 200 }); }) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };
  const receive = async () => ({ type: "http.disconnect" });
  const encodeResponseBody = (body) => new TextEncoder().encode(JSON.stringify(body));
  const sent = [];
  const events = await adapter.callFromReceive({ scope, receive, send: async (e) => sent.push(e), encodeResponseBody });

  assert.equal(called, false);
  assert.equal(events[0].status, 400);
  assert.ok(events[1].body instanceof Uint8Array);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(events[1].body)).error.code, "PROFILE_SCOPE_INVALID");
  assert.deepEqual(sent, events);
});

test("callFromReceive rejects a non-function encodeResponseBody before invoking receive or send", async () => {
  let called = false;
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => { called = true; return Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) }); }) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };
  let receiveCalled = false;
  const receive = async () => { receiveCalled = true; return { type: "http.request", body: new Uint8Array(), more_body: false }; };
  let sendCalled = false;
  const send = async () => { sendCalled = true; };

  await assert.rejects(
    () => adapter.callFromReceive({ scope, receive, send, encodeResponseBody: "not-a-fn" }),
    TypeError,
  );
  assert.equal(receiveCalled, false);
  assert.equal(sendCalled, false);
  assert.equal(called, false);
});

test("encodeResponseBody throw propagates and is not swallowed", async () => {
  const router = routerWith([{
    method: "GET",
    path: "/x",
    handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({ ok: true }) })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };
  const encodeResponseBody = () => { throw new Error("encode failed"); };
  await assert.rejects(
    () => adapter.call({ scope, body: undefined, send: async () => {}, encodeResponseBody }),
    /encode failed/,
  );
});

test("call rejects a non-Uint8Array encodeResponseBody return with TypeError before sending", async () => {
  const router = routerWith([{
    method: "GET",
    path: "/x",
    handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({ ok: true }) })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };
  const encodeResponseBody = () => "not-bytes";
  const sent = [];
  await assert.rejects(
    () => adapter.call({ scope, body: undefined, send: async (e) => sent.push(e), encodeResponseBody }),
    TypeError,
  );
  assert.equal(sent.length, 0);
});

test("callFromReceive rejects a non-Uint8Array encodeResponseBody return with TypeError before sending", async () => {
  const router = routerWith([{
    method: "POST",
    path: "/customers",
    handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({ ok: true }) })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };
  const receive = async () => ({ type: "http.request", body: new Uint8Array(), more_body: false });
  const encodeResponseBody = () => ({ not: "bytes" });
  const sent = [];
  await assert.rejects(
    () => adapter.callFromReceive({ scope, receive, send: async (e) => sent.push(e), encodeResponseBody }),
    TypeError,
  );
  assert.equal(sent.length, 0);
});

test("call rejects a non-function encodeResponseBody without invoking send", async () => {
  const router = routerWith([{ method: "GET", path: "/x", handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) })) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };
  const sent = [];
  await assert.rejects(
    () => adapter.call({ scope, body: undefined, send: async (e) => sent.push(e), encodeResponseBody: "not-a-fn" }),
    TypeError,
  );
  assert.equal(sent.length, 0);
});

test("call without encodeResponseHeader preserves existing string header pairs", async () => {
  const router = routerWith([{
    method: "GET",
    path: "/x",
    handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({ "content-type": "application/json" }), body: Object.freeze({}) })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };
  const sent = [];
  const events = await adapter.call({ scope, body: undefined, send: async (e) => sent.push(e) });
  assert.deepEqual(events[0].headers, [["content-type", "application/json"]]);
  assert.deepEqual(sent, events);
});

test("call with encodeResponseHeader converts success response headers to Uint8Array pairs and returns the same sent events", async () => {
  const router = routerWith([{
    method: "GET",
    path: "/x",
    handler: stubHandler(() => Object.freeze({
      status: 200,
      headers: Object.freeze({ "content-type": "application/json", "x-a": "1" }),
      body: Object.freeze({}),
    })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };
  const encodeResponseHeader = (part) => new TextEncoder().encode(part);
  const sent = [];
  const events = await adapter.call({ scope, body: undefined, send: async (e) => sent.push(e), encodeResponseHeader });

  assert.equal(events[0].type, "http.response.start");
  for (const [name, value] of events[0].headers) {
    assert.ok(name instanceof Uint8Array);
    assert.ok(value instanceof Uint8Array);
  }
  const decoded = events[0].headers.map(([n, v]) => [new TextDecoder().decode(n), new TextDecoder().decode(v)]);
  assert.deepEqual(decoded, [["content-type", "application/json"], ["x-a", "1"]]);
  assert.deepEqual(sent, events);
});

test("call with encodeResponseHeader applies to invalid-scope 400 profile events", async () => {
  const router = routerWith([{ method: "GET", path: "/x", handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) })) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const encodeResponseHeader = (part) => new TextEncoder().encode(part);
  const sent = [];
  const events = await adapter.call({ scope: { type: "websocket" }, body: undefined, send: async (e) => sent.push(e), encodeResponseHeader });
  assert.equal(events[0].status, 400);
  for (const [name, value] of events[0].headers) {
    assert.ok(name instanceof Uint8Array);
    assert.ok(value instanceof Uint8Array);
  }
  const decoded = events[0].headers.map(([n, v]) => [new TextDecoder().decode(n), new TextDecoder().decode(v)]);
  assert.deepEqual(decoded, [["content-type", "application/json"]]);
  assert.deepEqual(sent, events);
});

test("callFromReceive with encodeResponseHeader applies to decode-error 400 profile events", async () => {
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) })) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };
  const badBytes = new TextEncoder().encode("not-json{");
  const receive = async () => ({ type: "http.request", body: badBytes, more_body: false });
  const decodeBody = (bytes) => JSON.parse(new TextDecoder().decode(bytes));
  const encodeResponseHeader = (part) => new TextEncoder().encode(part);
  const sent = [];
  const events = await adapter.callFromReceive({ scope, receive, send: async (e) => sent.push(e), decodeBody, encodeResponseHeader });
  assert.equal(events[0].status, 400);
  for (const [name, value] of events[0].headers) {
    assert.ok(name instanceof Uint8Array);
    assert.ok(value instanceof Uint8Array);
  }
  assert.deepEqual(sent, events);
});

test("callFromReceive with encodeResponseHeader applies to a malformed receive-event 400 profile response", async () => {
  let called = false;
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => { called = true; return Object.freeze({ status: 200 }); }) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };
  const receive = async () => ({ type: "http.disconnect" });
  const encodeResponseHeader = (part) => new TextEncoder().encode(part);
  const sent = [];
  const events = await adapter.callFromReceive({ scope, receive, send: async (e) => sent.push(e), encodeResponseHeader });

  assert.equal(called, false);
  assert.equal(events[0].status, 400);
  for (const [name, value] of events[0].headers) {
    assert.ok(name instanceof Uint8Array);
    assert.ok(value instanceof Uint8Array);
  }
  assert.deepEqual(sent, events);
});

test("callFromReceive rejects a non-function encodeResponseHeader before invoking receive or send", async () => {
  let called = false;
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => { called = true; return Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) }); }) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };
  let receiveCalled = false;
  const receive = async () => { receiveCalled = true; return { type: "http.request", body: new Uint8Array(), more_body: false }; };
  let sendCalled = false;
  const send = async () => { sendCalled = true; };

  await assert.rejects(
    () => adapter.callFromReceive({ scope, receive, send, encodeResponseHeader: "not-a-fn" }),
    TypeError,
  );
  assert.equal(receiveCalled, false);
  assert.equal(sendCalled, false);
  assert.equal(called, false);
});

test("call rejects a non-Uint8Array encodeResponseHeader return with TypeError before sending", async () => {
  const router = routerWith([{
    method: "GET",
    path: "/x",
    handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({ "x-a": "1" }), body: Object.freeze({}) })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };
  const encodeResponseHeader = (part) => part;
  const sent = [];
  await assert.rejects(
    () => adapter.call({ scope, body: undefined, send: async (e) => sent.push(e), encodeResponseHeader }),
    TypeError,
  );
  assert.equal(sent.length, 0);
});

test("callFromReceive rejects a non-Uint8Array encodeResponseHeader return with TypeError before sending", async () => {
  const router = routerWith([{
    method: "POST",
    path: "/customers",
    handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({ "x-a": "1" }), body: Object.freeze({}) })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "POST", path: "/customers", headers: [] };
  const receive = async () => ({ type: "http.request", body: new Uint8Array(), more_body: false });
  const encodeResponseHeader = (part) => part;
  const sent = [];
  await assert.rejects(
    () => adapter.callFromReceive({ scope, receive, send: async (e) => sent.push(e), encodeResponseHeader }),
    TypeError,
  );
  assert.equal(sent.length, 0);
});

test("call rejects a non-function encodeResponseHeader without invoking send", async () => {
  const router = routerWith([{ method: "GET", path: "/x", handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({}), body: Object.freeze({}) })) }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };
  const sent = [];
  await assert.rejects(
    () => adapter.call({ scope, body: undefined, send: async (e) => sent.push(e), encodeResponseHeader: "not-a-fn" }),
    TypeError,
  );
  assert.equal(sent.length, 0);
});

test("encodeResponseHeader throw propagates and is not swallowed, and send is not called after failure", async () => {
  const router = routerWith([{
    method: "GET",
    path: "/x",
    handler: stubHandler(() => Object.freeze({ status: 200, headers: Object.freeze({ "x-a": "1" }), body: Object.freeze({}) })),
  }]);
  const adapter = new AsgiCoreProfileAdapter({ router });
  const scope = { type: "http", method: "GET", path: "/x", headers: [] };
  const encodeResponseHeader = () => { throw new Error("header encode failed"); };
  const sent = [];
  await assert.rejects(
    () => adapter.call({ scope, body: undefined, send: async (e) => sent.push(e), encodeResponseHeader }),
    /header encode failed/,
  );
  assert.equal(sent.length, 0);
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
