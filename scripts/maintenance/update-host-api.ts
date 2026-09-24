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
  console.error(`host-api.json beschreibt Host-API ${stored.version}, der Host nur ${HOST_API_VERSION}; HOST_API_VERSION sinkt nie.`);
  process.exit(1);
}
if (stored && stored.version === HOST_API_VERSION && changes.some((change) => change.removed.length > 0)) {
  console.error("Entfernte Namen brechen gebaute Bundles: HOST_API_VERSION in apps/server/src/host-api.ts erhöhen, dann erneut aufrufen.");
  process.exit(1);
}
writeFileSync(file, hostApiRecordText(current));
console.log(stored && changes.length === 0 && stored.version === current.version ? `${file} ist unverändert.` : `${file} geschrieben (Host-API ${HOST_API_VERSION}).`);
