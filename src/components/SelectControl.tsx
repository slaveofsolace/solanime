import { forwardRef, type SelectHTMLAttributes } from 'react';

export interface SelectControlProps extends SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string;
}

/** Keep the platform picker and native form behavior behind a shared field treatment. */
const SelectControl = forwardRef<HTMLSelectElement, SelectControlProps>(function SelectControl(
  { children, className, wrapperClassName, ...props },
  ref,
) {
  return (
    <span className={['select-control', wrapperClassName].filter(Boolean).join(' ')}>
      <select
        {...props}
        ref={ref}
        className={['select-control__input', className].filter(Boolean).join(' ')}
      >
        {children}
      </select>
      {!props.multiple && (props.size ?? 1) <= 1 && (
        <svg
          className="select-control__chevron"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      )}
    </span>
  );
});

export default SelectControl;
