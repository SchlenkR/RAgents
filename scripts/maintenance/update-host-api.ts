import { existsSync, writeFileSync } from "node:fs";
import { HOST_API_VERSION } from "../../apps/server/src/host-api.ts";
import {
  describeHostApiChange,
  hostApiChanges,
  hostApiNames,
  hostApiRecordFile,
  hostApiRecordText,
  readHostApiRecord,
} from "../../apps/server/src/plugin-build/host-api-names.ts";

const file = hostApiRecordFile();
const current = await hostApiNames();
const stored = existsSync(file) ? readHostApiRecord() : undefined;
const changes = stored ? hostApiChanges(stored, current) : [];
for (const change of changes) console.log(describeHostApiChange(change));
if (stored && stored.version > HOST_API_VERSION) {
  console.error(`host-api.json describes host API ${stored.version}, the host only ${HOST_API_VERSION}; HOST_API_VERSION never decreases.`);
  process.exit(1);
}
if (stored && stored.version === HOST_API_VERSION && changes.some((change) => change.removed.length > 0)) {
  console.error("Removed names break built bundles: raise HOST_API_VERSION in apps/server/src/host-api.ts, then run again.");
  process.exit(1);
}
writeFileSync(file, hostApiRecordText(current));
console.log(stored && changes.length === 0 && stored.version === current.version ? `${file} is unchanged.` : `${file} written (host API ${HOST_API_VERSION}).`);
