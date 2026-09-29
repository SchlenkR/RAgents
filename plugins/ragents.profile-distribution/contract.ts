import { Type, type Static } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";

const pluginEntry = Type.Object({
  id: Type.String({ minLength: 1 }),
  source: Type.Union([Type.Literal("host"), Type.Literal("archive")], {
    description: "host: the client takes the built-in bundle of its host; archive: the bundle is in the archive",
  }),
}, { additionalProperties: false });

const description = Type.Object({
  profile: Type.String({ minLength: 1, description: "Profile name; the file is called ragents.config.<profile>.ts" }),
  version: Type.String({ minLength: 64, maxLength: 64, description: "Version of the archive as SHA-256" }),
  hostApi: Type.Integer({ minimum: 1, description: "Number of the host API the bundles in the archive are built against; the client's host must offer exactly this one" }),
  hostVersion: Type.String({ minLength: 40, maxLength: 40, description: "Git commit of this server's host; a checkout with a different host API uses it to get a matching one" }),
  packageVersion: Type.String({ minLength: 1, description: "Version of the npm package that carries this commit; an installation with a different host API uses it to get a matching one" }),
  file: Type.String({ minLength: 1, description: "Path of the profile file inside the archive" }),
  size: Type.Integer({ minimum: 0, description: "Archive size in bytes" }),
  archivePath: Type.String({ minLength: 1, description: "HTTP path of the archive on this server" }),
  plugins: Type.Array(pluginEntry),
}, { additionalProperties: false });

export type ClientProfileDescription = Static<typeof description>;

export const profileArchivePath = (version: string): string => `/profile/${version}.tar.gz`;

export const profileDistributionContracts = {
  describe: defineOperation({
    id: "ragents.profile.describe",
    description: "The client profile of this server: name, version, required host API, host and package version, plugins and archive. Right: profile.fetch.",
    rights: ["profile.fetch"],
    input: Type.Object({}, { additionalProperties: false }),
    result: description,
  }),
};
