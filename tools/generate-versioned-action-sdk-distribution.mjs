// P08 — versioned action SDK distribution. Wraps the P07 SDK renderer with a caller-supplied
// distribution version, producing a coordinate-addressed, integrity-checked file set.

import { createHash } from "node:crypto";
import { renderActionSdk } from "./generate-action-sdk.mjs";

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

export function renderVersionedActionSdkDistribution(contract, distributionVersion) {
  const moduleSource = renderActionSdk(contract);
  if (!isNonEmptyString(distributionVersion)) {
    throw new TypeError("renderVersionedActionSdkDistribution requires a non-empty distributionVersion string");
  }

  const coordinate = `${contract.name}@${contract.version}`;
  const manifestPath = "manifest.json";
  const modulePath = `actions/${contract.name}/v${contract.version}.mjs`;
  const action = Object.freeze({ kind: contract.kind, name: contract.name, version: contract.version });

  const digestInput = JSON.stringify({
    schemaVersion: 1,
    distributionVersion,
    coordinate,
    action: { kind: contract.kind, name: contract.name, version: contract.version },
    modulePath,
    moduleSource,
  });
  const integrity = `sha256:${createHash("sha256").update(digestInput, "utf8").digest("hex")}`;

  const manifest = {
    schemaVersion: 1,
    format: "esm",
    distributionVersion,
    coordinate,
    action,
    modulePath,
    integrity,
  };
  const manifestText = `${JSON.stringify(manifest)}\n`;

  const files = Object.freeze({
    [manifestPath]: manifestText,
    [modulePath]: moduleSource,
  });

  return Object.freeze({
    coordinate,
    distributionVersion,
    manifestPath,
    modulePath,
    files,
  });
}
