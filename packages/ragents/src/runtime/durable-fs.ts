import { closeSync, fsyncSync, openSync } from "node:fs";

export const errorCode = (error: unknown) => (error instanceof Error && "code" in error ? error.code : null);

export const syncDirectory = (path: string) => {
    if (process.platform === "win32") return;
    const descriptor = openSync(path, "r");

    try {
        fsyncSync(descriptor);
    } finally {
        closeSync(descriptor);
    }
};
