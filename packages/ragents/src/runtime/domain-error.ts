export class DomainError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status = 409) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
