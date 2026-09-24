import { Type, type Static } from "typebox";
import { defineOperation } from "@ragents/engine/src/rpc/contract";

const pluginEntry = Type.Object({
  id: Type.String({ minLength: 1 }),
  source: Type.Union([Type.Literal("host"), Type.Literal("archive")], {
    description: "host: der Client nimmt das eingebaute Bundle seines Hosts; archive: das Bundle liegt im Archiv",
  }),
}, { additionalProperties: false });

const description = Type.Object({
  profile: Type.String({ minLength: 1, description: "Profilname; die Datei heißt ragents.config.<profil>.ts" }),
  version: Type.String({ minLength: 64, maxLength: 64, description: "Stand des Archivs als SHA-256" }),
  hostApi: Type.Integer({ minimum: 1, description: "Nummer der Host-API, gegen die die Bundles im Archiv gebaut sind; der Host des Clients muss genau diese bieten" }),
  hostVersion: Type.String({ minLength: 40, maxLength: 40, description: "Git-Commit des Hosts dieses Servers; ein Checkout mit anderer Host-API kommt damit zu einer passenden" }),
  packageVersion: Type.String({ minLength: 1, description: "Fassung des npm-Pakets, die diesen Commit trägt; eine Installation mit anderer Host-API kommt damit zu einer passenden" }),
  file: Type.String({ minLength: 1, description: "Pfad der Profildatei innerhalb des Archivs" }),
  size: Type.Integer({ minimum: 0, description: "Archivgröße in Byte" }),
  archivePath: Type.String({ minLength: 1, description: "HTTP-Pfad des Archivs auf diesem Server" }),
  plugins: Type.Array(pluginEntry),
}, { additionalProperties: false });

export type ClientProfileDescription = Static<typeof description>;

export const profileArchivePath = (version: string): string => `/profile/${version}.tar.gz`;

export const profileDistributionContracts = {
  describe: defineOperation({
    id: "ragents.profile.describe",
    description: "Das Client-Profil dieses Servers: Name, Stand, verlangte Host-API, Host- und Paketfassung, Plugins und Archiv. Recht: profile.fetch.",
    rights: ["profile.fetch"],
    input: Type.Object({}, { additionalProperties: false }),
    result: description,
  }),
};
