/** Eine Konfiguration nennt env("NAME") für eine Umgebungsvariable, die der Prozess nicht hat; dazu, wofür sie gebraucht wird. */
export interface MissingEnvironment {
  readonly variable: string;
  readonly section: string;
  readonly key: string;
}

/** Derselbe Fehler wie bisher, nur trägt er den Namen mit, statt ihn im Satz zu verstecken. */
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

/** Der Befund an einem Fehler; geprüft wird sein Inhalt, nicht seine Klasse, denn er kommt auch aus einem anderen Modul. */
export const missingEnvironmentOf = (error: unknown): MissingEnvironment | undefined =>
  asMissingEnvironment((error as { missing?: unknown } | null | undefined)?.missing);

/** Die Zeile, mit der ein Kindprozess den Befund an den weitergibt, der ihn gestartet hat; sein Text bleibt daneben stehen. */
export const missingEnvironmentNotice = (missing: MissingEnvironment): string => NOTICE + JSON.stringify(missing);

/** Der Befund aus einer Ausgabezeile; alles andere ist keiner. */
export const parseMissingEnvironmentNotice = (line: string): MissingEnvironment | undefined => {
  if (!line.startsWith(NOTICE)) return undefined;
  try {
    return asMissingEnvironment(JSON.parse(line.slice(NOTICE.length)));
  } catch {
    return undefined;
  }
};

/** Was ein Prozess zusätzlich ausgibt, wenn er an einer fehlenden Umgebungsvariablen scheitert. */
export const reportMissingEnvironment = (error: unknown, write: (line: string) => void): void => {
  const missing = missingEnvironmentOf(error);
  if (missing) write(missingEnvironmentNotice(missing));
};
