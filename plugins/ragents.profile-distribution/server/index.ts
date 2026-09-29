import { DomainError, implement, type HttpRouteContribution, type RAgentsPlugin } from "@ragents/engine";
import { readHostApiVersion, readHostVersion, readPackageVersion } from "@ragents/host/host-version.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { writeJson } from "@ragents/host/plugin-support/http.js";
import { profileArchivePath, profileDistributionContracts, type ClientProfileDescription } from "../contract.js";
import { inspectClientProfile, packClientProfile } from "./archive.js";
import { profileDistributionConfig, profileDistributionConfigDescriptors } from "./config.js";

interface DistributionState {
  readonly description: ClientProfileDescription;
  readonly archive: Buffer;
}

const archivePattern = /^\/profile\/([0-9a-f]{64})\.tar\.gz$/;

const archiveRoute = (state: () => DistributionState): HttpRouteContribution => ({
  id: "ragents.profile-distribution.archive",
  isApiPath: (pathname) => pathname.startsWith("/profile/"),
  matches: (request, url) => request.method === "GET" && archivePattern.test(url.pathname),
  requiredRights: ["profile.fetch"],
  handle: ({ response, url }) => {
    const current = state();
    const version = archivePattern.exec(url.pathname)?.[1];
    if (version !== current.description.version) {
      writeJson(response, 404, { error: `Version ${version} is no longer offered; the current one is ${current.description.version}` });
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/gzip",
      "Content-Length": current.archive.byteLength,
      "Cache-Control": "no-store",
    });
    response.end(current.archive);
  },
});

const profileDistributionPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.profile-distribution" },
  register: (host) => {
    host.config(...profileDistributionConfigDescriptors);
    const file = profileDistributionConfig.clientProfileFile();
    if (!file) {
      host.lifecycle({
        id: "ragents.profile-distribution",
        initialize: () => console.log("Profile distribution: CLIENT_PROFILE_FILE is not set, this server offers no client profile"),
      });
      return;
    }
    let ready: DistributionState | undefined;
    const state = (): DistributionState => {
      if (!ready) throw new DomainError("profile-not-ready", "The client profile is not packed yet.", 503);
      return ready;
    };
    host.lifecycle({
      id: "ragents.profile-distribution",
      initialize: async () => {
        const hostVersion = profileDistributionConfig.hostVersion() ?? readHostVersion();
        const packageVersion = readPackageVersion();
        const hostApi = readHostApiVersion();
        const inspected = await inspectClientProfile(file);
        const packed = await packClientProfile(inspected);
        ready = {
          archive: packed.archive,
          description: {
            profile: inspected.profile,
            version: packed.version,
            hostApi,
            hostVersion,
            packageVersion,
            file: inspected.file,
            size: packed.archive.byteLength,
            archivePath: profileArchivePath(packed.version),
            plugins: inspected.plugins.map((plugin) => ({ id: plugin.id, source: plugin.source })),
          },
        };
        console.log(`Profile distribution: ${inspected.profile} version ${packed.version.slice(0, 12)} (${packed.entries.length} files, ${packed.archive.byteLength} bytes, host API ${hostApi}, host ${hostVersion.slice(0, 12)}, package ${packageVersion})`);
      },
    });
    host.methods(implement(profileDistributionContracts.describe, () => state().description));
    host.http(archiveRoute(state));
  },
};

export const plugin: PluginModule = {
  create: () => profileDistributionPlugin,
};
