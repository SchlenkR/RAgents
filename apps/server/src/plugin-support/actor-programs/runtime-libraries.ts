/** Diese Bibliotheken verlinkt der Actor-Arbeitsbereich zur Laufzeit; sie werden nicht importiert, sondern über ihren Namen aufgelöst. */
export const webRuntimeLibraries = ["react", "react-dom", "@types/react", "@types/react-dom", "@base-ui/react", "class-variance-authority", "cn", "lucide-react"] as const;

export const runtimeLibraries = [...webRuntimeLibraries, "@types/node", "typescript", "tsx", "typebox", "esbuild"] as const;
