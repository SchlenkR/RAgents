export type Draft<Value> = Value extends ReadonlyMap<infer Key, infer Item>
    ? Map<Key, Draft<Item>>
    : Value extends readonly [infer First, ...infer Rest]
        ? [Draft<First>, ...{ [Index in keyof Rest]: Draft<Rest[Index]> }]
        : Value extends readonly (infer Item)[]
            ? Draft<Item>[]
            : Value extends (...args: never[]) => unknown
                ? Value
                : Value extends object
                    ? { -readonly [Key in keyof Value]: Draft<Value[Key]> }
                    : Value;
