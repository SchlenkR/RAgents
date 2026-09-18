import { webPluginEntries } from "virtual:ragents-plugins";
import { webPluginLoadersFrom, type WebPluginLoaders } from "./plugin-bootstrap";

/** The only place that knows the bundle: Vite generates the entries from the profile, the pure core does the rest. */
export const webPluginLoaders: WebPluginLoaders = webPluginLoadersFrom(webPluginEntries);
