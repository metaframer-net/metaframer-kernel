// CommitReceipt: frozen Application-ring value contract for a single successful commit
// outcome, fixed to the canonical eight-field contract (Actionplan contract report
// reports/gj01-v2-contract-freeze-2026-08-22.json). No ambient clock/id/random/I-O.
// Non-goals: no WriteEnvelope, no UoW wiring, no persistence/outbox adapter.

const CANONICAL_KEYS = [
  "requestId", "tenantId", "resourceId", "outcome",
  "committedAt", "auditId", "outboxEventIds", "idempotencyKey",
];
const TS_FORM = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/;
const MONTH_LENGTHS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function lengthOfMonth(year, month) {
  return month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1];
}

// Descriptor-safe admission: an exact ordinary enumerable data object holding exactly the
// canonical eight keys, checked before any value is ever read through a getter.
function exactInput(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)
    || Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError("CommitReceipt needs an ordinary options object");
  }
  const given = Reflect.ownKeys(options);
  if (given.length !== CANONICAL_KEYS.length) {
    throw new TypeError(`CommitReceipt takes exactly these fields: ${CANONICAL_KEYS.join(", ")}`);
  }
  for (const key of CANONICAL_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`CommitReceipt takes exactly these fields: ${CANONICAL_KEYS.join(", ")}`);
    }
  }
  return options;
}

function nonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`CommitReceipt ${field} needs a non-empty primitive string`);
  }
  return value;
}

function outcomeValue(value) {
  if (value !== "COMMITTED") {
    throw new TypeError('CommitReceipt outcome needs to be exactly "COMMITTED"');
  }
  return value;
}

// Arithmetic calendar validation, matching Clock/DecisionLogEntry exactly: no host Date
// parsing, because a host parser silently rolls an impossible day into the next month.
function committedAtValue(value) {
  if (typeof value !== "string") throw new TypeError("CommitReceipt committedAt needs a primitive string");
  const match = TS_FORM.exec(value);
  if (!match) throw new TypeError("CommitReceipt committedAt needs a canonical UTC millisecond ISO instant");
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);
  if (year < 1) throw new RangeError("CommitReceipt committedAt year 0000 is below the floor");
  if (month < 1 || month > 12) throw new RangeError("CommitReceipt committedAt month must be 01 to 12");
  if (day < 1 || day > lengthOfMonth(year, month)) throw new RangeError("CommitReceipt committedAt day must name a real calendar day");
  if (hour > 23 || minute > 59 || second > 59) throw new RangeError("CommitReceipt committedAt time of day must be a real time");
  return value;
}

function outboxEventIdsValue(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length === 0) {
    throw new TypeError("CommitReceipt outboxEventIds needs a non-empty ordinary array");
  }
  if (Reflect.ownKeys(value).length !== value.length + 1) {
    throw new TypeError("CommitReceipt outboxEventIds must be dense, with no extra own keys");
  }
  const out = []; const seen = new Set();
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, i);
    if (d === undefined || !("value" in d) || !d.enumerable) {
      throw new TypeError("CommitReceipt outboxEventIds elements must be enumerable data properties");
    }
    if (typeof d.value !== "string" || d.value.trim().length === 0) {
      throw new TypeError("CommitReceipt outboxEventIds elements must be non-empty primitive strings");
    }
    if (seen.has(d.value)) throw new TypeError("CommitReceipt outboxEventIds must be unique");
    seen.add(d.value); out.push(d.value);
  }
  return Object.freeze(out);
}

export class CommitReceipt {
  #requestId; #tenantId; #resourceId; #outcome;
  #committedAt; #auditId; #outboxEventIds; #idempotencyKey;

  constructor(options) {
    exactInput(options);
    this.#requestId = nonEmptyString(options.requestId, "requestId");
    this.#tenantId = nonEmptyString(options.tenantId, "tenantId");
    this.#resourceId = nonEmptyString(options.resourceId, "resourceId");
    this.#outcome = outcomeValue(options.outcome);
    this.#committedAt = committedAtValue(options.committedAt);
    this.#auditId = nonEmptyString(options.auditId, "auditId");
    this.#outboxEventIds = outboxEventIdsValue(options.outboxEventIds);
    this.#idempotencyKey = nonEmptyString(options.idempotencyKey, "idempotencyKey");
    Object.freeze(this);
  }

  get requestId() { return this.#requestId; }

  get tenantId() { return this.#tenantId; }

  get resourceId() { return this.#resourceId; }

  get outcome() { return this.#outcome; }

  get committedAt() { return this.#committedAt; }

  get auditId() { return this.#auditId; }

  get outboxEventIds() { return this.#outboxEventIds; }

  get idempotencyKey() { return this.#idempotencyKey; }

  toJSON() {
    return {
      requestId: this.#requestId,
      tenantId: this.#tenantId,
      resourceId: this.#resourceId,
      outcome: this.#outcome,
      committedAt: this.#committedAt,
      auditId: this.#auditId,
      outboxEventIds: this.#outboxEventIds,
      idempotencyKey: this.#idempotencyKey,
    };
  }

  get [Symbol.toStringTag]() {
    return "CommitReceipt";
  }
}
Object.freeze(CommitReceipt.prototype);
Object.freeze(CommitReceipt);
