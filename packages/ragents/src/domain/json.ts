export type JsonValue =
    | null
    | string
    | number
    | boolean
    | JsonValue[]
    | { [key: string]: JsonValue | undefined };

export type JsonObject = { [key: string]: JsonValue | undefined };

export type JsonPath = (string | number)[];
export type JsonChange =
    | { op: "set"; path: JsonPath; value: JsonValue }
    | { op: "remove"; path: JsonPath };

const fail: (path: string, message: string) => never = (path, message) => {
    throw new TypeError(`${path} ${message}.`);
};

const validate = (value: unknown, path: string, ancestors: WeakSet<object>): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean")
        return;

    if (typeof value === "number") {
        if (!Number.isFinite(value) || Object.is(value, -0))
            fail(path, "must be a finite JSON number");

        return;
    }

    if (typeof value !== "object")
        fail(path, "must be a JSON value");

    if (ancestors.has(value))
        fail(path, "must not contain a cycle");

    ancestors.add(value);

    try {
        if (Array.isArray(value)) {
            if (Object.getPrototypeOf(value) !== Array.prototype)
                fail(path, "must be a plain JSON array");

            const keys = Reflect.ownKeys(value);

            if (keys.length !== value.length + 1 || !keys.includes("length"))
                fail(path, "must not contain holes or named properties");

            for (let index = 0; index < value.length; index++) {
                const key = String(index);
                const descriptor = Object.getOwnPropertyDescriptor(value, key);

                if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
                    fail(`${path}[${index}]`, "must be an own JSON value");

                validate(descriptor.value, `${path}[${index}]`, ancestors);
            }

            return;
        }

        const prototype = Object.getPrototypeOf(value);

        if (prototype !== Object.prototype && prototype !== null)
            fail(path, "must be a plain JSON object");

        for (const key of Reflect.ownKeys(value)) {
            if (typeof key !== "string")
                fail(path, "must not contain symbol properties");

            const descriptor = Object.getOwnPropertyDescriptor(value, key);

            if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
                fail(`${path}.${key}`, "must be an enumerable JSON value");

            if (descriptor.value === undefined)
                continue;

            validate(descriptor.value, `${path}.${key}`, ancestors);
        }
    } finally {
        ancestors.delete(value);
    }
};

export const assertJsonValue: (value: unknown, path?: string) => asserts value is JsonValue = (value, path = "value") => {
    validate(value, path, new WeakSet<object>());
};
