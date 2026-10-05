import { Share2Icon } from "lucide-react";
import { getRunSharing, shareRun } from "../api";
import { SharePanel, useSharingStore } from "../panel/SharePanel";
import { openSharing, saveSharing, type SharingClient } from "../run-sharing";
import { Button } from "../ui";

/** Sharing against the server this page came from; the run panel and the browser's Start and Runs pages use it. */
export const SERVER_SHARING: SharingClient = { load: (runId) => getRunSharing(runId), save: (runId, sharing) => shareRun(runId, sharing) };
/** The run panel talks to one server. */
const THIS_SERVER = "";

/** "Share" in the run header for whoever may change whom the run is shared with; before the first message the choice waits for the run's creation. */
export function RunShareButton({ runId, title, shared }: { runId: string; title: string; shared: boolean }) {
  const [sharing, store] = useSharingStore();
  const label = shared ? "Shared - change whom the run is shared with" : "Share run";
  return <SharePanel onOpenChange={(open) => { if (open) void openSharing(THIS_SERVER, runId, SERVER_SHARING, store); else store.set(undefined); }}
    onSave={(next) => void saveSharing(THIS_SERVER, runId, next, SERVER_SHARING, store)} runTitle={title} sharing={sharing}
    trigger={<Button aria-label="Share" className="flex-none self-center" size="lg" title={label} variant="ghost">
      <Share2Icon className={shared ? "text-primary" : undefined} /><span>Share</span>
    </Button>} />;
}
