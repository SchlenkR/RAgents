import { AppWindowIcon } from "lucide-react";
import type { WebPlugin } from "@ragents/web/PluginRegistry";
import { GlobalAppsPage } from "./GlobalAppsPage";

export const webPlugin: WebPlugin = {
  id: "ragents.global-apps",
  pages: [{
    id: "ragents.global-apps",
    order: 200,
    title: "Apps",
    Icon: AppWindowIcon,
    readRight: "ragents.global-apps.read",
    Page: GlobalAppsPage,
  }],
};
