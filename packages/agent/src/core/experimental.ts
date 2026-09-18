export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.AGENT_EXPERIMENTAL === "1";
}
