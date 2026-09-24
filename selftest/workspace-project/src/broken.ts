import { greet } from "./greeter.ts";

export const broken = (): string => greet(42);
