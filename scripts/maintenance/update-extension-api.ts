import { existsSync, writeFileSync } from "node:fs";
import { EXTENSION_API_VERSION } from "../../apps/server/src/extension-api.ts";
import { hostRoot } from "../../apps/server/src/host-version.ts";
import {
  describeExtensionApiChange,
  extensionApiChanges,
  extensionApiRecord,
  extensionApiRecordFile,
  extensionApiRecordText,
  readExtensionApiRecord,
} from "../vscode/extension-api-record.ts";

const root = hostRoot();
const file = extensionApiRecordFile(root);
const current = extensionApiRecord(root);
const stored = existsSync(file) ? readExtensionApiRecord(root) : undefined;
const changes = stored ? extensionApiChanges(stored, current) : [];
for (const change of changes) console.log(describeExtensionApiChange(change));
if (stored && stored.version > EXTENSION_API_VERSION) {
  console.error(`extension-api.json describes extension interface ${stored.version}, the server only ${EXTENSION_API_VERSION}; EXTENSION_API_VERSION never decreases.`);
  process.exit(1);
}
writeFileSync(file, extensionApiRecordText(current));
console.log(stored && changes.length === 0 && stored.version === current.version ? `${file} is unchanged.` : `${file} written (extension interface ${EXTENSION_API_VERSION}).`);
