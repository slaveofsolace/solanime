import { useEffect, useRef, type PropsWithChildren } from 'react';
import Icon from './Icon';

let pendingReturnFocus: HTMLElement | null = null;
export function markDialogTrigger(element: HTMLElement) {
  pendingReturnFocus = element;
}

export default function Dialog({
  title,
  onClose,
  children,
  className = '',
}: PropsWithChildren<{ title: string; onClose: () => void; className?: string }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const callback = useRef(onClose);
  callback.current = onClose;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const previousFocus = returnFocus.current ?? (
      pendingReturnFocus?.isConnected === true
        ? pendingReturnFocus
        : (document.activeElement as HTMLElement | null));
    returnFocus.current = previousFocus;
    pendingReturnFocus = null;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      window.setTimeout(() => {
        // WebKit may move focus after close(); restore after its native close work. The
        // open check also avoids stealing focus during React StrictMode's effect replay.
        if (element.open) return;
        if (previousFocus?.isConnected) {
          // Card actions collapse while the dialog owns focus. Focus the visible
          // card link first so :focus-within exposes the original control again.
          if (!previousFocus.getClientRects().length || getComputedStyle(previousFocus).visibility === 'hidden')
            previousFocus.closest('.title-card')?.querySelector<HTMLElement>('a')?.focus({ preventScroll: true });
          previousFocus.focus({ preventScroll: true });
        }
        else {
          // The opening control can disappear when the fifth profile replaces Add profile.
          const fallback =
            document.querySelector<HTMLElement>('[data-dialog-fallback-focus]') ??
            document.querySelector<HTMLElement>('main');
          fallback?.focus();
        }
      }, 0);
    };
  }, []);
  return (
    <dialog
      className={`app-dialog ${className}`}
      aria-label={title}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        callback.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          const box = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            callback.current();
        }
      }}
    >
      <div className="dialog-topline">
        <h2>{title}</h2>
        <button
          className="icon-button"
          type="button"
          aria-label="Close dialog"
          onClick={() => callback.current()}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
