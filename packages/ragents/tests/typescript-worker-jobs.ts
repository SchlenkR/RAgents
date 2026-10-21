import { threadId } from "node:worker_threads";

export const threadOf = (): number => threadId;

export const blockFor = (milliseconds: number): number => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
    return threadId;
};

export const echoLater = async (value: unknown): Promise<unknown> => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return value;
};

export const fail = (message: string): never => {
    throw new TypeError(message);
};

export const notCloneable = (): unknown => () => undefined;
