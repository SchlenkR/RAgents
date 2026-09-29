/** A configuration names env("NAME") for an environment variable the process does not have; plus what it is needed for. */
export interface MissingEnvironment {
  readonly variable: string;
  readonly section: string;
  readonly key: string;
}

/** The same error as before, except that it carries the name instead of hiding it in the sentence. */
export class MissingEnvironmentError extends Error {
  constructor(readonly missing: MissingEnvironment, message: string) {
    super(message);
  }
}

const NOTICE = "ragents:missing-environment ";

const ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const asMissingEnvironment = (value: unknown): MissingEnvironment | undefined => {
  const missing = value as Partial<MissingEnvironment> | null | undefined;
  if (!missing || typeof missing.variable !== "string" || typeof missing.section !== "string" || typeof missing.key !== "string") return undefined;
  if (!ENVIRONMENT_NAME.test(missing.variable)) return undefined;
  return { variable: missing.variable, section: missing.section, key: missing.key };
};

/** The finding on an error; its content is checked, not its class, because it also comes from another module. */
export const missingEnvironmentOf = (error: unknown): MissingEnvironment | undefined =>
  asMissingEnvironment((error as { missing?: unknown } | null | undefined)?.missing);

/** The line with which a child process passes the finding on to whoever started it; its text stays alongside. */
export const missingEnvironmentNotice = (missing: MissingEnvironment): string => NOTICE + JSON.stringify(missing);

/** The finding from an output line; anything else is none. */
export const parseMissingEnvironmentNotice = (line: string): MissingEnvironment | undefined => {
  if (!line.startsWith(NOTICE)) return undefined;
  try {
    return asMissingEnvironment(JSON.parse(line.slice(NOTICE.length)));
  } catch {
    return undefined;
  }
};

/** What a process additionally prints when it fails because of a missing environment variable. */
export const reportMissingEnvironment = (error: unknown, write: (line: string) => void): void => {
  const missing = missingEnvironmentOf(error);
  if (missing) write(missingEnvironmentNotice(missing));
};
