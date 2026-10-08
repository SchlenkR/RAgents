export const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background";

export const selectionTint = "selected:bg-selected selected:text-selected-foreground selected:not-focus-visible:[box-shadow:none] selected:hover:bg-selected-hover selected:hover:text-selected-foreground";

export const selectionStyle = `selected:border selected:border-selected-border ${selectionTint}`;

export const iconOnlyStyle = "icon-only:border-0 icon-only:focus-visible:bg-hover icon-only:focus-visible:text-hover-foreground icon-only:selected:border-0 icon-only:selected:bg-selected-icon icon-only:selected:text-primary icon-only:selected:hover:bg-selected-icon-hover icon-only:selected:hover:text-primary icon-only:selected:focus-visible:bg-selected-icon-hover icon-only:selected:focus-visible:text-primary";

const interactionBase = `${focusRing} hover:bg-hover hover:text-hover-foreground open:bg-hover open:text-hover-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50`;

export const interactionStyle = `${interactionBase} ${selectionStyle}`;

export const filledHover = "hover:bg-[color-mix(in_srgb,var(--secondary),var(--foreground)_8%)] open:bg-[color-mix(in_srgb,var(--secondary),var(--foreground)_8%)]";

export const outlinedControl = "border-border-strong bg-background dark:bg-input/30";


export const menuItemStyle = `border border-transparent ${interactionBase} focus-visible:ring-0 focus-visible:ring-offset-0 focus:bg-hover focus:text-hover-foreground data-highlighted:bg-hover data-highlighted:text-hover-foreground selected:font-medium`;
