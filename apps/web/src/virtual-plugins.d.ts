declare module "virtual:ragents-plugins" {
  export const webPluginEntries: Readonly<Record<string, () => Promise<unknown>>>;
}
