export class SerialQueue {
    #tail = Promise.resolve();

    run<Result>(work: () => Result | Promise<Result>) {
        const result = this.#tail.then(work);
        this.#tail = result.then(
            () => undefined,
            () => undefined,
        );

        return result;
    }
}

/** One queue per key: work under one key runs in arrival order, keys never wait for each other. */
export class KeyedSerialQueue {
    readonly #tails = new Map<string, Promise<void>>();

    run<Result>(key: string, work: () => Result | Promise<Result>) {
        const result = (this.#tails.get(key) ?? Promise.resolve()).then(work);
        const tail = result.then(
            () => undefined,
            () => undefined,
        );
        this.#tails.set(key, tail);
        void tail.then(() => {
            if (this.#tails.get(key) === tail)
                this.#tails.delete(key);
        });

        return result;
    }

    get size() {
        return this.#tails.size;
    }
}
