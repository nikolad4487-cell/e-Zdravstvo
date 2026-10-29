import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { X } from "lucide-react";
export function Modal({
  title,
  children,
  onClose,
  busy = false,
  wide = false,
  resetDirtyKey,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  wide?: boolean;
  resetDirtyKey?: string | number;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => setDirty(false), [resetDirtyKey]);
  const close = () => {
    if (
      !busy &&
      (!dirty ||
        window.confirm(
          "Imate nespremljene promjene. Zatvoriti obrazac i odbaciti ih?",
        ))
    )
      onClose();
  };
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-label={title}
      onInput={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest("form"))
          setDirty(true);
      }}
      onChange={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest("form"))
          setDirty(true);
      }}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Zatvori"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
