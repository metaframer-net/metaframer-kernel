// P16 — customer surface UI projection over the P15 typed customer-module-api.
// Presentation-only: wraps an already-built, ready P15 customerModuleApi handle in a frozen
// {manifest,project,submit,retry} projection. Excludes host/DOM/DB/relay/deps/cache/readiness.

const SUBMIT_KEYS = Object.freeze(["actionSpec", "record", "insertOptions"]);
const REQUIRED_ACTION_COORDINATE = "customer.create@1";
const REJECTED_ALERT_CODE = "CUSTOMER_SURFACE_SUBMIT_REJECTED";

export const CUSTOMER_SURFACE_MANIFEST = Object.freeze({
  surfaceSlug: "customer-surface",
  states: Object.freeze(["idle", "submitting", "saved", "rejected"]),
});

function isOrdinaryObject(value) {
  return value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}

function isReadyCustomerModuleApi(customerModuleApi) {
  return (
    isOrdinaryObject(customerModuleApi) &&
    Object.isFrozen(customerModuleApi) &&
    customerModuleApi.status === "ready" &&
    isOrdinaryObject(customerModuleApi.manifest) &&
    Object.isFrozen(customerModuleApi.manifest) &&
    customerModuleApi.manifest.actionCoordinate === REQUIRED_ACTION_COORDINATE &&
    typeof customerModuleApi.recordCustomer === "function"
  );
}

function idleProjection() {
  return Object.freeze({ state: "idle", submitEnabled: true, retryVisible: false });
}

function submittingProjection() {
  return Object.freeze({ state: "submitting", submitEnabled: false, retryVisible: false });
}

function savedProjection(result) {
  return Object.freeze({
    state: "saved",
    submitEnabled: false,
    retryVisible: false,
    record: result.record,
  });
}

function rejectedProjection() {
  return Object.freeze({
    state: "rejected",
    submitEnabled: false,
    retryVisible: true,
    alertCode: REJECTED_ALERT_CODE,
  });
}

export function createCustomerSurface({ customerModuleApi } = {}) {
  if (!isReadyCustomerModuleApi(customerModuleApi)) {
    throw new TypeError("createCustomerSurface requires a ready P15 customerModuleApi handle");
  }

  let projection = idleProjection();
  let pending = false;
  let lastArgs = null;

  async function runSubmit(args) {
    pending = true;
    projection = submittingProjection();
    try {
      const result = await customerModuleApi.recordCustomer(args);
      lastArgs = args;
      projection = savedProjection(result);
      return projection;
    } catch {
      lastArgs = args;
      projection = rejectedProjection();
      return projection;
    } finally {
      pending = false;
    }
  }

  async function submit(args) {
    if (pending) {
      throw new Error("customer surface submit refused: a submit is already in flight");
    }
    if (!isOrdinaryObject(args)) {
      throw new TypeError("submit requires an ordinary options object");
    }
    const keys = Reflect.ownKeys(args);
    if (keys.length !== SUBMIT_KEYS.length || !SUBMIT_KEYS.every((key) => keys.includes(key))) {
      throw new TypeError("submit requires exactly {actionSpec, record, insertOptions}");
    }
    return runSubmit(args);
  }

  async function retry() {
    if (pending) {
      throw new Error("customer surface retry refused: a submit is already in flight");
    }
    if (projection.state !== "rejected" || lastArgs === null) {
      throw new Error("customer surface retry refused: no rejected submit to retry");
    }
    return runSubmit(lastArgs);
  }

  function project() {
    return projection;
  }

  return Object.freeze({
    manifest: CUSTOMER_SURFACE_MANIFEST,
    project,
    submit,
    retry,
  });
}
