import { serviceToken } from "@aicontainer/ragents";

export interface DocumentStoreDescription {
  directoryPattern: string;
}

export interface DocumentStore {
  directoryFor: (runId: string) => Promise<string>;
  describe: () => DocumentStoreDescription;
}

export const documentStoreToken = serviceToken<DocumentStore>("ragents.document-store");
