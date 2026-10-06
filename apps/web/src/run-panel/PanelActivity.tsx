import { Activity, memo, type PropsWithChildren } from "react";

const RetainedContent = memo(function RetainedContent({ children }: PropsWithChildren<{ active: boolean }>) {
  return children;
}, (previous, next) => !previous.active && !next.active || previous.active === next.active && previous.children === next.children);

export function PanelActivity({ active, children }: PropsWithChildren<{ active: boolean }>) {
  return <Activity mode={active ? "visible" : "hidden"}>
    <RetainedContent active={active}>{children}</RetainedContent>
  </Activity>;
}
