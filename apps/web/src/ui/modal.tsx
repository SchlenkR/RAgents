import { useMemo, useRef, useState, useSyncExternalStore, type PropsWithChildren, type RefObject } from "react";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "./button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, type DialogSize, type ModalScope } from "./dialog";
import { createModalController, ModalControllerContext, type ModalNextBehavior } from "./modal-controller";

export interface ModalProps extends PropsWithChildren {
  onClose: () => void;
  open?: boolean;
  scope?: ModalScope;
  size?: DialogSize;
  className?: string;
  overlayClassName?: string;
  initialFocus?: RefObject<HTMLElement | null>;
  nextBehavior?: ModalNextBehavior;
  showCloseButton?: boolean;
  keepMounted?: boolean;
}

/** A dialog frame whose contents can push further steps; Zurück, Escape and the backdrop return to the previous step first. */
export function Modal({ children, className, initialFocus, keepMounted, nextBehavior = "push", onClose, open = true, overlayClassName, scope = "run", showCloseButton = false, size = "medium" }: ModalProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const behaviorRef = useRef(nextBehavior);
  behaviorRef.current = nextBehavior;
  const [controller] = useState(() => createModalController({
    nextBehavior: () => behaviorRef.current,
    onClose: () => onCloseRef.current(),
  }));
  const history = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const current = history[history.length - 1];
  const navigation = useMemo(() => ({ canGoBack: history.length > 1, open: controller.open, back: controller.back, close: controller.close }), [controller, history]);
  const dismiss = () => controller.canGoBack ? controller.back() : controller.close();
  const wasOpen = useRef(open);
  if (wasOpen.current && !open) controller.reset();
  wasOpen.current = open;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) dismiss(); }} modal={scope === "page" ? true : "trap-focus"} disablePointerDismissal={scope !== "page"}>
      <DialogContent className={className} initialFocus={current.page?.initialFocusRef ?? initialFocus ?? true} keepMounted={keepMounted} onBackdropClick={dismiss} open={open}
        overlayClassName={overlayClassName} scope={scope} showCloseButton={showCloseButton || current.page !== null} size={size}>
        <ModalControllerContext.Provider value={navigation}>
          {history.map((entry) => (
            <div className={cn("contents", entry.key !== current.key && "hidden")} hidden={entry.key !== current.key} inert={entry.key !== current.key} key={entry.key}>
              {entry.page ? <>
                <DialogHeader className="flex-row items-start gap-3 px-4 pt-4 pb-3">
                  <Button aria-label="Zurück" onClick={controller.back} size="icon-sm" variant="ghost"><ArrowLeftIcon /></Button>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <DialogTitle>{entry.page.title}</DialogTitle>
                    {entry.page.subtitle && <DialogDescription>{entry.page.subtitle}</DialogDescription>}
                  </div>
                </DialogHeader>
                <DialogBody>{entry.page.render(navigation)}</DialogBody>
              </> : children}
            </div>
          ))}
        </ModalControllerContext.Provider>
      </DialogContent>
    </Dialog>
  );
}
