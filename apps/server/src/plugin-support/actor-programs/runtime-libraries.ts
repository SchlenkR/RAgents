/** The actor workspace links these libraries at runtime; they are not imported but resolved by their name. */
export const webRuntimeLibraries = ["react", "react-dom", "@types/react", "@types/react-dom", "@base-ui/react", "class-variance-authority", "cn", "lucide-react"] as const;

export const runtimeLibraries = [...webRuntimeLibraries, "@types/node", "typescript", "tsx", "typebox", "esbuild"] as const;
