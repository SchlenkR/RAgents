import { Alert, AlertDescription, AlertTitle } from "./ui";
import type { PluginFailure } from "./plugin-bootstrap";

/** Names every plugin whose web half did not load; the rest of the interface keeps working. */
export function PluginFailureNotice({ failures }: { failures: readonly PluginFailure[] }) {
  if (failures.length === 0) return null;
  return (
    <Alert className="flex-none rounded-none border-x-0 border-t-0" data-slot="plugin-failures" variant="destructive">
      <AlertTitle>{failures.length === 1 ? `The plugin ${failures[0]!.id} failed to load` : `${failures.length} plugins failed to load`}</AlertTitle>
      <AlertDescription>
        {failures.map((failure) => <p key={failure.id}>{failure.message}</p>)}
      </AlertDescription>
    </Alert>
  );
}
