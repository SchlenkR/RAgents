export const greet = (name: string): string => `Hallo aus VS Code, ${name}!`;

export const shout = (name: string): string => greet(name).toUpperCase();
