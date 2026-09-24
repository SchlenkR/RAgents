import { closeSync, fsyncSync, openSync } from "node:fs";

export const errorCode = (error: unknown) => (error instanceof Error && "code" in error ? error.code : null);

export const syncDirectory = (path: string) => {
    const descriptor = openSync(path, "r");

    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
};
