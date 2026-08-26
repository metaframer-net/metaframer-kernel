import { Identity } from "../application/identity.mjs";
import { Clock } from "../application/clock.mjs";
import { Command } from "../application/action-primitives.mjs";
import { PolicyDecisionPoint } from "../application/policy-decision-point.mjs";
import { PolicyRequest, PolicyDecision } from "../application/policy-decision.mjs";
import { DecisionLogEntry } from "../application/decision-log-entry.mjs";
import { DecisionLogPort } from "../application/decision-log-port.mjs";
import { DecisionLoggingPolicyDecisionPoint } from "../application/decision-logging-policy-decision-point.mjs";
import { CreateCustomerPipeline } from "../application/create-customer-pipeline.mjs";
import { CreateCustomerCommitService } from "../application/create-customer-commit-service.mjs";
import { UnitOfWork } from "../application/unit-of-work.mjs";
import { WriteEnvelope } from "../application/write-envelope.mjs";
import { createPostgresUnitOfWork } from "../adapters/postgres-unit-of-work.mjs";
import { PostgresDecisionLogAdapter } from "../adapters/postgres-decision-log-adapter.mjs";
import { createPostgresWrite } from "../adapters/postgres-write-envelope-write.mjs";
import { CreateCustomerRequestHandler } from "./create-customer-request-handler.mjs";

// =====================================================================================
// createCustomerComposition
//
// The smallest framework-neutral composition root that wires one real
// CreateCustomerRequestHandler to a real CreateCustomerCommitService, backed by one
// createPostgresUnitOfWork resource. It constructs Identity, PolicyDecisionPoint,
// CreateCustomerPipeline, the PostgresUnitOfWork resource, CreateCustomerCommitService and
// CreateCustomerRequestHandler from exactly the four caller-supplied collaborators, and hands
// back exactly one frozen { handler, close } object — never the resource, service, pipeline,
// identity or policy decision point. Each commit is its own fresh UnitOfWork/write/WriteEnvelope
// triple, driven from the same shared resource.port, so concurrent ALLOW_COMMIT requests never
// contend with each other.
//
// Framework-free and capability-free by construction: no HTTP/ASGI import, no FastAPI, no
// Django, no Uvicorn, no Hypercorn, no fetch, no fs/net/http import, no clock, no random
// value, no environment read. This is a composition root, not a server.
// =====================================================================================

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const OPTIONS_KEYS = ["connectionString", "current", "candidatesFor", "evaluateInvariants"];

function checkOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("createCustomerComposition needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.length !== OPTIONS_KEYS.length || OPTIONS_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`createCustomerComposition options must carry exactly these keys: ${OPTIONS_KEYS.join(", ")}`);
  }
  const { connectionString, current, candidatesFor, evaluateInvariants } = options;
  if (typeof connectionString !== "string" || !connectionString) {
    throw new TypeError("createCustomerComposition connectionString must be a non-empty string");
  }
  if (typeof current !== "function") {
    throw new TypeError("createCustomerComposition current must be a function");
  }
  if (typeof candidatesFor !== "function") {
    throw new TypeError("createCustomerComposition candidatesFor must be a function");
  }
  if (typeof evaluateInvariants !== "function") {
    throw new TypeError("createCustomerComposition evaluateInvariants must be a function");
  }
  return { connectionString, current, candidatesFor, evaluateInvariants };
}

/**
 * Wire one real CreateCustomerRequestHandler to a real CreateCustomerCommitService and a real
 * createPostgresUnitOfWork resource, from exactly the four caller-supplied collaborators.
 * Returns a frozen `{ handler, close }` object; `close` closes the composed
 * createPostgresUnitOfWork resource.
 */
export function createCustomerComposition(options) {
  const checked = checkOptions(options);

  const identity = new Identity({ current: checked.current });
  const policyDecisionPoint = new PolicyDecisionPoint({ candidatesFor: checked.candidatesFor });
  const pipeline = new CreateCustomerPipeline({
    identity,
    policyDecisionPoint,
    evaluateInvariants: checked.evaluateInvariants,
  });
  const resource = createPostgresUnitOfWork({ connectionString: checked.connectionString });
  const service = new CreateCustomerCommitService({
    pipeline,
    commit: (preparedChangeSet, context) => {
      const unitOfWork = new UnitOfWork(resource.port);
      const write = createPostgresWrite({ requestId: context.requestId, idempotencyKey: context.idempotencyKey });
      const envelope = new WriteEnvelope({ unitOfWork, write });
      return envelope.commit(preparedChangeSet);
    },
  });
  const handler = new CreateCustomerRequestHandler({ service });

  return Object.freeze({
    handler,
    close: () => resource.close(),
  });
}
Object.freeze(createCustomerComposition);

// =====================================================================================
// createAuditedCustomerComposition
//
// The same composition root, with the boundary's authorization decision made durably auditable.
// It differs from `createCustomerComposition` in exactly one wiring choice: the pipeline's policy
// decision point is a DecisionLoggingPolicyDecisionPoint over a real PostgresDecisionLogAdapter,
// so every decision this boundary reaches — allow and deny alike — is appended to the append-only,
// hash-chained `policy_decision_log` before the decision is handed back. Because the pipeline
// awaits that decision before its invariant stage and long before any commit, a decision that
// cannot be logged stops the request instead of letting it commit unaudited. Nothing about stage
// order, outcome projection or the four write intents changes.
//
// Two pools are owned here, both over the same caller-supplied connection string and both this
// factory's to release: the decision log adapter's, and the lazily created unit-of-work resource's.
// `close` attempts both, always, and only then re-raises the first refusal — a pool that failed to
// end must never leave its sibling open.
//
// It also wires the pipeline's optional `auditIdentityGuard` witness, over the very same decision
// log, id generator, clock and chain head. The identity guard runs ahead of the policy decision
// point, so a request claiming a foreign tenant or a foreign actor was refused before any decision
// existed to record — the one class of request most worth a record was the one leaving none. Each
// such refusal now lands in the same append-only, hash-chained log, as a fixed reserved system-layer
// default deny that matches no policy and resolves no layer, before the refusal is handed back; a
// deny that cannot be recorded stops the request instead of answering an unrecorded 403.
//
// That audit row is built *only* from the authenticated identity and this request's own genuine
// correlation and idempotency values, over an empty payload. No attacker-claimed tenant or actor is
// carried into the Command, the PolicyRequest, the reason or the row: the pipeline never hands the
// witness a claimed value, and this factory never reads one.
//
// The six admitted options are read exactly once, synchronously, as own enumerable data
// properties, before any adapter is constructed and therefore before any pool exists — a refused
// option set leaves nothing behind to close. `idGenerator` and `now` are collaborators, not
// capabilities: this module still mints no id, reads no ambient clock, no environment value and no
// random value of its own, and imports no HTTP/ASGI, framework or host surface. This is a
// composition root, not a server.
// =====================================================================================

// The stage the audited refusal is filed under, and one fixed reason per guard. The two reasons are
// deliberately distinct, so the log tells a cross-tenant reach apart from an actor mismatch, and a
// request whose tenant and actor are both wrong is recorded under the tenant reason — the guard's
// fixed precedence stays visible in the record, not only in the response. Neither reason echoes a
// value the request claimed, exactly as PolicyDecision requires of any refusal.
const IDENTITY_GUARD_STAGE = "identityTenantGuard";

const IDENTITY_GUARD_REASONS = Object.freeze({
  CROSS_TENANT_DENY: "identity guard: the authenticated principal does not hold the tenant this request claimed, so the request was refused at the system layer before any policy was consulted",
  IDENTITY_MISMATCH: "identity guard: the authenticated principal is not the actor this request claimed, so the request was refused at the system layer before any policy was consulted",
});

/**
 * Build the durable identity-guard witness the audited pipeline is given.
 *
 * It reconstructs, from the authenticated identity alone, exactly the audit-only decision that was
 * never taken: one genuine `customer.create` Command over an empty payload, one PolicyRequest whose
 * context names the guard stage and, under `guard`, the code that refused, and one fixed default-deny PolicyDecision
 * — matching no policy and therefore resolving no layer — tracing this request's own CorrelationId.
 * Chain head, id and instant are then resolved through the same collaborators the audited policy
 * decision point uses, so a guard refusal and a policy decision share one chain in the order they
 * happened.
 *
 * An unrecognised code is refused here rather than filed under a blank reason: the caller is the
 * pipeline's own fixed guard, so anything else is drift and must fail closed.
 */
function createIdentityGuardAuditor(decisionLog, chainHead, idGenerator, clock) {
  return async (guard) => {
    if (!Object.prototype.hasOwnProperty.call(IDENTITY_GUARD_REASONS, guard.code)) {
      throw new TypeError(`createAuditedCustomerComposition cannot audit an unknown identity-guard code: ${String(guard.code)}`);
    }
    const principal = guard.principal;
    const action = new Command({
      name: "customer.create",
      version: 1,
      principal,
      correlationId: guard.correlationId,
      causationId: null,
      idempotencyKey: guard.idempotencyKey,
      payload: {},
    });
    const request = new PolicyRequest({
      action,
      resource: { type: "customer", tenantId: principal.tenantId.toString() },
      context: { stage: IDENTITY_GUARD_STAGE, guard: guard.code },
    });
    const decision = new PolicyDecision({
      effect: "deny",
      reason: IDENTITY_GUARD_REASONS[guard.code],
      matchedPolicyId: null,
      traceId: guard.correlationId,
    });
    const prevHash = await chainHead(principal.tenantId);
    const id = await idGenerator();
    const ts = await clock.now();
    await decisionLog.append(new DecisionLogEntry({ id, request, decision, layerResolved: null, ts, prevHash }));
  };
}

const AUDITED_OPTIONS_KEYS = [
  "connectionString", "current", "candidatesFor", "evaluateInvariants", "idGenerator", "now",
];

const AUDITED_FUNCTION_KEYS = ["current", "candidatesFor", "evaluateInvariants", "idGenerator", "now"];

const AUDITED_KEYS_REFUSAL = `createAuditedCustomerComposition options must carry exactly these six own enumerable data keys: ${AUDITED_OPTIONS_KEYS.join(", ")}`;

/**
 * Take the six collaborators out of the one options object, or refuse — synchronously, in full,
 * before a single connection, pool or adapter exists.
 *
 * The key count is read with `Reflect.ownKeys`, so a symbol-keyed member counts as a seventh key
 * rather than arriving unannounced. Each key is then read through its own descriptor rather than
 * by property access, so an accessor is refused rather than invoked: reading an option may not run
 * caller code, and a composition root is the last place an option should be able to.
 */
function checkAuditedOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("createAuditedCustomerComposition needs exactly one ordinary options object");
  }
  if (Reflect.ownKeys(options).length !== AUDITED_OPTIONS_KEYS.length) {
    throw new TypeError(AUDITED_KEYS_REFUSAL);
  }
  const checked = {};
  for (const key of AUDITED_OPTIONS_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(AUDITED_KEYS_REFUSAL);
    }
    checked[key] = descriptor.value;
  }
  if (typeof checked.connectionString !== "string" || !checked.connectionString) {
    throw new TypeError("createAuditedCustomerComposition connectionString must be a non-empty string");
  }
  for (const key of AUDITED_FUNCTION_KEYS) {
    if (typeof checked[key] !== "function") {
      throw new TypeError(`createAuditedCustomerComposition ${key} must be a function`);
    }
  }
  return checked;
}

/**
 * Wire one real CreateCustomerRequestHandler to a real CreateCustomerCommitService, a real
 * createPostgresUnitOfWork resource and a real PostgresDecisionLogAdapter, from exactly the six
 * caller-supplied collaborators. Returns a frozen `{ handler, close }` object; `close` attempts to
 * release both pools this factory owns and then re-raises the first refusal, if there was one.
 */
export function createAuditedCustomerComposition(options) {
  const checked = checkAuditedOptions(options);

  const identity = new Identity({ current: checked.current });
  const clock = new Clock({ now: checked.now });
  const decisionLogAdapter = new PostgresDecisionLogAdapter({ connectionString: checked.connectionString });
  const decisionLog = new DecisionLogPort({ append: decisionLogAdapter.append });
  const policyDecisionPoint = new DecisionLoggingPolicyDecisionPoint({
    candidatesFor: checked.candidatesFor,
    decisionLog,
    idGenerator: checked.idGenerator,
    clock,
    chainHead: decisionLogAdapter.chainHead,
  });
  const pipeline = new CreateCustomerPipeline({
    identity,
    policyDecisionPoint,
    evaluateInvariants: checked.evaluateInvariants,
    auditIdentityGuard: createIdentityGuardAuditor(
      decisionLog, decisionLogAdapter.chainHead, checked.idGenerator, clock,
    ),
  });
  const resource = createPostgresUnitOfWork({ connectionString: checked.connectionString });
  const service = new CreateCustomerCommitService({
    pipeline,
    commit: (preparedChangeSet, context) => {
      const unitOfWork = new UnitOfWork(resource.port);
      const write = createPostgresWrite({ requestId: context.requestId, idempotencyKey: context.idempotencyKey });
      const envelope = new WriteEnvelope({ unitOfWork, write });
      return envelope.commit(preparedChangeSet);
    },
  });
  const handler = new CreateCustomerRequestHandler({ service });

  return Object.freeze({
    handler,
    // Both closes are started before either is awaited for its verdict, so a rejected first close
    // can never skip the second. The first refusal is then re-raised unchanged, because a caller
    // that asked for its pools back is entitled to learn that one of them did not come back.
    close: async () => {
      const settled = await Promise.allSettled([decisionLogAdapter.close(), resource.close()]);
      const refused = settled.find((outcome) => outcome.status === "rejected");
      if (refused !== undefined) {
        throw refused.reason;
      }
    },
  });
}
Object.freeze(createAuditedCustomerComposition);
