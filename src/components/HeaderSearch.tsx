import { useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Icon from './Icon';

/** The compact header keeps search one click away without covering the catalogue. */
export default function HeaderSearch() {
  const location = useLocation();
  const navigate = useNavigate();
  const formId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setOpen(false);
    setQuery(new URLSearchParams(location.search).get('q') ?? '');
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  function close(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  }

  return (
    <div
      className={`header-search${open ? ' header-search--open' : ''}`}
      ref={root}
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) close();
      }}
      onKeyDown={(event) => {
        if (open && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="header-search__trigger"
        aria-label="Search all titles"
        aria-expanded={open}
        aria-controls={open ? formId : undefined}
        onClick={() => setOpen(value => !value)}
      >
        <Icon name="search" />
      </button>
      {open && (
        <form
          id={formId}
          className="header-search__form"
          role="search"
          aria-label="Search all titles"
          onSubmit={(event) => {
            event.preventDefault();
            close(true);
            const q = query.trim();
            navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
          }}
        >
          <button type="submit" aria-label="Search all titles"><Icon name="search" /></button>
          <input
            ref={input}
            name="q"
            type="search"
            aria-label="Find titles"
            placeholder="Titles, genres, aliases"
            maxLength={200}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button type="button" aria-label="Close search" onClick={() => close(true)}>
            <Icon name="close" />
          </button>
        </form>
      )}
    </div>
  );
}
