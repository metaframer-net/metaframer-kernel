# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
The canonical source for every value below is `versioning-policy.json`; this document is a
projection of it and is never read back as a source.

This project is in initial development (SemVer 0.y.z). No release exists: there is no released
version, no release tag, no GitHub Release and no published package, and the package is private.
The single [Unreleased] section below describes implemented repository state, not a release. The
package version is 0.1.0-alpha.1, an entry on the prerelease train whose terminus is 0.1.0; the
planning placeholder it replaced, 0.0.0-planning, was never released either.

## [Unreleased]

### Added
- GJ-01 V14W ASGI composition body limit (`planning/gj01-v14w-asgi-composition-body-limit.json`):
  `createCustomerAsgiComposition` in `src/delivery/create-customer-asgi-composition.mjs` now
  accepts an optional `maxBodyBytes` option alongside its existing four required options. When
  provided, it must be a non-negative safe integer, otherwise the composition factory throws
  `TypeError` before `app`/`asgi`/`router`/`close` are ever constructed. When provided, `app`
  passes `maxBodyBytes` through to the underlying `AsgiCoreProfileAdapter.callFromReceive`
  (GJ-01 V14V): an over-limit request now returns the existing deterministic 400 profile response
  without reaching the `createCustomerComposition` commit path, and an exact-boundary body still
  dispatches through the normal route path unchanged. When `maxBodyBytes` is omitted, `app`'s
  behavior is unchanged. This is a framework-neutral option only: no server/host/framework is
  selected or imported.
- GJ-01 V14V ASGI receive body byte limit (`planning/gj01-v14v-asgi-receive-body-limit.json`):
  `AsgiCoreProfileAdapter.callFromReceive` in `src/delivery/asgi-core-profile.mjs` now accepts an
  optional `maxBodyBytes` option. When provided, it must be a non-negative safe integer, otherwise
  `callFromReceive` throws `TypeError` before `receive` or the router are ever invoked. While
  collecting `http.request` chunks, a running cumulative-byte count is checked after each chunk;
  once it exceeds `maxBodyBytes`, `callFromReceive` returns the existing deterministic 400 profile
  response via `sendErrorEvents` without calling the router. A body whose cumulative bytes exactly
  equal `maxBodyBytes` still dispatches normally. When `maxBodyBytes` is omitted, behavior is
  unchanged. This is a framework-neutral option only: no server/host/framework is selected or
  imported, and `createCustomerAsgiComposition`'s default body-limit behavior is unchanged.
- GJ-01 V14U ASGI callable immutability (`planning/gj01-v14u-asgi-callable-immutability.json`):
  `createCustomerAsgiComposition` in `src/delivery/create-customer-asgi-composition.mjs` now
  freezes the `app` ASGI callable function itself, immediately before constructing the frozen
  `{ asgi, router, app, close }` object it returns. Previously the outer composition object and
  the `asgi`/`router` instances were frozen, but `app` was an ordinary mutable function: a caller
  could assign own properties onto it, redefine its properties, or change its prototype.
  `composition.app` is now itself frozen, carries no own enumerable keys, and rejects an
  own-property assignment, `Object.defineProperty`, or `Object.setPrototypeOf` with `TypeError`.
  Callable behavior is unchanged. Not a server/host selection.
- GJ-01 V14T ASGI response header value conformance (`planning/gj01-v14t-asgi-response-header-value-conformance.json`):
  `checkRouterResponse()` in `src/delivery/asgi-core-profile.mjs` now rejects a `StandardRouter`
  response header value that is not a printable-ASCII string, throwing a `TypeError` before
  `toResponseEvents()` builds any outgoing ASGI response event, so a malformed value (CR, LF,
  CRLF, other control characters, or a non-string such as a number, `null`, or a `Uint8Array`) is
  never sent from `handle()` or `call()`/`callFromReceive()`. Previously `toResponseEvents()`
  coerced every header value with `String(...)`, so an unsafe value such as
  `"v\r\nSet-Cookie: evil=1"` was silently emitted onto the `http.response.start` event. Valid
  printable ASCII string values, including the empty string and the boundary characters space and
  `~`, keep their existing behavior and deterministic sorted output. Not a server/host selection.
- GJ-01 V14S ASGI response status conformance (`planning/gj01-v14s-asgi-response-status-conformance.json`):
  `checkRouterResponse()` in `src/delivery/asgi-core-profile.mjs` now rejects a `StandardRouter`
  response status that is not an integer in the inclusive ASGI/HTTP range 100..599, throwing a
  `TypeError` before `toResponseEvents()` builds any outgoing ASGI response event, so a malformed
  status is never sent from `handle()` or `call()`/`callFromReceive()`. Previously any status that
  passed `typeof status === "number"` was accepted, so a non-integer such as `200.5`, `NaN`, or
  `Infinity`, or an out-of-range integer such as `99`, `0`, `-1`, or `600`, was silently emitted
  onto the `http.response.start` event. Valid statuses, including the boundaries `100`, `204`, and
  `599`, keep their existing behavior. Not a server/host selection.
- GJ-01 V14R ASGI response header name conformance (`planning/gj01-v14r-asgi-response-header-name-conformance.json`):
  `checkRouterResponse()` in `src/delivery/asgi-core-profile.mjs` now rejects a `StandardRouter`
  response header name that is empty, upper-case, whitespace-bearing, colon-bearing, or
  control-character-bearing, throwing a `TypeError` before `toResponseEvents()` builds any
  outgoing ASGI response event, so a malformed name is never sent from `handle()` or `call()`.
  Previously any router response header key, however malformed, was silently lower-cased,
  sorted, and placed into the `http.response.start` event. Valid lower-case HTTP token header
  names keep their existing sorted, deterministic behavior. Not a server/host selection.
- GJ-01 V14Q ASGI header name token conformance (`planning/gj01-v14q-asgi-header-name-token-conformance.json`):
  `decodeHeaders()` in `src/delivery/asgi-core-profile.mjs` now rejects a decoded header name that
  is empty, upper-case, whitespace-bearing, colon-bearing, or control-character-bearing, returning
  the profile boundary's existing frozen 400 `PROFILE_SCOPE_INVALID` response before
  `StandardRouter` or `receive()` ever run; `callFromReceive()` checks header names before entering
  its `receive()` loop, matching the existing before-`receive()` placement for scope shape and
  method token. Previously any decoded header name, however malformed, was silently lower-cased
  and inserted into the header map. Valid lower-case HTTP token header names are unaffected. Not a
  server/host selection.
- GJ-01 V14P ASGI HTTP method token conformance (`planning/gj01-v14p-asgi-method-token-conformance.json`):
  `isValidScope()` in `src/delivery/asgi-core-profile.mjs` now rejects a `method` that is not a
  well-formed upper-case HTTP token, throwing the profile boundary's existing frozen 400
  `PROFILE_SCOPE_INVALID` response before `StandardRouter` or `receive()` ever run. Previously a
  lower-case (`post`), whitespace-bearing (`GE T`), or control-character-bearing (`GET\n`) method
  passed the non-empty-string check and reached `StandardRouter`, returning as an ordinary
  404/405 router response instead of the profile boundary's 400. Valid upper-case methods such as
  `GET`/`POST`/`OPTIONS` are unaffected. Not a server/host selection.
- GJ-01 V14O ASGI encoder return conformance (`planning/gj01-v14o-asgi-encoder-return-conformance.json`):
  `encodeEvents()` in `src/delivery/asgi-core-profile.mjs` now requires each value returned by a
  caller-provided `encodeResponseBody`/`encodeResponseHeader` to be a `Uint8Array`, throwing a
  `TypeError` before the encoded event is built or `send()` is ever called. Previously a returned
  string or object was placed directly into the outgoing `http.response.start`/`http.response.body`
  event, letting a misbehaving encoder send a malformed host-facing event. An encoder that throws
  still propagates its own error unchanged, and the internal unencoded profile path (no encoder
  provided) is unchanged. Not a server/host selection.
- GJ-01 V14N ASGI scope structural conformance (`planning/gj01-v14n-asgi-scope-conformance.json`):
  `isValidScope()` in `src/delivery/asgi-core-profile.mjs` now rejects an empty `method`, an empty
  `path`, and a `path` without a leading `/` at the profile boundary, before `StandardRouter` or
  `receive()` ever run. Previously these shapes passed the structural check and reached
  `StandardRouter`, producing an ordinary 404/405 instead of the frozen 400 `PROFILE_SCOPE_INVALID`
  profile response every other malformed-scope shape already gets. Valid-scope routing, response
  encoding, and `query_string`-ignored behavior are unchanged. Not a server/host selection.
- GJ-01 V14M ASGI event conformance hardening (`planning/gj01-v14m-asgi-event-conformance.json`):
  `profileErrorEvents()` in `src/delivery/asgi-core-profile.mjs` now freezes its inner
  `["content-type", "application/json"]` header pair tuple, matching the per-pair freezing the
  success response path already applied. The 400 `PROFILE_SCOPE_INVALID` profile-error event tree
  is now as deeply immutable as a success event tree across all layers (events array, event
  objects, headers array, and each header pair). No status code, error code, header value or event
  shape changed. Not a server/host selection.
- GJ-01 V14L idempotency-conflict delivery mapping (`planning/gj01-v14l-idempotency-retry-envelope.json`):
  `PostgresCommitAdapter.commit` now catches the one known duplicate tenant-scoped idempotency
  conflict — a PostgreSQL `23505` unique violation on `transactional_outbox_tenant_dedup_key` —
  and throws a new frozen `IdempotencyConflictError` (`code: "IDEMPOTENCY_CONFLICT"`,
  `retryable: false`, `tenantId`, `fingerprint`) instead of leaking the raw pg error; every other
  database failure still propagates unchanged. `CreateCustomerRequestHandler.handle` now wraps its
  call to the commit service and duck-types that one error shape (never importing the Postgres
  adapter, preserving the handler's existing framework-free/Postgres-free-import contract), mapping
  it to a frozen `409` response with `body.error.code: "IDEMPOTENCY_CONFLICT"`, `retryable: false`
  and the original request's `requestId` preserved; any other thrown error still rejects
  `handle()` unmasked. A real-PostgreSQL Docker-backed test in
  `tests/kernel-create-customer-asgi-composition.test.mjs` now issues the same `POST /customers`
  request twice through the full ASGI callable and proves the second request returns 409 with no
  second `customer_records`/`audit_log`/`transactional_outbox` row; `tests/postgres-commit-adapter.test.mjs`
  proves the adapter's exact error shape and exports it; `tests/kernel-create-customer-request-handler.test.mjs`
  proves the handler's 409 mapping and that a non-matching error still propagates unmasked.
- GJ-01 V14K evidence package (`planning/gj01-v14k-asgi-postgres-slice.json`): a new Docker-backed
  test in `tests/kernel-create-customer-asgi-composition.test.mjs` proves the existing
  framework-neutral `createCustomerAsgiComposition.app(scope, receive, send)` callable, given an
  ALLOW policy candidate and an invariants-ok evaluation, carries a POST `/customers` request all
  the way to a real PostgreSQL 16 commit: a 201 `http.response.start`, a body decoding to a frozen
  `CommitReceipt` with all four intents (customer, audit, transactionalOutbox, idempotency)
  committed and none deferred, and matching rows actually persisted in `customer_records`,
  `audit_log` and `transactional_outbox` for the same tenant. Three new DB-connectionless tests in
  `tests/postgres-commit-adapter.test.mjs` cover the adapter fix below: a null-prototype
  `customer.payload` with a non-empty name passes shape checks (proved via a
  reachable-but-refusing connection string, so the resulting rejection is a connection failure,
  not the payload-shape check); a payload with no `name` is still refused whether ordinary or
  null-prototype; and an array/class-instance/function payload is still refused. No schema,
  migration or dependency changes; no server, framework or host adapter is introduced.
- Optional `encodeResponseHeader` parameter on `AsgiCoreProfileAdapter#call` and
  `#callFromReceive` in `src/delivery/asgi-core-profile.mjs`: when supplied (and validated as a
  function), it encodes every `http.response.start` header name and value before send/return,
  including the deterministic 400 profile events raised on invalid scope, a malformed receive
  event, or a `decodeBody` failure; an encoder throw propagates rather than being caught, and
  `send` is not called after a header-encoder failure. Omitting `encodeResponseHeader` leaves
  existing `call`/`callFromReceive`/`handle` behavior — including the internal string header-pair
  shape — unchanged. `createCustomerAsgiComposition.app` in
  `src/delivery/create-customer-asgi-composition.mjs` now also passes a default UTF-8 response
  header encoder alongside the existing JSON request decoder and JSON response body encoder, so a
  host adapter calling `app(scope, receive, send)` receives `Uint8Array` header name/value pairs
  in addition to `Uint8Array` body chunks. Neither module adds a server, framework, network or
  Python ASGI dependency. `tests/kernel-asgi-core-profile.test.mjs` and
  `tests/kernel-create-customer-asgi-composition.test.mjs` add targeted coverage for the
  no-encoder default, encoder success/error-path application, and encoder-throw propagation. See
  `planning/gj01-v14j-asgi-header-bytes.json`.
- Optional `encodeResponseBody` parameter on `AsgiCoreProfileAdapter#call` and `#callFromReceive`
  in `src/delivery/asgi-core-profile.mjs`: when supplied (and validated as a function), it encodes
  every `http.response.body` event's body before send/return, including the deterministic 400
  profile events raised on invalid scope, a malformed receive event, or a `decodeBody` failure; an
  encoder throw propagates rather than being caught. Omitting `encodeResponseBody` leaves existing
  `call`/`callFromReceive`/`handle` behavior — including the internal JS-object response body
  shape — unchanged. `createCustomerAsgiComposition.app` in
  `src/delivery/create-customer-asgi-composition.mjs` now passes a default JSON response encoder
  (`JSON.stringify` + UTF-8 bytes) alongside the existing JSON request decoder, so a host adapter
  calling `app(scope, receive, send)` receives `Uint8Array` response body chunks. Neither module
  adds a server, framework, network or Python ASGI dependency.
  `tests/kernel-asgi-core-profile.test.mjs` and `tests/kernel-create-customer-asgi-composition.test.mjs`
  add targeted coverage for the no-encoder default, encoder success/error-path application, and
  encoder-throw propagation. See `planning/gj01-v14i-asgi-response-bytes.json`.
- `app(scope, receive, send)` on the frozen object returned by `createCustomerAsgiComposition` in
  `src/delivery/create-customer-asgi-composition.mjs` — the smallest framework-neutral ASGI
  callable entrypoint, so a host adapter (Uvicorn, Hypercorn, ...) can call one async function
  with `(scope, receive, send)` without this module selecting or importing any server/framework.
  `app` delegates to `asgi.callFromReceive({ scope, receive, send, decodeBody })` with a default
  JSON body decoder: empty bytes decode to `{}` (the existing accepted empty-body shape used by
  `CreateCustomerHttpMessageAdapter`); non-empty bytes decode as UTF-8 JSON to an ordinary object,
  and invalid JSON (or a non-ordinary-object result) throws inside `decodeBody`, which
  `callFromReceive` turns into the existing deterministic 400 profile response without ever
  calling the router or application pipeline. The returned object is now frozen
  `{ asgi, router, app, close }`; `asgi`, `router` and `close` behavior are unchanged. It is not a
  Python ASGI app and adds no Uvicorn, Hypercorn, FastAPI or Django dependency.
  `tests/kernel-create-customer-asgi-composition.test.mjs` adds targeted coverage for the
  frozen `{ asgi, router, app, close }` shape; `app` delivering a decoded JSON body all the way to
  the application pipeline's invariant stage (an allow policy decision, `evaluateInvariants`
  asserting `command.payload.name`, and an `ok: false` answer closing the outcome as
  `INVALID`/400 `INVARIANT_VIOLATION` before the Postgres commit path, proving the decoded body
  reaches the pipeline rather than stopping at a policy deny); the empty-body case; and invalid
  JSON short-circuiting to the 400 profile response without touching the pipeline. See
  `planning/gj01-v14h-asgi-callable-composition.json`.
- `AsgiCoreProfileAdapter#callFromReceive({ scope, receive, send, decodeBody })` in
  `src/delivery/asgi-core-profile.mjs`, a framework-neutral receive-driven ASGI profile method
  that lets a host supply `receive()`/`send()` functions: it validates both are functions before
  any router call, awaits `http.request` events from `receive` in order, concatenates their
  `body` byte chunks until `more_body` is not `true`, optionally passes the merged bytes through
  a caller-supplied deterministic `decodeBody` function, and then dispatches through the existing
  `call` method unchanged. An invalid scope, a malformed/non-`http.request` receive event, a
  non-`Uint8Array` chunk, or a `decodeBody` failure each short-circuit deterministically to the
  existing frozen 400 profile events without ever calling the router. It adds no server,
  framework, network or Python ASGI dependency. `tests/kernel-asgi-core-profile.test.mjs` adds
  targeted coverage for multi-chunk body collection, invalid `receive`/`send`/`decodeBody`
  short-circuiting, malformed receive event responses, receive rejection propagation, `decodeBody`
  success and failure paths, and confirms existing `call`/`handle` behavior is unchanged.
- `createCustomerAsgiComposition(options)` in `src/delivery/create-customer-asgi-composition.mjs`,
  a framework-neutral composition root that wires a real `createCustomerComposition` handler to a
  real `CreateCustomerHttpMessageAdapter`, a real `StandardRouter` (its only route: `POST
  /customers`) and a real `AsgiCoreProfileAdapter`. It accepts exactly the same four keys as
  `createCustomerComposition` (`connectionString`, `current`, `candidatesFor`,
  `evaluateInvariants`) and returns a frozen `{ asgi, router, close }` object; `close` delegates to
  the composed `PostgresCommitAdapter` close. It is not an HTTP server and adds no Python ASGI app,
  Uvicorn, Hypercorn, FastAPI or Django dependency.
  `tests/kernel-create-customer-asgi-composition.test.mjs` proves the four-key options exactness,
  the frozen `{ asgi, router, close }` shape, a DENY outcome traversing `POST /customers` through
  `asgi.call` without ever touching the database, wrong-method/wrong-path short-circuiting before
  the handler runs, `close` delegation, and the absence of any forbidden import.
  `tests/repository-boundary.test.mjs`'s `src/delivery` module manifest is extended with
  `create-customer-asgi-composition.mjs`. See
  `planning/gj01-v14f-create-customer-asgi-composition.json`.
- `AsgiCoreProfileAdapter#call({ scope, body, send })` in `src/delivery/asgi-core-profile.mjs`,
  a framework-neutral ASGI send/call boundary around the existing `handle` method. It requires
  `send` to be a function (throws `TypeError` otherwise, without calling the router), computes
  the response events via the unchanged `handle({ scope, body })`, then `await`s `send` once
  per event in order (`http.response.start` then `http.response.body`), returning the same
  frozen event array `handle` would have returned. A rejecting `send` propagates and stops
  further sends. It is not an HTTP server and adds no Python ASGI app, Uvicorn, Hypercorn,
  FastAPI or Django dependency. `tests/kernel-asgi-core-profile.test.mjs` proves the
  non-function `send` rejection, in-order awaited dispatch with events equal to `handle`'s
  output, and propagation of a rejecting `send`. See
  `planning/gj01-v14e-asgi-send-boundary.json`.
- `src/delivery/asgi-core-profile.mjs`, `AsgiCoreProfileAdapter`, the smallest
  framework-neutral ASGI Core Profile boundary around `StandardRouter`. It is not a Python
  ASGI app and not a server. Constructor takes exactly `{ router }`, requires an exact
  `StandardRouter` instance by prototype identity, and freezes instance/class/prototype.
  `handle({ scope, body })` accepts an ordinary profile request; a malformed `scope`
  (wrong `type`, non-string `method`/`path`, malformed ASGI-style `headers` pairs) returns
  frozen 400 profile events without ever calling the router. A valid scope decodes
  string-or-`Uint8Array` header pairs (lowercase UTF-8 names, UTF-8 values, last value wins
  on duplicates) into a frozen plain header object, calls `router.handle` exactly once with
  a frozen `{ method, path, headers, body }` message, and converts the router's
  `{ status, headers, body }` response into two frozen events: `http.response.start` with
  lowercase `[name, value]` header pairs sorted by name, and `http.response.body` carrying
  the body unchanged with `more_body: false`. A malformed router response throws
  `TypeError`. No Node `http`/`net`/`fs`/`fetch`, no ASGI/FastAPI/Django/Uvicorn/Hypercorn
  dependency, no clock/random/env access.
  `tests/kernel-asgi-core-profile.test.mjs` proves constructor exactness, frozen surfaces,
  the 400 short-circuit, exactly-once dispatch, `Uint8Array` header decoding, deterministic
  header sorting, the `TypeError` on a malformed router response and forbidden-import
  checks. `tests/repository-boundary.test.mjs` now admits `asgi-core-profile.mjs` in the
  closed `src/delivery` ring module manifest. See
  `planning/gj01-v14c-asgi-core-profile.json`.
- `src/delivery/standard-router.mjs`, `StandardRouter`, the smallest framework-neutral route
  table in the delivery ring. Constructor takes exactly `{ routes }` (non-empty
  `{ method, path, handler }` records; duplicate `method`+`path` refused); router/class/
  prototype/records frozen. `handle({ method, path })` dispatches to the exact-match handler
  once, returning its response unchanged (throws `TypeError` on a non-object response);
  malformed shape -> 400, unknown path -> 404, unsupported method -> 405, no handler call. No
  body/header parsing, no framework/server import. See `planning/gj01-v14b-standard-router.json`.
- `src/delivery/create-customer-http-message-adapter.mjs`, `CreateCustomerHttpMessageAdapter`,
  the smallest framework-neutral HTTP message adapter for GJ-01 Create Customer. Constructor
  accepts exactly `{ handler }`, requires an exact `CreateCustomerRequestHandler` instance by
  prototype identity, and freezes instance/class/prototype. `handle(message)` accepts an
  ordinary `{ method, path, headers, body }`; a malformed shape, non-`POST` method or path
  other than `/customers` returns a frozen generic 400/405/404 without ever calling the
  handler. A valid `POST /customers` message extracts `requestId`/`actorId`/`tenantId`/
  `idempotencyKey` from the `x-request-id`/`x-actor-id`/`x-tenant-id`/`idempotency-key`
  headers (case-insensitive), sets `payload` to `body`, calls the handler exactly once, and
  maps its response to a frozen `{ status, headers, body }` carrying `content-type` and
  `x-request-id`. No Node `http`/`net`/`fs`/`fetch`, no ASGI/FastAPI/Django/Uvicorn/Hypercorn
  dependency, no clock/random/env access — proves the boundary a future host could call
  without selecting one. `tests/kernel-create-customer-http-message-adapter.test.mjs` proves
  option exactness, frozen response shapes, case-insensitive headers, the 400/404/405
  short-circuits and forbidden-import checks. `tests/repository-boundary.test.mjs` now admits
  `src/delivery` holding the new module alongside the composition root and request handler.
  `planning/gj01-v14a-framework-neutral-http-message.json` records scope and evidence.
  `flags.runnableProduct` stays `false`.
- `src/delivery/create-customer-composition.mjs`, `createCustomerComposition(options)`, the
  smallest framework-neutral composition root wiring the existing
  `CreateCustomerRequestHandler` to a real `CreateCustomerCommitService` and the existing
  `PostgresCommitAdapter`. Accepts exactly
  `{ connectionString, current, candidatesFor, evaluateInvariants }`; constructs
  `Identity({ current })`, `PolicyDecisionPoint({ candidatesFor })`,
  `CreateCustomerPipeline({ identity, policyDecisionPoint, evaluateInvariants })`,
  `PostgresCommitAdapter({ connectionString })` and
  `CreateCustomerCommitService({ pipeline, commit: adapter.commit.bind(adapter) })`, then
  `CreateCustomerRequestHandler({ service })`, and returns exactly one frozen
  `{ handler, close }` object — never the adapter, service, pipeline, identity or policy
  decision point. `close()` closes the composed `PostgresCommitAdapter`. No HTTP server, no
  ASGI runtime — FastAPI, Django, Uvicorn and Hypercorn are named only as non-goals — no
  clock/random/env/fs/net access; a composition root, not a server.
  `tests/kernel-create-customer-composition.test.mjs` proves option exactness, the frozen
  `{ handler, close }` shape, a DENY outcome mapping to 403 without ever touching the
  database, and that the module imports no forbidden capability or framework/runtime
  dependency. `tests/repository-boundary.test.mjs` now admits `src/delivery` holding exactly
  `create-customer-composition.mjs` and `create-customer-request-handler.mjs`.
  `planning/gj01-v13c-framework-neutral-composition.json` records scope, RED/GREEN evidence
  and rollback. `flags.runnableProduct` stays `false` — no HTTP server or ASGI runtime wires
  this composition to anything yet.
- `src/delivery/create-customer-request-handler.mjs`, `CreateCustomerRequestHandler`, a
  framework-neutral Delivery-ring handler materializing the `src/delivery` boundary opened by
  `planning/gj01-v12-src-adapters-delivery-boundary-authority.json`. The constructor accepts
  exactly `{ service }`, requires an exact `CreateCustomerCommitService` instance by prototype
  identity (not `instanceof`), and freezes the instance; the class and its prototype are frozen
  too. `handle(request)` accepts an ordinary object carrying exactly `requestId`, `actorId`,
  `tenantId`, `payload`, `idempotencyKey`, builds the ActionSpec via
  `buildCreateCustomerActionSpec` from `src/sdk/create-customer.mjs`, and calls
  `service.handle(actionSpec)` exactly once. `COMMITTED` maps to a frozen
  `{ status: 201, requestId, outcome: "COMMITTED", body: { commitReceipt } }`; `INVALID` maps to
  `status: 400`; `DENY` and `CROSS_TENANT_DENY` map to `status: 403`, both with
  `body: { error }`; an unknown service outcome throws `TypeError`. If
  `buildCreateCustomerActionSpec` throws, `handle` returns a frozen `400`
  `{ outcome: "INVALID", body: { error: { code: "ACTION_SPEC_INVALID", ... } } }` response without
  ever calling the service, using the raw string `requestId` (or `""`) from the malformed
  request. No HTTP/ASGI import, dependency or runtime coupling — FastAPI, Django, Uvicorn and
  Hypercorn are named only as non-goals, never imported, depended on or coupled to a runtime
  handle — no Postgres import, no clock/random/env/socket/file access — a delivery-shaped
  adapter, not a server.
  `tests/kernel-create-customer-request-handler.test.mjs` proves constructor exactness, service
  prototype-identity exactness, an invalid request maps to 400 without calling the service,
  `COMMITTED` maps to 201 and calls the service exactly once with a frozen ActionSpec,
  `DENY`/`CROSS_TENANT_DENY` map to 403, an unknown outcome throws, and the module imports no
  forbidden capability or framework/runtime dependency. `tests/repository-boundary.test.mjs`,
  `tests/kernel-one-golden-slice-boundary-authority.test.mjs` and
  `tests/kernel-runtime-substrate-s1.test.mjs` now admit `src/delivery` as a materialized ring
  holding exactly `create-customer-request-handler.mjs`, alongside `domain`, `application`,
  `sdk` and `adapters`. `planning/gj01-v13b-framework-neutral-delivery-handler.json` records
  scope, RED/GREEN evidence and rollback. `flags.runnableProduct` stays `false` — no HTTP server
  or ASGI runtime wires this handler to anything yet.
- `src/application/create-customer-commit-service.mjs`, `CreateCustomerCommitService`, a small
  framework-neutral Application-ring service composing one exact `CreateCustomerPipeline`
  instance with one injected `commit` port function. `handle(actionSpec)` runs
  `pipeline.run(actionSpec)`; a non-`ALLOW_COMMIT` outcome is returned frozen with its
  `outcome`/`requestId`/`error` preserved and `commitReceipt: null`, and the injected `commit`
  port is never called. An `ALLOW_COMMIT` outcome calls `commit(preparedChangeSet, { tenantId })`
  exactly once, awaits the frozen `CommitReceipt` the injected port returns, and answers a frozen
  result with `outcome: "COMMITTED"`, `requestId`, `error: null`, `preparedChangeSet: null` and
  `commitReceipt`. The constructor accepts exactly `{ pipeline, commit }`, requires an exact
  `CreateCustomerPipeline` instance and a function, and freezes the instance. No HTTP/ASGI/
  delivery import, no Postgres adapter import, no clock/random/env/socket/file access.
  `tests/kernel-create-customer-commit-service.test.mjs` proves the module/service existed only
  after this change, that a non-allow outcome never calls `commit`, that `ALLOW_COMMIT` calls
  `commit` exactly once with the `preparedChangeSet` and `{ tenantId }`, and that the constructor
  rejects a wrong-shaped `pipeline` or `commit`. `planning/gj01-v13a-application-commit-service.json`
  records scope, RED/GREEN evidence and rollback. `flags.runnableProduct` stays `false` — no
  delivery/HTTP layer wires this service to anything yet.
- `src/adapters/postgres-commit-adapter.mjs` now commits the `customer` write intent into
  `customer_records` (added by `0002_customer_records.py`) inside the same attested tenant
  transaction as `audit` and `transactionalOutbox`, and mints a full `CommitReceipt` — all four
  ALLOW_COMMIT intents (`customer`, `audit`, `transactionalOutbox`, `idempotency`) committed, no
  deferred intents, `receiptType: "CommitReceipt"`, `customerRecordId`/`auditLogId`/`outboxId`
  returned frozen. `intents.customer` is validated as an ordinary object with a non-empty
  `payload.name`; `intents.customer.tenantId` is mandatory — a non-empty string that must exactly
  match `options.tenantId` — and a missing or mismatched `tenantId` is rejected before any DB
  work. A duplicate
  idempotency fingerprint still rolls back the whole transaction, so no partial customer row can
  ever be left behind. `tests/postgres-commit-adapter.test.mjs` proves this against a real
  disposable Docker-backed PostgreSQL 16 instance. `planning/gj01-v12b2b-customer-commit-receipt.json`
  records scope, RED/GREEN evidence and rollback; this closes the declared V12B2A-ii follow-up.
  `flags.gapClosed` is `true`; `kernelReady`, `oneGoldenSliceReady`, `walkingSkeletonReady`,
  `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed` and `runnableProduct`
  all stay `false` — no delivery/HTTP layer calls this adapter yet.
- `db/metaframer_kernel_db/alembic/versions/0002_customer_records.py`, a second Alembic revision
  (`down_revision = "0001_runtime_substrate"`) adding `customer_records`, the S1 substrate's first
  tenant-owned domain table — `id`, `tenant_id`, `name`, `payload`, `created_at`, `recorded_at` —
  under `ENABLE`/`FORCE ROW LEVEL SECURITY` with a `tenant_id = mfk_current_tenant()` policy reusing
  0001's attestation function, and a runtime-role grant limited to `SELECT, INSERT, UPDATE, DELETE`
  with no DDL or control-plane access. `downgrade()` drops only `customer_records`, leaving
  `transactional_outbox`, `audit_log` and every object 0001 owns untouched.
  `db/metaframer_kernel_db/schema.py` gained `CUSTOMER_TABLE` and a `customer_table` contract key;
  `db/metaframer_kernel_db/migrations.py`'s `HEAD_REVISION` now points at `0002_customer_records`.
  `db/tests/test_customer_records.py` proves, against a real disposable Docker-backed PostgreSQL 16
  instance, that migrating to head creates the table under forced RLS, a tenant reads only its own
  rows, a missing tenant context denies both reads and writes, and downgrading to 0001 removes only
  `customer_records`. `planning/gj01-v12b2a-i-customer-migration.json` records scope, RED/GREEN
  evidence and rollback. This package deliberately leaves `db/kernel-runtime-substrate-s1.json`,
  its checker and its test, `src/adapters/postgres-commit-adapter.mjs` and `CommitReceipt` untouched
  — that JS-oracle drift is a declared follow-up, V12B2A-ii. `flags.kernelReady`,
  `oneGoldenSliceReady`, `walkingSkeletonReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`,
  `productionAllowed` and `gapClosed` all stay `false`, and `runnableProduct` is `false`.
- Closed the V12B2A-i JS-oracle drift. `db/kernel-runtime-substrate-s1.json`,
  `tools/check-kernel-runtime-substrate-s1.mjs` and `tests/kernel-runtime-substrate-s1.test.mjs`
  now acknowledge Alembic head `0002_customer_records`, chained onto the baseline
  `0001_runtime_substrate` via `down_revision`. The checker gains `BASE_REVISION` (the baseline,
  still required to carry no predecessor) alongside `HEAD_REVISION` (now the head), and a new
  `CUSTOMER_DOMAIN_TABLES` constant (`["customer_records"]`) checked against the 0002 revision's
  source and kept structurally separate from `PHYSICAL_RUNTIME_TABLES`/`RUNTIME_TABLES`, which
  stays exactly `[transactional_outbox, audit_log]`; the S1 substrate's own two-table shape is
  unchanged. `productionSurface.revisionCount` moves from `1` to `2` and `productionSurface.modules`
  gains the 0002 revision file. `planning/gj01-v12b2a-ii-customer-oracle.json` records RED (21
  failing assertions against the working tree V12B2A-i already shipped), scope, non-goals and
  rollback. This package touches no Python module, migration or table, no
  `src/adapters/postgres-commit-adapter.mjs`, and mints no `CommitReceipt`. `flags.kernelReady`,
  `oneGoldenSliceReady`, `walkingSkeletonReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`,
  `productionAllowed` and `gapClosed` all stay `false`, and `runnableProduct` is `false`.
- `src/adapters/postgres-commit-adapter.mjs`, materializing the `src/adapters` boundary opened by
  `planning/gj01-v12-src-adapters-delivery-boundary-authority.json` with `PostgresCommitAdapter`: a
  JS application-owned persistence port that commits a `CreateCustomerPipeline` `ALLOW_COMMIT`
  `preparedChangeSet` against the real PostgreSQL S1 substrate inside one attested tenant
  transaction, using the `pg` driver. `planning/gj01-v12b1-postgres-adapter.json` records the
  package's scope, non-goals and rollback. The S1 substrate owns exactly two runtime tables
  (`transactional_outbox`, `audit_log`) and no customer-owning table, so the adapter commits three
  of the pipeline's four write intents for real — `audit` as an `audit_log` row, `transactionalOutbox`
  as a `transactional_outbox` row, and `idempotency` realized as that row's `dedup_key`, enforced by
  the substrate's own per-tenant unique index — and honestly defers `customer`, minting no
  `CommitReceipt`. `tests/postgres-commit-adapter.test.mjs` proves this against a real, disposable
  Docker-backed PostgreSQL 16 instance, never a mock. `flags.kernelReady`, `oneGoldenSliceReady`,
  `walkingSkeletonReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed` and
  `gapClosed` all stay `false`, `capabilityDelta` is `NONE` and `runnableProduct` is `false`. A
  narrow follow-up added an `npm ci` step to the `node-checks` CI job, which had no dependency-install
  step and so failed importing `pg`; no other job or action changed. This
  introduces no HTTP/ASGI/Uvicorn/Hypercorn/FastAPI/Django delivery surface, no `src/delivery`
  content and no change to `db/metaframer_kernel_db`.
- `planning/gj01-v12-src-adapters-delivery-boundary-authority.json`, a repository-boundary-authority
  package moving `src/adapters` and `src/delivery` from the repository root's forbidden
  first-children-of-`src` set to its permitted set, the way `src/sdk` was opened by
  `planning/gj01-src-sdk-boundary-authority.json`. `tools/check-repository-boundary.mjs` now
  exports `ROOT_SRC_PERMITTED_CHILDREN` as `["domain", "application", "sdk", "adapters",
  "delivery"]` with an empty `ROOT_SRC_FORBIDDEN_CHILDREN`; `db/kernel-runtime-substrate-s1.json`'s
  `rootSourceTopology` clause re-exports the same widened boundary. No `src/adapters` or
  `src/delivery` directory or file is created. `flags.kernelReady`, `oneGoldenSliceReady`,
  `walkingSkeletonReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed`
  and `gapClosed` all stay `false`, `capabilityDelta` is `NONE` and `runnableProduct` is `false`.
  This does not narrow, close or execute step 4 (one-golden-slice / walking-skeleton) of the
  pinned runtime-start sequence, and implements no HTTP, ASGI, Uvicorn, Hypercorn, FastAPI or
  Django delivery surface, no persistence or DB runtime change, and no CommitReceipt or
  outbox/audit runtime behaviour. A future, separately scoped Package B may target `src/adapters`
  and `src/delivery` once this package is GREEN and separately approved.
- `planning/gj01-v11-generated-sdk-step-closure.json`, a package-local closure record proving
  step 3 (`generated-sdk`) of the pinned runtime-start sequence is closed for CreateCustomer@1 by
  composing four already-GREEN evidence records: the `src/sdk` boundary opened by
  `planning/gj01-src-sdk-boundary-authority.json`, the frozen protocol contract in
  `planning/gj01-generated-sdk-protocol-readiness.json`, the materialized artifact in
  `planning/gj01-generated-sdk-generation.json` / `src/sdk/create-customer.mjs`, and the
  deterministic generator in `planning/gj01-v10-deterministic-sdk-generator.json` /
  `tools/generate-create-customer-sdk.mjs`. It writes no new production code and edits none of
  the composed evidence, the artifact, or the generator. `flags.generatedSdkStepClosed` is `true`
  while `kernelReady`, `sdkReady`, `generatedSdkReady`, `appBuildable`, `releaseAllowed`,
  `deployAllowed`, `productionAllowed` and `gapClosed` all stay `false`, `capabilityDelta` is
  `NONE` and `runnableProduct` is `false`. This does not open step 4 (one-golden-slice /
  walking-skeleton) of the sequence.
- `tools/generate-create-customer-sdk.mjs`, a deterministic generator exporting a pure
  `renderCreateCustomerSdk(protocol)` function that renders `src/sdk/create-customer.mjs`
  byte-identically from the frozen protocol contract in
  `planning/gj01-generated-sdk-protocol-readiness.json`. `planning/gj01-v10-deterministic-sdk-generator.json`
  records the package's scope, non-goals and rollback. The render path performs no network,
  environment read, clock, random value or file I/O; the CLI entry point may read the protocol
  file and print or check output but never writes to the repository, and the committed artifact
  stays byte-identical to its prior content throughout. This introduces no HTTP/ASGI delivery
  surface, no persistence and no runtime; every stronger-stage readiness flag stays false.
- The first generated-SDK artifact, `src/sdk/create-customer.mjs`, materializing the `src/sdk`
  boundary opened by `planning/gj01-src-sdk-boundary-authority.json` with a framework-neutral,
  capability-free module for CreateCustomer@1, byte-derived from the frozen protocol contract in
  `planning/gj01-generated-sdk-protocol-readiness.json`. `planning/gj01-generated-sdk-generation.json`
  records the package's scope, non-goals and rollback, including a narrow architecture-fitness
  supplement that `tools/check-p01-architecture-fitness.mjs` merges at runtime to admit `src/sdk`
  as a generated-boundary onion layer (order 3, after Application, before Adapters) without editing
  the pinned, byte-immutable `planning/kernel-runtime-pilot-consumer-sync.json` activation-base
  artifact, which stays byte-identical to its historical content throughout. This introduces no
  generator, no HTTP/ASGI delivery surface, no persistence and no runtime; every stronger-stage
  readiness flag stays false.
- The token economy governance package. `token-economy-policy.json` is the canonical owner of
  every token-economy rule, threshold, model route and escalation gate; the skill at
  `.claude/skills/metaframer-token-economy/SKILL.md`, the agent at
  `.claude/agents/token-governor.md` and the README token-economy section are its projections,
  and `tools/check-token-economy.mjs` asserts parity in one direction only. What that checker
  does not compare is recorded in the policy under `checkerCoverage` rather than left implied.
  `token-economy-ledger.json` is operational state and deliberately not a projection, since the
  economics command reads it back as a source.
- `tools/token-guard.mjs`, a deterministic gate that decides nine process invariants from facts
  at zero model cost and reports PASS, DENY or ESCALATE. A bare run observes git and the
  guardian admission decision and settles four of the nine; the five orchestration-layer
  registries are reported as unobserved and escalate rather than passing, because an
  unobservable registry is not an empty one. `node tools/token-guard.mjs economics
  --ledger=<path>` computes the governor net contribution from thresholds read out of the
  canonical policy rather than from its caller.
- The `token-governor` agent is event-driven rather than per-wave, holds a read-only tool
  allowlist the checker enforces against a single canonical spelling, and receives the gate
  verdict rather than running it. A net-negative ledger produces exit 5; acting on that verdict
  belongs to an orchestration layer that is not implemented here.
- The PostgreSQL runtime substrate (stage S1) under `db/metaframer_kernel_db`, with its declared
  contract in `db/kernel-runtime-substrate-s1.json`: a single Alembic baseline, the
  `transactional_outbox` and `audit_log` tables under both ENABLE and FORCE row-level security, a
  controlled transaction boundary whose tenant context is attested with a keyed HMAC signature,
  outbox claim taken with `FOR UPDATE SKIP LOCKED`, and an append-only audit invariant enforced by
  a statement-level trigger.
- Domain identity primitives in `src/domain/identity-primitives.mjs`: `TenantId`, `CorrelationId`,
  `CausationId`, `ActorId`, `Principal` and `IdempotencyKey` — closed, frozen, framework-free value
  types with exact-class equality and canonical serialisation.
- Application action primitives in `src/application/action-primitives.mjs`: `Command`, `Query`,
  `KernelError` and `Result`.
- The use-case contract in `src/application/use-case.mjs`: `UseCase`.
- The unit-of-work port in `src/application/unit-of-work.mjs`: `UnitOfWork`, specifying only the
  begin / body / commit order and rollback on failure.
- A fail-closed governance and boundary verification surface under `tools`, run by `npm test` and
  `npm run check`: the repository boundary, the control-plane bootstrap, AI development readiness,
  the runtime substrate, the current-authority consumer-sync overlay, and the composed
  checkout-local projection.
- This versioning and changelog governance: the canonical `versioning-policy.json`, its verifier
  `tools/check-versioning-changelog.mjs`, the human projection in `docs/versioning-policy.md`, and
  this document.
- The `CreateCustomer@1` Application pipeline in `src/application/create-customer-pipeline.mjs`:
  `CreateCustomerPipeline`, a deterministic, framework-free stage sequence from raw `ActionSpec`
  fields to one closed outcome — `ALLOW_COMMIT`, `DENY`, `INVALID` or `CROSS_TENANT_DENY` — built
  entirely from the existing `Identity`, `PolicyDecisionPoint`, `Command`, `PolicyRequest` and
  `KernelError` surfaces plus one injected pure `evaluateInvariants` collaborator.
  `ALLOW_COMMIT` means allowed-to-commit only: it returns a frozen `PreparedChangeSet` with
  `persistenceState: "pending"` and exactly four write intents, and mints no `CommitReceipt`.
- The generated-SDK protocol readiness contract in
  `planning/gj01-generated-sdk-protocol-readiness.json`: a declarative pin of the
  `customer.create@1` typed-action fields, outcome enum and error-envelope shape, read off the
  already-closed `CreateCustomerPipeline` rather than invented. It narrows step 3
  (`generated-sdk`) of the pinned runtime-start sequence to a protocol contract only —
  `sdkReady`, `appBuildable`, `releaseAllowed`, `deployAllowed`, `productionAllowed`,
  `gapClosed` and `kernelReady` all stay `false`, `capabilityDelta` is `NONE` and
  `runnableProduct` is `false`. It introduces no `src/sdk`, no generator, no generated client and
  no ASGI/Uvicorn/Hypercorn/FastAPI delivery surface; V5 delivery stays blocked on both the
  generated-SDK step and the one-golden-slice step of that sequence closing GREEN.

- The `src/sdk` boundary-authority package in
  `planning/gj01-src-sdk-boundary-authority.json`: moves `sdk` from the repository root
  source-topology fence's forbidden first children to its permitted first children, so a future,
  separately authorized generation package has a boundary to write into. `src/sdk` is permitted to
  exist and is never required to; this package creates no directory, no generator and no generated
  client code under it. `src/adapters` and `src/delivery` remain refused by name. `sdkReady`,
  `generatedSdkReady`, `implementsSdkGeneration` and every other stronger-stage flag stay `false`;
  `capabilityDelta` is `NONE` and `runnableProduct` is `false`. The shared fence is read by both
  `tools/check-repository-boundary.mjs` and `tools/check-kernel-runtime-substrate-s1.mjs`
  (via `db/kernel-runtime-substrate-s1.json#rootSourceTopology`), so both moved together as one
  package rather than drifting apart.

### Changed
- `src/delivery/standard-router.mjs`, `StandardRouter.handle` is now an `async` method. It
  awaits exactly one call to `route.handler.handle(message)`, whether the handler returns a
  plain object synchronously or a Promise, so `StandardRouter` composes with async delivery
  handlers (e.g. `CreateCustomerHttpMessageAdapter.handle`) without a synchronous-shape
  mismatch. Short-circuit responses (`400 MESSAGE_SHAPE_INVALID`, `404 ROUTE_NOT_FOUND`,
  `405 METHOD_NOT_SUPPORTED`) remain the same deterministic frozen objects, only now
  delivered through the async method; a non-ordinary-object response (sync or resolved by
  an async handler) still causes the returned promise to reject with `TypeError`.
  `src/delivery/asgi-core-profile.mjs`, `AsgiCoreProfileAdapter.handle` is now `async` and
  awaits `router.handle` before converting the response into frozen ASGI-profile events; a
  malformed scope still short-circuits without ever calling the router.
  `tests/kernel-standard-router.test.mjs` and `tests/kernel-asgi-core-profile.test.mjs` now
  await every `handle` call, and add coverage proving `handle` returns a Promise, an async
  handler resolving a response is awaited and its response returned, and a malformed
  response (sync or from an async handler) rejects with `TypeError` instead of throwing
  synchronously. See `planning/gj01-v14d-async-standard-router.json`.
- The repository root source-topology fence was widened again: a root `src` is permitted and may
  hold `src/domain`, `src/application` and `src/sdk` as its only first children — `src/domain` and
  `src/application` materialized, `src/sdk` a permitted-but-not-yet-materialized boundary — with
  `src/adapters` and `src/delivery` refused by name.
- Authority reporting now separates a checkout-local projection from project authority, so a
  feature checkout can no longer print a line that reads as the project's verdict.
- The package version moved from the planning placeholder 0.0.0-planning onto the prerelease train
  at 0.1.0-alpha.1. This is a train entry, not a release.

### Fixed
- `PostgresCommitAdapter.commit` in `src/adapters/postgres-commit-adapter.mjs` now accepts a
  `customer.payload` that is either an ordinary `Object.prototype` record or a null-prototype safe
  record (e.g. `Object.create(null)`), instead of only the former. RED evidence for GJ-01 V14K
  showed the real ASGI-\>pipeline path decoding a JSON body into a null-prototype safe record,
  which the adapter's prior `isOrdinaryObject`-only check refused before any DB work with
  `intents.customer.payload.name must be a non-empty string` — a genuine product gap, not a test
  artifact. The `payload.name` non-empty-string requirement is unchanged, arrays/class
  instances/functions/other exotic objects are still refused, every other intent/option strictness
  check is untouched, and the DB payload column is still written via `JSON.stringify(payload)`.
