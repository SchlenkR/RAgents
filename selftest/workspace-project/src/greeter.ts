export const greet = (name: string): string => `Hello from VS Code, ${name}!`;

export const shout = (name: string): string => greet(name).toUpperCase();
