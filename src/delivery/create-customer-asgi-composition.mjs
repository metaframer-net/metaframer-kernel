import { createCustomerComposition } from "./create-customer-composition.mjs";
import { CreateCustomerHttpMessageAdapter } from "./create-customer-http-message-adapter.mjs";
import { StandardRouter } from "./standard-router.mjs";
import { AsgiCoreProfileAdapter } from "./asgi-core-profile.mjs";

// =====================================================================================
// createCustomerAsgiComposition
//
// The smallest framework-neutral composition root that wires a real createCustomerComposition
// handler to a real CreateCustomerHttpMessageAdapter, a real StandardRouter (exactly one route:
// POST /customers) and a real AsgiCoreProfileAdapter. It constructs all four from exactly the
// same caller-supplied collaborators createCustomerComposition already accepts, and hands back
// exactly one frozen { asgi, router, close } object — never the handler, the http message
// adapter, or the underlying PostgresCommitAdapter.
//
// Framework-free and capability-free by construction: no HTTP/ASGI server import, no FastAPI, no
// Django, no Uvicorn, no Hypercorn, no fetch, no fs/net/http import, no clock, no random value,
// no environment read, no network listener. This is a composition root, not a server.
// =====================================================================================

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const OPTIONS_KEYS = ["connectionString", "current", "candidatesFor", "evaluateInvariants"];

function checkOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("createCustomerAsgiComposition needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.length !== OPTIONS_KEYS.length || OPTIONS_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`createCustomerAsgiComposition options must carry exactly these keys: ${OPTIONS_KEYS.join(", ")}`);
  }
  const { connectionString, current, candidatesFor, evaluateInvariants } = options;
  if (typeof connectionString !== "string" || !connectionString) {
    throw new TypeError("createCustomerAsgiComposition connectionString must be a non-empty string");
  }
  if (typeof current !== "function") {
    throw new TypeError("createCustomerAsgiComposition current must be a function");
  }
  if (typeof candidatesFor !== "function") {
    throw new TypeError("createCustomerAsgiComposition candidatesFor must be a function");
  }
  if (typeof evaluateInvariants !== "function") {
    throw new TypeError("createCustomerAsgiComposition evaluateInvariants must be a function");
  }
  return { connectionString, current, candidatesFor, evaluateInvariants };
}

/**
 * Wire one real createCustomerComposition handler to a real CreateCustomerHttpMessageAdapter, a
 * real StandardRouter (exactly one route: POST /customers) and a real AsgiCoreProfileAdapter,
 * from exactly the four caller-supplied collaborators. Returns a frozen `{ asgi, router, close }`
 * object; `close` closes the composed PostgresCommitAdapter.
 */
export function createCustomerAsgiComposition(options) {
  const checked = checkOptions(options);

  const base = createCustomerComposition(checked);
  const httpMessageAdapter = new CreateCustomerHttpMessageAdapter({ handler: base.handler });
  const router = new StandardRouter({
    routes: [{ method: "POST", path: "/customers", handler: httpMessageAdapter }],
  });
  const asgi = new AsgiCoreProfileAdapter({ router });

  return Object.freeze({
    asgi,
    router,
    close: base.close,
  });
}
Object.freeze(createCustomerAsgiComposition);
