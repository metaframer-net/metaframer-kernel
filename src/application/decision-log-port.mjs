import { DecisionLogEntry } from "./decision-log-entry.mjs";

// =====================================================================================
// DecisionLogPort
//
// A pure one-function forwarding seam over an append-only collaborator: `append(entry)` and
// nothing else. No read, update, delete, latest, replay or query method exists, so nothing
// beside "add one more entry" is reachable through this seam. Non-goals: no persisted-row
// verifier, no DB/RLS/WORM, no PDP/batch wiring, no retry/queue/cache.
// =====================================================================================

const isExactly = (value, type) =>
  value !== null && typeof value === "object" && Object.getPrototypeOf(value) === type.prototype;

// A hollow instance built on the exact prototype (Object.create(DecisionLogEntry.prototype))
// passes isExactly but carries no private field, so the entryHash getter is captured once and
// used as a brand check: it throws for anything but a genuine DecisionLogEntry.
const ENTRY_HASH_BRAND = Object.getOwnPropertyDescriptor(DecisionLogEntry.prototype, "entryHash").get;
const isGenuineEntry = (value) => {
  if (!isExactly(value, DecisionLogEntry)) return false;
  try {
    ENTRY_HASH_BRAND.call(value);
    return true;
  } catch {
    return false;
  }
};

const DECISION_LOG_PORT_OPTIONS = ["append"];

function exactOptions(options, expected, what) {
  if (options === null || typeof options !== "object" || Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError(`${what} needs an ordinary options object`);
  }
  const given = Reflect.ownKeys(options);
  if (given.length !== expected.length) {
    throw new TypeError(`${what} takes exactly these options: ${expected.join(", ")}`);
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${what} takes exactly these options: ${expected.join(", ")}`);
    }
  }
  return options;
}

function appendValue(value) {
  if (typeof value !== "function") {
    throw new TypeError("DecisionLogPort append needs a function collaborator");
  }
  return value;
}

export class DecisionLogPort {
  #append;

  constructor(options) {
    exactOptions(options, DECISION_LOG_PORT_OPTIONS, "DecisionLogPort");
    this.#append = appendValue(options.append);
    Object.freeze(this);
  }

  // Declared async so every path — the refusal below included — is a rejected Promise rather
  // than ever a synchronous throw, exactly as Clock#now and Identity#current are. The
  // collaborator is lifted out of its field before being called, so it runs as a plain
  // function with an undefined receiver; its resolved or rejected value is awaited and handed
  // on completely unchanged.
  async append(entry) {
    if (!isGenuineEntry(entry)) {
      throw new TypeError("DecisionLogPort append needs an exact genuine DecisionLogEntry instance");
    }
    const collaborator = this.#append;
    return await collaborator(entry);
  }

  get [Symbol.toStringTag]() {
    return "DecisionLogPort";
  }
}
Object.freeze(DecisionLogPort.prototype);
Object.freeze(DecisionLogPort);
