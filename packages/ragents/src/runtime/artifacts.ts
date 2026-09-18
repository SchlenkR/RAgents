import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { errorCode, syncDirectory } from "./durable-fs.ts";

export type StoredArtifactContent = {
    hash: string;
    size: number;
};

export interface ArtifactContents {
    put(content: Uint8Array): StoredArtifactContent;
    read(hash: string): Uint8Array;
}

const hashOf = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

export class MemoryArtifactContents implements ArtifactContents {
    readonly #contents = new Map<string, Uint8Array>();

    put(content: Uint8Array) {
        const hash = hashOf(content);
        this.#contents.set(hash, Uint8Array.from(content));

        return { hash, size: content.byteLength };
    }

    read(hash: string) {
        const content = this.#contents.get(hash);

        if (!content)
            throw new Error(`Artifact content ${hash} does not exist.`);

        return Uint8Array.from(content);
    }
}

export class DirectoryArtifactContents implements ArtifactContents {
    readonly #directory: string;

    constructor(directory: string) {
        this.#directory = directory;
        mkdirSync(directory, { recursive: true });
    }

    put(content: Uint8Array) {
        const hash = hashOf(content);
        const path = join(this.#directory, hash);
        const temporaryPath = join(this.#directory, `.artifact.${randomUUID()}.tmp`);
        let descriptor: number | null = openSync(temporaryPath, "wx", 0o600);

        try {
            writeFileSync(descriptor, content);
            fsyncSync(descriptor);
            closeSync(descriptor);
            descriptor = null;

            try {
                linkSync(temporaryPath, path);
                syncDirectory(this.#directory);
            } catch (error) {
                if (errorCode(error) !== "EEXIST")
                    throw error;

                const existing = readFileSync(path);

                if (hashOf(existing) !== hash || !existing.equals(Buffer.from(content)))
                    throw new Error(`Artifact content ${hash} already exists with different bytes.`);
            }
        } finally {
            if (descriptor !== null)
                closeSync(descriptor);

            if (existsSync(temporaryPath)) {
                unlinkSync(temporaryPath);
                syncDirectory(this.#directory);
            }
        }

        return { hash, size: content.byteLength };
    }

    read(hash: string) {
        if (!/^[a-f0-9]{64}$/.test(hash))
            throw new Error("Invalid artifact hash.");

        const content = readFileSync(join(this.#directory, hash));

        if (hashOf(content) !== hash)
            throw new Error(`Artifact content ${hash} failed its integrity check.`);

        return content;
    }
}
