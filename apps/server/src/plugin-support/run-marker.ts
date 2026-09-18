export const RUN_MARKER_ENV = "RAGENTS_RUN_ID";

const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const runMarkerOf = (value: string | undefined): string | undefined =>
  value !== undefined && RUN_ID.test(value) ? value : undefined;
