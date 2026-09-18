import { isRecord } from "./guards";

export const errorFrom = async (response: Response, fallback: string): Promise<Error> => {
  try {
    const body = await response.json() as unknown;
    if (isRecord(body) && typeof body.error === "string" && body.error.trim()) return new Error(body.error);
  } catch {}
  return new Error(fallback);
};
