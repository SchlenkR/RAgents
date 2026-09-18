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
