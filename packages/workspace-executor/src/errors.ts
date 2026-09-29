/** A domain error of an operation with code and status; the caller turns it into its own error type. */
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
