import { serviceToken, type CommandContext, type ServiceToken } from "@ragents/engine";

export interface SurfacePlacementRequest {
  entity: string;
  direction?: "horizontal" | "vertical";
  weight?: number;
}

/** Places an entity next to a run's surface layout, as canvas_layout_place does; an entity the layout shows already stays. */
export interface SurfacePlacement {
  place: (context: CommandContext, runId: string, request: SurfacePlacementRequest) => { placed: boolean };
}

export const surfacePlacementToken: ServiceToken<SurfacePlacement> = serviceToken("ragents.orchestration.surface-placement");
