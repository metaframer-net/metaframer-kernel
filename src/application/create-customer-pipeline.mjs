import { Command, KernelError } from "./action-primitives.mjs";
import { Identity } from "./identity.mjs";
import { PolicyDecisionPoint } from "./policy-decision-point.mjs";
import { DecisionLoggingPolicyDecisionPoint } from "./decision-logging-policy-decision-point.mjs";
import { PolicyRequest } from "./policy-decision.mjs";
import { ActorId, CorrelationId, IdempotencyKey, TenantId } from "../domain/identity-primitives.mjs";

// =====================================================================================
// CreateCustomerPipeline
//
// One deterministic Application-ring pipeline for exactly one action, `customer.create@1`. It
// takes the exact raw ActionSpec fields a caller supplies — requestId, actorId, tenantId,
// payload, idempotencyKey — and closes on exactly one of four outcomes: ALLOW_COMMIT, DENY,
// INVALID, CROSS_TENANT_DENY. It reuses Identity, PolicyDecisionPoint, Command, PolicyRequest
// and KernelError from this ring and the domain identity primitives; it invents no
// authorization rule, no persistence and no second evaluation of anything already decided
// elsewhere.
//
// ALLOW_COMMIT means allowed-to-commit only. It returns a frozen, deterministic
// PreparedChangeSet with persistenceState "pending" and exactly four intents — customer, audit,
// transactionalOutbox, idempotency. It is not a commit, mints no CommitReceipt, opens no
// UnitOfWork, and touches no database, RLS, audit or outbox implementation. A non-allow outcome
// carries a V2-shaped, non-leaking error envelope — code, message, requestId, retryable — and
// zero write intents.
//
// One optional collaborator is admitted beside those three: `auditIdentityGuard`. It is awaited
// only after the identityTenantGuard has already refused a request, and only to witness that
// refusal — it decides nothing, changes no outcome, and is handed the authenticated identity rather
// than the one the ActionSpec claimed. Omit it and this pipeline is exactly what it was before.
//
// Framework-free and capability-free by construction: no clock, no random value, no environment
// read, no network or file access. The only non-pure step is awaiting the two injected ports
// (Identity, PolicyDecisionPoint), the one injected pure `evaluateInvariants` collaborator and, on
// a guard refusal alone, the optional `auditIdentityGuard` witness; given the same ActionSpec and
// the same collaborator answers, two runs serialize byte-identically.
// =====================================================================================

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

/** Exact-class test: prototype identity, never `instanceof`, so a subclass is never admitted. */
const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

// The two genuine decision points this pipeline admits, and no third. Both answer the same one
// question — `decide(request)` — and the audited one additionally appends the decision it just made
// to an append-only log before it hands that decision back, which is exactly why the policy stage
// below needs no knowledge of which of the two it is holding. Nothing here duck-types: an object is
// admitted because its prototype is one of these two, never because it happens to carry a `decide`.
const DECISION_POINT_TYPES = Object.freeze([PolicyDecisionPoint, DecisionLoggingPolicyDecisionPoint]);

/**
 * Whether a value is a genuine instance of exactly one of the two admitted decision points.
 *
 * Prototype identity is the first half and refuses a subclass, a facade and an ordinary object. It
 * is not the whole answer, because `Object.create(SomePoint.prototype)` wears the right prototype
 * with no constructor ever run and no collaborator installed. Both admitted constructors finish by
 * freezing the instance they built, and neither leaves an own property on it, so the second half is
 * that structural brand: a hollow impostor is still extensible and is refused here.
 *
 * What this cannot do is stated rather than implied: a caller that deliberately freezes a hollow
 * object built on one of these prototypes satisfies the brand, and a transparent proxy over a
 * genuine instance answers exactly as its target does. Neither is detectable from here, and no
 * detection is claimed.
 */
const isGenuineDecisionPoint = (value) =>
  DECISION_POINT_TYPES.some((type) => isExactly(value, type))
  && Object.isFrozen(value) && Reflect.ownKeys(value).length === 0;

const ACTION_SPEC_KEYS = ["requestId", "actorId", "tenantId", "payload", "idempotencyKey"];

const REQUIRED_OPTIONS_KEYS = ["identity", "policyDecisionPoint", "evaluateInvariants"];

// The one optional collaborator this pipeline admits, and no second. It is a *witness*, never a
// decider: the identity guard below has already refused the request by the time it is called, its
// answer cannot change that refusal, and a pipeline built without it behaves exactly as it did
// before this option existed. It exists because the guard short-circuits ahead of the policy
// decision point, so an attempted cross-tenant or cross-actor reach — the one class of request most
// worth a record — would otherwise be refused with nothing written anywhere.
const OPTIONAL_OPTIONS_KEYS = ["auditIdentityGuard"];

const OPTIONS_KEYS = [...REQUIRED_OPTIONS_KEYS, ...OPTIONAL_OPTIONS_KEYS];

const OPTIONS_REFUSAL = `CreateCustomerPipeline options must carry exactly these keys: ${REQUIRED_OPTIONS_KEYS.join(", ")}, and may optionally carry: ${OPTIONAL_OPTIONS_KEYS.join(", ")}`;

/**
 * The optional guard auditor, taken from its own property descriptor or refused.
 *
 * Absence is the legacy contract and answers `null`. Presence is read as data and never invoked:
 * an accessor-backed option would run caller code merely to be inspected, and the constructor of an
 * Application-ring value is the last place that may happen, so an accessor and a non-enumerable
 * member are both refused from the descriptor alone. A present-but-undefined member is a supplied
 * option that is not a collaborator, and is refused rather than silently read as absence.
 */
function optionalGuardAuditorOf(options, keys) {
  if (!keys.includes(OPTIONAL_OPTIONS_KEYS[0])) return null;
  const descriptor = Object.getOwnPropertyDescriptor(options, OPTIONAL_OPTIONS_KEYS[0]);
  if (!("value" in descriptor) || !descriptor.enumerable) {
    throw new TypeError("CreateCustomerPipeline auditIdentityGuard must be an own enumerable data property, never an accessor");
  }
  if (typeof descriptor.value !== "function") {
    throw new TypeError("CreateCustomerPipeline auditIdentityGuard, when present, must be a function");
  }
  return descriptor.value;
}

function checkOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("CreateCustomerPipeline needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.some((key) => !OPTIONS_KEYS.includes(key)) || REQUIRED_OPTIONS_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(OPTIONS_REFUSAL);
  }
  const auditIdentityGuard = optionalGuardAuditorOf(options, keys);
  const { identity, policyDecisionPoint, evaluateInvariants } = options;
  if (!isExactly(identity, Identity)) {
    throw new TypeError("CreateCustomerPipeline identity must be an exact Identity instance");
  }
  if (!isGenuineDecisionPoint(policyDecisionPoint)) {
    throw new TypeError("CreateCustomerPipeline policyDecisionPoint must be an exact genuine PolicyDecisionPoint or DecisionLoggingPolicyDecisionPoint instance");
  }
  if (typeof evaluateInvariants !== "function") {
    throw new TypeError("CreateCustomerPipeline evaluateInvariants must be a function");
  }
  return { identity, policyDecisionPoint, evaluateInvariants, auditIdentityGuard };
}

/** A best-effort, non-throwing raw requestId for an error envelope, even on a malformed ActionSpec. */
function rawRequestIdOf(actionSpec) {
  if (isOrdinaryObject(actionSpec) && typeof actionSpec.requestId === "string") {
    return actionSpec.requestId;
  }
  return "";
}

function invalidOutcome(requestId, code) {
  return errorOutcome("INVALID", requestId, code, false);
}

/**
 * One closed, non-leaking error envelope, for one of the three non-allow outcomes.
 *
 * `KernelError` is built and validated here as the canonical proof that `code` and `requestId`
 * are well-formed values — its own contract carries no message and no requestId, by design, so
 * the flat V2 envelope this pipeline promises (code, message, requestId, retryable) is projected
 * from it rather than returned as-is.
 */
function errorOutcome(outcome, requestId, code, retryable) {
  const kernelError = new KernelError({
    code,
    details: Object.freeze({ requestId, retryable }),
    cause: null,
  });
  const error = Object.freeze({
    code: kernelError.code,
    message: ERROR_MESSAGES[code],
    requestId,
    retryable,
  });
  return Object.freeze({ outcome, requestId, error, preparedChangeSet: null });
}

const ERROR_MESSAGES = Object.freeze({
  ACTION_SPEC_INVALID: "the ActionSpec did not satisfy its exact raw field shape",
  INVARIANT_VIOLATION: "the action violated a domain invariant",
  IDENTITY_MISMATCH: "the acting identity does not match the ActionSpec actor",
  CROSS_TENANT_DENY: "the acting identity does not match the ActionSpec tenant",
  POLICY_DENY: "the policy decision point denied this action",
});

/** Build the five value-typed fields the ActionSpec claims, or throw on the first bad one. */
function shapeCheck(actionSpec) {
  if (!isOrdinaryObject(actionSpec)) {
    throw new TypeError("ActionSpec needs an ordinary object");
  }
  const keys = Reflect.ownKeys(actionSpec);
  if (keys.length !== ACTION_SPEC_KEYS.length || ACTION_SPEC_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`ActionSpec must carry exactly these keys: ${ACTION_SPEC_KEYS.join(", ")}`);
  }
  return {
    correlationId: new CorrelationId(actionSpec.requestId),
    claimedActorId: new ActorId(actionSpec.actorId),
    claimedTenantId: new TenantId(actionSpec.tenantId),
    idempotencyKey: new IdempotencyKey(actionSpec.idempotencyKey),
    payload: actionSpec.payload,
  };
}

/** Deterministic write intents, derived only from already-validated fields — no clock, no random value. */
function preparedChangeSetOf(command) {
  const tenantId = command.principal.tenantId.toString();
  const actorId = command.principal.actorId.toString();
  const correlationId = command.correlationId.toString();
  const fingerprint = command.idempotencyKey.fingerprint;
  const intents = Object.freeze({
    customer: Object.freeze({ type: "customer.create", tenantId, payload: command.payload }),
    audit: Object.freeze({ type: "audit.append", tenantId, actorId, action: "customer.create", correlationId }),
    transactionalOutbox: Object.freeze({
      type: "outbox.enqueue", eventName: "customer.created", tenantId, correlationId,
    }),
    idempotency: Object.freeze({ type: "idempotency.record", tenantId, fingerprint, correlationId }),
  });
  return Object.freeze({ persistenceState: "pending", intents });
}

export class CreateCustomerPipeline {
  #identity;
  #policyDecisionPoint;
  #evaluateInvariants;
  #auditIdentityGuard;

  constructor(options) {
    const checked = checkOptions(options);
    this.#identity = checked.identity;
    this.#policyDecisionPoint = checked.policyDecisionPoint;
    this.#evaluateInvariants = checked.evaluateInvariants;
    this.#auditIdentityGuard = checked.auditIdentityGuard;
    Object.freeze(this);
  }

  /**
   * One identity-guard refusal, witnessed before it is handed back.
   *
   * The refusal itself is already decided and is projected unchanged; the auditor only learns that
   * it happened. It is handed one frozen ordinary object carrying exactly four already-validated
   * values — which guard refused, the *authenticated* Principal, and this request's CorrelationId
   * and IdempotencyKey — and nothing the ActionSpec claimed, so a foreign tenant or actor cannot
   * leak through this seam because it is never put into it.
   *
   * It is awaited, not merely called, and its refusal is not caught: an audit that cannot be
   * recorded must stop the request rather than let it answer an unrecorded 403, which is exactly
   * the silence this seam exists to remove.
   */
  async #refuseAtGuard(outcome, code, requestId, principal, correlationId, idempotencyKey) {
    const auditIdentityGuard = this.#auditIdentityGuard;
    if (auditIdentityGuard !== null) {
      await auditIdentityGuard(Object.freeze({ code, principal, correlationId, idempotencyKey }));
    }
    return errorOutcome(outcome, requestId, code, false);
  }

  /**
   * Run one ActionSpec through the pipeline and answer with one closed, frozen outcome.
   *
   * Stage order is fixed: actionSpecShapeCheck, identityTenantGuard, policyDecisionEvaluation,
   * invariantEvaluation, idempotencyIntentResolution, outcomeProjection,
   * preparedChangeSetProjection, errorEnvelopeProjection. A shape failure or an identity mismatch
   * short-circuits before the policy decision point or the invariant collaborator is ever
   * reached; a policy deny short-circuits before the invariant collaborator is reached.
   *
   * The tenant guard keeps its precedence over the actor guard, so a request whose tenant and
   * actor are both wrong is still the cross-tenant refusal it always was. Where an optional
   * `auditIdentityGuard` was supplied, it is awaited on a guard refusal — and only there — before
   * that refusal is projected; every other path, this pipeline's three outcomes and its four write
   * intents included, is untouched by its presence.
   */
  async run(actionSpec) {
    // actionSpecShapeCheck
    let shaped;
    try {
      shaped = shapeCheck(actionSpec);
    } catch {
      return invalidOutcome(rawRequestIdOf(actionSpec), "ACTION_SPEC_INVALID");
    }
    const { correlationId, claimedActorId, claimedTenantId, idempotencyKey, payload } = shaped;
    const requestId = correlationId.toString();

    // identityTenantGuard
    const identity = this.#identity;
    const authenticated = await identity.current();
    if (!authenticated.tenantId.equals(claimedTenantId)) {
      return await this.#refuseAtGuard("CROSS_TENANT_DENY", "CROSS_TENANT_DENY", requestId, authenticated, correlationId, idempotencyKey);
    }
    if (!authenticated.actorId.equals(claimedActorId)) {
      return await this.#refuseAtGuard("DENY", "IDENTITY_MISMATCH", requestId, authenticated, correlationId, idempotencyKey);
    }

    let command;
    try {
      command = new Command({
        name: "customer.create",
        version: 1,
        principal: authenticated,
        correlationId,
        causationId: null,
        idempotencyKey,
        payload,
      });
    } catch {
      return invalidOutcome(requestId, "ACTION_SPEC_INVALID");
    }

    // policyDecisionEvaluation
    const policyDecisionPoint = this.#policyDecisionPoint;
    const request = new PolicyRequest({
      action: command,
      resource: { type: "customer", tenantId: authenticated.tenantId.toString() },
      context: {},
    });
    const decision = await policyDecisionPoint.decide(request);
    if (decision.effect !== "allow") {
      return errorOutcome("DENY", requestId, "POLICY_DENY", false);
    }

    // invariantEvaluation
    const evaluateInvariants = this.#evaluateInvariants;
    const invariants = await evaluateInvariants(command);
    if (!invariants || invariants.ok !== true) {
      return invalidOutcome(requestId, "INVARIANT_VIOLATION");
    }

    // idempotencyIntentResolution + outcomeProjection + preparedChangeSetProjection
    const preparedChangeSet = preparedChangeSetOf(command);
    return Object.freeze({ outcome: "ALLOW_COMMIT", requestId, preparedChangeSet, error: null });
  }

  get [Symbol.toStringTag]() {
    return "CreateCustomerPipeline";
  }
}
Object.freeze(CreateCustomerPipeline.prototype);
Object.freeze(CreateCustomerPipeline);
