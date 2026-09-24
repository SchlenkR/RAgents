/** Ein fachlicher Fehler einer Operation mit Kennung und Status; der Aufrufer macht daraus seinen eigenen Fehlertyp. */
export class WorkspaceOperationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "WorkspaceOperationError";
    this.code = code;
    this.status = status;
  }
}
