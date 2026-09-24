export type GitConfigPairs = ReadonlyArray<readonly [string, string]>;

export const withGitConfigPairs = (env: NodeJS.ProcessEnv, pairs: GitConfigPairs): NodeJS.ProcessEnv => ({
  ...env,
  GIT_CONFIG_COUNT: String(pairs.length),
  ...Object.fromEntries(pairs.flatMap(([key, value], index) => [
    [`GIT_CONFIG_KEY_${index}`, key],
    [`GIT_CONFIG_VALUE_${index}`, value],
  ])),
});
