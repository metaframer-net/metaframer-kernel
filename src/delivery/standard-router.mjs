// =====================================================================================
// StandardRouter
//
// A framework-neutral Delivery-ring route table: it dispatches a plain HTTP-like message
// (an ordinary object with string method and string path) to exactly one registered plain
// handler, selected by an exact method+path match. It performs no body/header parsing, no
// CreateCustomer-specific behaviour, and no HTTP server or network work of any kind.
//
// This is the stable route-selection surface a future HTTP host adapter can call into; it does
// not itself select, import or couple to any such host. No framework or server runtime import
// of any kind appears in this module.
// =====================================================================================

const isOrdinaryObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;

const hasHandleFunction = (value) =>
  value !== null && typeof value === "object" && typeof value.handle === "function";

const OPTIONS_KEYS = ["routes"];
const ROUTE_KEYS = ["method", "path", "handler"];

function checkRouteRecord(route, index) {
  if (!isOrdinaryObject(route)) {
    throw new TypeError(`StandardRouter routes[${index}] must be an ordinary route record`);
  }
  const keys = Reflect.ownKeys(route);
  if (keys.length !== ROUTE_KEYS.length || ROUTE_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`StandardRouter routes[${index}] must carry exactly these keys: ${ROUTE_KEYS.join(", ")}`);
  }
  const { method, path, handler } = route;
  if (!isNonEmptyString(method)) {
    throw new TypeError(`StandardRouter routes[${index}].method must be a non-empty string`);
  }
  if (!isNonEmptyString(path)) {
    throw new TypeError(`StandardRouter routes[${index}].path must be a non-empty string`);
  }
  if (!hasHandleFunction(handler)) {
    throw new TypeError(`StandardRouter routes[${index}].handler must be an ordinary object with a handle function`);
  }
  return Object.freeze({ method, path, handler });
}

function checkOptions(options) {
  if (!isOrdinaryObject(options)) {
    throw new TypeError("StandardRouter needs exactly one ordinary options object");
  }
  const keys = Reflect.ownKeys(options);
  if (keys.length !== OPTIONS_KEYS.length || OPTIONS_KEYS.some((key) => !keys.includes(key))) {
    throw new TypeError(`StandardRouter options must carry exactly these keys: ${OPTIONS_KEYS.join(", ")}`);
  }
  const { routes } = options;
  if (!Array.isArray(routes) || routes.length === 0) {
    throw new TypeError("StandardRouter routes must be a non-empty array of route records");
  }
  const checkedRoutes = routes.map(checkRouteRecord);
  const seen = new Set();
  for (const { method, path } of checkedRoutes) {
    const key = `${method} ${path}`;
    if (seen.has(key)) {
      throw new TypeError(`StandardRouter refuses a duplicate method+path pair: ${key}`);
    }
    seen.add(key);
  }
  return Object.freeze(checkedRoutes);
}

function errorResponse(status, code) {
  return Object.freeze({
    status,
    headers: Object.freeze({ "content-type": "application/json" }),
    body: Object.freeze({
      error: Object.freeze({ code, retryable: false }),
    }),
  });
}

const messageShapeInvalidResponse = () => errorResponse(400, "MESSAGE_SHAPE_INVALID");
const pathNotFoundResponse = () => errorResponse(404, "ROUTE_NOT_FOUND");
const methodNotSupportedResponse = () => errorResponse(405, "METHOD_NOT_SUPPORTED");

export class StandardRouter {
  #routes;

  constructor(options) {
    this.#routes = checkOptions(options);
    Object.freeze(this);
  }

  async handle(message) {
    if (!isOrdinaryObject(message) || typeof message.method !== "string" || typeof message.path !== "string") {
      return messageShapeInvalidResponse();
    }

    const { method, path } = message;
    const routesForPath = this.#routes.filter((route) => route.path === path);

    if (routesForPath.length === 0) {
      return pathNotFoundResponse();
    }

    const route = routesForPath.find((candidate) => candidate.method === method);
    if (!route) {
      return methodNotSupportedResponse();
    }

    const response = await route.handler.handle(message);
    if (!isOrdinaryObject(response)) {
      throw new TypeError("StandardRouter route handler must return an ordinary response object");
    }
    return response;
  }

  get [Symbol.toStringTag]() {
    return "StandardRouter";
  }
}
Object.freeze(StandardRouter.prototype);
Object.freeze(StandardRouter);
