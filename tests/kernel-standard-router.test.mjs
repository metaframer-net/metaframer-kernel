import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { StandardRouter } from "../src/delivery/standard-router.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routerPath = "src/delivery/standard-router.mjs";

const stubHandler = (handle) => ({ handle: handle ?? (() => Object.freeze({ status: 200 })) });
const routerWith = (routes) => new StandardRouter({ routes });

test("constructor and route record exactness", () => {
  for (const bad of [undefined, null, "routes", {}, { routes: [], extra: 1 }]) {
    assert.throws(() => new StandardRouter(bad), TypeError);
  }
  for (const routes of [
    [],
    "not-an-array",
    [null],
    [{ method: "POST", path: "/customers" }],
    [{ method: "POST", path: "/customers", handler: stubHandler(), extra: 1 }],
    [{ method: "", path: "/customers", handler: stubHandler() }],
    [{ method: "POST", path: "", handler: stubHandler() }],
    [{ method: "POST", path: "/customers", handler: {} }],
    [{ method: "POST", path: "/customers", handler: { handle: "not-a-fn" } }],
  ]) {
    assert.throws(() => new StandardRouter({ routes }), TypeError);
  }
  assert.throws(
    () =>
      new StandardRouter({
        routes: [
          { method: "POST", path: "/customers", handler: stubHandler() },
          { method: "POST", path: "/customers", handler: stubHandler() },
        ],
      }),
    TypeError,
  );
  const router = routerWith([
    { method: "POST", path: "/customers", handler: stubHandler() },
    { method: "GET", path: "/customers", handler: stubHandler() },
    { method: "GET", path: "/orders", handler: stubHandler() },
  ]);
  assert.ok(router instanceof StandardRouter);
});

test("router, class, prototype and route table are frozen and not exposed mutable", () => {
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler() }]);
  assert.ok(Object.isFrozen(router));
  assert.ok(Object.isFrozen(StandardRouter));
  assert.ok(Object.isFrozen(StandardRouter.prototype));
  assert.equal(router.routes, undefined);
  assert.deepEqual(Object.keys(router), []);
});

test("handle returns a Promise", () => {
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler() }]);
  const result = router.handle({ method: "POST", path: "/customers" });
  assert.ok(result instanceof Promise);
});

test("valid POST /customers dispatches exactly once and returns the same response object", async () => {
  let callCount = 0;
  let receivedMessage;
  const response = Object.freeze({ status: 201, body: Object.freeze({ ok: true }) });
  const handler = stubHandler((message) => {
    callCount += 1;
    receivedMessage = message;
    return response;
  });
  const router = routerWith([{ method: "POST", path: "/customers", handler }]);
  const message = Object.freeze({ method: "POST", path: "/customers", body: Object.freeze({ name: "acme" }) });

  const result = await router.handle(message);

  assert.equal(callCount, 1);
  assert.equal(receivedMessage, message);
  assert.equal(result, response);
});

test("async handler resolving a response is awaited and its response returned", async () => {
  let callCount = 0;
  const response = Object.freeze({ status: 201, body: Object.freeze({ ok: true }) });
  const handler = stubHandler(async (message) => {
    callCount += 1;
    return response;
  });
  const router = routerWith([{ method: "POST", path: "/customers", handler }]);

  const result = await router.handle({ method: "POST", path: "/customers" });

  assert.equal(callCount, 1);
  assert.equal(result, response);
});

test("malformed message, unknown path and unsupported method all short-circuit without calling any handler", async () => {
  let called = false;
  const handler = stubHandler(() => {
    called = true;
    return Object.freeze({ status: 200 });
  });
  const router = routerWith([{ method: "POST", path: "/customers", handler }]);

  for (const message of [null, undefined, "string", 1, [], { method: "POST" }, { path: "/customers" }, { method: 1, path: "/customers" }]) {
    const result = await router.handle(message);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, "MESSAGE_SHAPE_INVALID");
    assert.equal(result.body.error.retryable, false);
    assert.ok(Object.isFrozen(result) && Object.isFrozen(result.body) && Object.isFrozen(result.body.error));
  }
  assert.equal((await router.handle({ method: "POST", path: "/unknown" })).status, 404);
  assert.equal((await router.handle({ method: "DELETE", path: "/customers" })).status, 405);
  assert.equal(called, false);
});

test("handler returning a non-object rejects with TypeError", async () => {
  for (const badReturn of ["not-an-object", null, []]) {
    const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(() => badReturn) }]);
    await assert.rejects(() => router.handle({ method: "POST", path: "/customers" }), TypeError);
  }
});

test("async handler rejecting a non-object response rejects with TypeError", async () => {
  const router = routerWith([{ method: "POST", path: "/customers", handler: stubHandler(async () => "not-an-object") }]);
  await assert.rejects(() => router.handle({ method: "POST", path: "/customers" }), TypeError);
});

test("handler throwing synchronously rejects the returned promise", async () => {
  const router = routerWith([{
    method: "POST",
    path: "/customers",
    handler: stubHandler(() => { throw new Error("boom"); }),
  }]);
  await assert.rejects(() => router.handle({ method: "POST", path: "/customers" }), /boom/);
});

test("source imports no server/framework/runtime-nondeterminism surface", async () => {
  const source = await readFile(path.join(root, routerPath), "utf8");
  const forbiddenTokens = [
    "node:fs", "node:net", "node:http", "node:https", "fetch(", "process.env", "Date.now", "Math.random",
    "fastapi", "FastAPI", "django", "Django", "uvicorn", "Uvicorn", "hypercorn", "Hypercorn",
    "express", "Express", "koa", "Koa", "asgi", "ASGI",
  ];
  for (const token of forbiddenTokens) {
    assert.equal(source.includes(token), false, `${routerPath} must not contain ${token}`);
  }
});
