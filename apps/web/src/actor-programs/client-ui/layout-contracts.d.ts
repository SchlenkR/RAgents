import type { ReactElement, ReactNode } from "react";

export type LayoutGap = "small" | "normal" | "large";

export interface AppLayoutProps {
  title?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Fill a height-constrained parent; only the content scrolls, header and actions stay visible. */
  fill?: boolean;
}

export interface StackProps {
  children: ReactNode;
  gap?: LayoutGap;
  /** Rows wrap automatically when their children no longer fit. */
  direction?: "column" | "row";
}

export interface GridProps {
  children: ReactNode;
  /** Maximum columns; the available container width reduces them to two or one. */
  columns?: 2 | 3;
  gap?: LayoutGap;
}

/** App frame with group spacing (3 units), content rhythm and optional header and actions; no extra root padding. */
export declare function AppLayout(props: AppLayoutProps): ReactElement;
/** Vertical content or a wrapping row; defaults to related spacing (2 units), normal is 3 and large is 4. */
export declare function Stack(props: StackProps): ReactElement;
/** Equal responsive columns based on the container width; defaults to group spacing (3 units). */
export declare function Grid(props: GridProps): ReactElement;
