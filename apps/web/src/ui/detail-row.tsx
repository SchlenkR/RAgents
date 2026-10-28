import type { ReactNode } from "react";

export function DetailRow({ label, explanation, children }: { label: string; explanation?: ReactNode; children: ReactNode }) {
  return <dl className="grid min-w-0 grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)] items-start gap-x-4 border-b border-border-soft py-3 text-base [overflow-wrap:anywhere] has-[>dd>div:empty]:hidden" data-slot="detail-row">
    <dt className="min-w-0 text-muted-foreground">{label}</dt>
    <dd className="min-w-0">
      <div className="min-w-0 whitespace-normal" data-slot="detail-value">{children}</div>
      {explanation && <p className="mt-1 text-sm text-muted-foreground">{explanation}</p>}
    </dd>
  </dl>;
}
