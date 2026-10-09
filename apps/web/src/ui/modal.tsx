import type { PropsWithChildren, RefObject } from "react";
import { Dialog, DialogContent, type DialogSize, type ModalScope } from "./dialog";

export interface ModalProps extends PropsWithChildren {
  onClose: () => void;
  open?: boolean;
  scope?: ModalScope;
  size?: DialogSize;
  className?: string;
  overlayClassName?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  showCloseButton?: boolean;
  keepMounted?: boolean;
}

/** A dialog frame in its scope; the X, Escape and the backdrop request closing through onClose. */
export function Modal({ children, className, initialFocus, keepMounted, onClose, open = true, overlayClassName, scope = "run", showCloseButton = false, size = "medium" }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }} modal={scope === "page" ? true : "trap-focus"} disablePointerDismissal={scope !== "page"}>
      <DialogContent className={className} initialFocus={initialFocus ?? true} keepMounted={keepMounted} onBackdropClick={onClose} open={open}
        overlayClassName={overlayClassName} scope={scope} showCloseButton={showCloseButton} size={size}>
        {children}
      </DialogContent>
    </Dialog>
  );
}
