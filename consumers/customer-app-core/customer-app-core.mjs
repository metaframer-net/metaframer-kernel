// P10 — app-owned Customer app-core public-SDK consumer boundary.
// Zero static Kernel imports: receives the P08-generated public SDK module as a plain object.
// P14a — createCustomerAppCoreWithPersistence composes the real P13 cutover controller behind
// an explicit opt-in export, reusing the same fail-closed validation as createCustomerAppCore.

import { createCustomerDataCutover } from "./customer-data-cutover.mjs";

export const CUSTOMER_APP_CORE_MANIFEST = Object.freeze({
  appSlug: "customer",
  moduleSlug: "customer-core",
  requiredCapabilities: Object.freeze(["customer:core"]),
  eventNamespace: "customer.*",
  defaultDeny: true,
  modules: Object.freeze(["core"]),
});

const REQUIRED_SDK_STRING_FIELDS = Object.freeze(["ACTION_KIND", "ACTION_NAME"]);
const REQUIRED_SDK_ARRAY_FIELDS = Object.freeze(["ACTION_FIELDS", "OUTCOMES", "ERROR_ENVELOPE_FIELDS"]);
const REQUIRED_SDK_FUNCTION_FIELDS = Object.freeze(["buildActionSpec", "isOutcome", "isErrorEnvelope"]);

function isValidPublicSdkContract(sdk) {
  if (!sdk || typeof sdk !== "object") return false;
  if (typeof sdk.ACTION_VERSION !== "number") return false;
  if (!REQUIRED_SDK_STRING_FIELDS.every((key) => typeof sdk[key] === "string")) return false;
  if (!REQUIRED_SDK_ARRAY_FIELDS.every((key) => Array.isArray(sdk[key]) && Object.isFrozen(sdk[key]))) return false;
  if (!REQUIRED_SDK_FUNCTION_FIELDS.every((key) => typeof sdk[key] === "function")) return false;
  return true;
}

export function createCustomerAppCore({ sdk, coordinate, grantedCapabilities } = {}) {
  if (!isValidPublicSdkContract(sdk)) {
    throw new Error("createCustomerAppCore requires a valid public generated SDK contract");
  }

  const expectedCoordinate = `${sdk.ACTION_NAME}@${sdk.ACTION_VERSION}`;
  if (coordinate !== expectedCoordinate) {
    throw new Error("createCustomerAppCore requires the exact SDK-derived coordinate");
  }

  if (!Array.isArray(grantedCapabilities) || !grantedCapabilities.includes("customer:core")) {
    throw new Error("createCustomerAppCore requires the exact customer:core capability grant");
  }

  return Object.freeze({
    sdkCoordinate: coordinate,
    status: "ready",
  });
}

export function createCustomerAppCoreWithPersistence({ sdk, coordinate, grantedCapabilities, cutoverOptions } = {}) {
  const appCore = createCustomerAppCore({ sdk, coordinate, grantedCapabilities });
  const persistence = createCustomerDataCutover(cutoverOptions);

  return Object.freeze({
    sdkCoordinate: appCore.sdkCoordinate,
    status: appCore.status,
    persistence,
  });
}
