import { useEffect, useRef, type PropsWithChildren } from 'react';
import Icon from './Icon';
export default function Dialog({
  title,
  onClose,
  children,
  className = '',
}: PropsWithChildren<{ title: string; onClose: () => void; className?: string }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const callback = useRef(onClose);
  callback.current = onClose;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus({ preventScroll: true });
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
