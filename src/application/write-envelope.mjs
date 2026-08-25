// WriteEnvelope: runs one write through a UnitOfWork, answers with a CommitReceipt.
// P05b. Non-goals: no UnitOfWork/CommitReceipt changes, no adapters, no wiring.

import { UnitOfWork } from "./unit-of-work.mjs";
import { CommitReceipt } from "./commit-receipt.mjs";

const INPUT_KEYS = ["unitOfWork", "write"];

function exactInput(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options)
    || Object.getPrototypeOf(options) !== Object.prototype) {
    throw new TypeError("WriteEnvelope needs an ordinary options object");
  }
  const given = Reflect.ownKeys(options);
  if (given.length !== INPUT_KEYS.length) {
    throw new TypeError(`WriteEnvelope takes exactly these fields: ${INPUT_KEYS.join(", ")}`);
  }
  for (const key of INPUT_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(options, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`WriteEnvelope takes exactly these fields: ${INPUT_KEYS.join(", ")}`);
    }
  }
  return options;
}

function exactUnitOfWork(value) {
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== UnitOfWork.prototype) {
    throw new TypeError("WriteEnvelope needs an exact UnitOfWork instance");
  }
  return value;
}

function declaredFunction(value) {
  if (typeof value !== "function") {
    throw new TypeError("WriteEnvelope needs a function write");
  }
  return value;
}

export class WriteEnvelope {
  #unitOfWork;
  #write;

  constructor(options) {
    exactInput(options);
    this.#unitOfWork = exactUnitOfWork(options.unitOfWork);
    this.#write = declaredFunction(options.write);
    Object.freeze(this);
  }

  async commit(preparedChangeSet) {
    const unitOfWork = this.#unitOfWork;
    const write = this.#write;
    return unitOfWork.run(async (scope) => {
      const result = await write(scope, preparedChangeSet);
      if (result === null || typeof result !== "object" || Object.getPrototypeOf(result) !== CommitReceipt.prototype) {
        throw new TypeError("WriteEnvelope write must resolve to an exact CommitReceipt");
      }
      return result;
    });
  }
}
Object.freeze(WriteEnvelope.prototype);
Object.freeze(WriteEnvelope);
