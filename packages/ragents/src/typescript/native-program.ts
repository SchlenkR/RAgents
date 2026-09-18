export type NativeTypeScriptProgram = {
    entry: string;
    files: { fileName: string; text: string }[];
    exportName?: string;
};
