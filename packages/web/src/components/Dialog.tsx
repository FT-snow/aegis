import { useEffect, useRef } from "react";
import type { MouseEvent, ReactNode } from "react";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  className?: string;
  alert?: boolean;
  describedBy?: string;
}

export function Dialog({
  open,
  onClose,
  labelledBy,
  children,
  className = "",
  alert = false,
  describedBy,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function closeOnBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget) onClose();
  }

  return (
    <dialog
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-modal="true"
      className={className}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={closeOnBackdrop}
      ref={dialogRef}
      role={alert ? "alertdialog" : "dialog"}
    >
      {children}
    </dialog>
  );
}
