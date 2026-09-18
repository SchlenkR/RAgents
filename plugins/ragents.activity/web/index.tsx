import { ActivityHeader } from "./ActivityHeader";
import type { WebPlugin } from "@aicontainer/web/PluginRegistry";

export const webPlugin: WebPlugin = {
  id: "ragents.activity",
  needsRunView: true,
  sessionHeaders: [{
    readRight: "runs.inspect",
    id: "ragents.activity.live",
    order: 100,
    Header: ActivityHeader,
  }],
};
