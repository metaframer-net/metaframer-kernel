import { CreateCustomerPipeline } from "./create-customer-pipeline.mjs";

// =====================================================================================
// CreateCustomerCommitService
//
// A framework-neutral Application-ring service that composes one exact CreateCustomerPipeline
// instance with one injected commit port. It runs an ActionSpec through the pipeline; a
// non-ALLOW_COMMIT outcome is returned as-is with commitReceipt: null and the injected commit
// port is never called. An ALLOW_COMMIT outcome is committed exactly once through the injected
// port, and the awaited CommitReceipt is returned as outcome "COMMITTED".
//
// Framework-free and capability-free by construction: no clock, no random value, no environment
// read, no network or file access, no HTTP/ASGI/delivery concern, no Postgres adapter import —
// the commit port is injected by the caller.
// =====================================================================================

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

const OPTIONS_KEYS = ["pipeline", "commit"];

function checkOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("CreateCustomerCommitService needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.length !== OPTIONS_KEYS.length || OPTIONS_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`CreateCustomerCommitService options must carry exactly these keys: ${OPTIONS_KEYS.join(", ")}`);
  }
  const { pipeline, commit } = options;
  if (!isExactly(pipeline, CreateCustomerPipeline)) {
    throw new TypeError("CreateCustomerCommitService pipeline must be an exact CreateCustomerPipeline instance");
  }
  if (typeof commit !== "function") {
    throw new TypeError("CreateCustomerCommitService commit must be a function");
  }
  return { pipeline, commit };
}

export class CreateCustomerCommitService {
  #pipeline;
  #commit;

  constructor(options) {
    const checked = checkOptions(options);
    this.#pipeline = checked.pipeline;
    this.#commit = checked.commit;
    Object.freeze(this);
  }

  /**
   * Run one ActionSpec through the pipeline. A non-ALLOW_COMMIT outcome is returned unchanged
   * with commitReceipt: null, without calling the commit port. An ALLOW_COMMIT outcome is
   * committed exactly once, and the awaited CommitReceipt is returned as outcome "COMMITTED".
   */
  async handle(actionSpec) {
    const outcome = await this.#pipeline.run(actionSpec);

    if (outcome.outcome !== "ALLOW_COMMIT") {
      return Object.freeze({
        outcome: outcome.outcome,
        requestId: outcome.requestId,
        error: outcome.error,
        commitReceipt: null,
      });
    }

    const preparedChangeSet = outcome.preparedChangeSet;
    const commitReceipt = await this.#commit(preparedChangeSet, { tenantId: preparedChangeSet.intents.customer.tenantId });

    return Object.freeze({
      outcome: "COMMITTED",
      requestId: outcome.requestId,
      error: null,
      preparedChangeSet: null,
      commitReceipt,
    });
  }

  get [Symbol.toStringTag]() {
    return "CreateCustomerCommitService";
  }
}
Object.freeze(CreateCustomerCommitService.prototype);
Object.freeze(CreateCustomerCommitService);
