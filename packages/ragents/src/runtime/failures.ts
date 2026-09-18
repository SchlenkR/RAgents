const failureLeaves = (failure: unknown): unknown[] => failure instanceof AggregateError && failure.errors.length > 0
    ? failure.errors.flatMap(failureLeaves)
    : [failure];

export const throwFailures = (failures: readonly unknown[], message: string): void => {
    const unique = [...new Set(failures.flatMap(failureLeaves))];

    if (unique.length === 1)
        throw unique[0];

    if (unique.length > 1)
        throw new AggregateError(unique, message);
};

export const throwRejected = (results: readonly PromiseSettledResult<unknown>[], message: string): void =>
    throwFailures(results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason), message);
