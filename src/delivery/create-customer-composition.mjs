import { Identity } from "../application/identity.mjs";
import { PolicyDecisionPoint } from "../application/policy-decision-point.mjs";
import { CreateCustomerPipeline } from "../application/create-customer-pipeline.mjs";
import { CreateCustomerCommitService } from "../application/create-customer-commit-service.mjs";
import { UnitOfWork } from "../application/unit-of-work.mjs";
import { WriteEnvelope } from "../application/write-envelope.mjs";
import { createPostgresUnitOfWork } from "../adapters/postgres-unit-of-work.mjs";
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
