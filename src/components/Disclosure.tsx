import { useId, type PropsWithChildren, type ReactNode } from 'react';
import Icon from './Icon';

type DisclosureProps = PropsWithChildren<{
  title: string;
  expanded: boolean;
  onToggle: () => void;
  disabled?: boolean;
  accessory?: ReactNode;
  className?: string;
}>;

/** The trigger and expanded content share one surface and one inset. */
export default function Disclosure({ title, expanded, onToggle, disabled,
  accessory, className = '', children,
}: DisclosureProps) {
  const id = useId();
  return <div className={`disclosure ${className}`} data-open={expanded || undefined}>
    <button id={`${id}-trigger`} type="button" className="disclosure-trigger"
      aria-expanded={expanded} aria-controls={expanded ? `${id}-content` : undefined}
      disabled={disabled} onClick={onToggle}>
      <span>{title}</span>
      <span className="disclosure-accessory" aria-hidden="true">{accessory}<Icon name="right" /></span>
    </button>
    {expanded && <div id={`${id}-content`} className="disclosure-content"
      role="region" aria-labelledby={`${id}-trigger`}>{children}</div>}
  </div>;
}
