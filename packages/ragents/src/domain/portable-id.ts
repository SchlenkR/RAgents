const portableIdPattern = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const windowsDeviceNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export const isPortableId = (value: unknown): value is string =>
    typeof value === "string"
    && portableIdPattern.test(value)
    && !windowsDeviceNamePattern.test(value);

export const isRunId = isPortableId;
