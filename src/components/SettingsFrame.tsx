import { useEffect, type PropsWithChildren, type ComponentProps } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from './Icon';

type Destination = { key: string; label: string; to: string; icon: ComponentProps<typeof Icon>['name'] };
const groups: { label: string; links: Destination[] }[] = [
  { label: 'Your profile', links: [
    { key: 'playback', label: 'Playback', to: '/settings?section=playback', icon: 'play' },
    { key: 'appearance', label: 'Appearance', to: '/settings?section=appearance', icon: 'palette' },
    { key: 'profiles', label: 'Profiles', to: '/profiles?returnTo=%2Fsettings', icon: 'person' },
    { key: 'connections', label: 'Connected apps', to: '/settings?section=connections', icon: 'browse' },
  ] },
  { label: 'Your account', links: [
    { key: 'account', label: 'Account', to: '/account', icon: 'person' },
    { key: 'security', label: 'Security', to: '/account#security', icon: 'shield' },
    { key: 'devices', label: 'Devices', to: '/account#devices', icon: 'tv' },
    { key: 'privacy', label: 'Privacy & data', to: '/account#privacy', icon: 'info' },
  ] },
];

export function SettingsLinks({ active, mobile = false }: { active?: string; mobile?: boolean }) {
  return <nav className={mobile ? 'settings-index-menu' : 'settings-navigation settings-sidebar'} aria-label="Settings sections">
    {groups.map(group => <div className="settings-nav-group" key={group.label}>
      <h2>{group.label}</h2>
      <ul>{group.links.map(link => <li key={link.key}>
        <Link to={link.to} aria-current={active === link.key ? 'page' : undefined}>
          <Icon name={link.icon} /><span>{link.label}</span><Icon name="right" />
        </Link>
      </li>)}</ul>
    </div>)}
  </nav>;
}

export default function SettingsFrame({ active, children }: PropsWithChildren<{ active: string }>) {
  const location = useLocation();
  useEffect(() => {
    if (location.pathname === '/settings') {
      const frame = requestAnimationFrame(() => {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      });
      return () => cancelAnimationFrame(frame);
    }
    // Account sections remain addressable from Settings and browser history.
    if (!['#security', '#devices', '#privacy'].includes(location.hash)) return;
    const frame = requestAnimationFrame(() => {
      const section = document.getElementById(location.hash.slice(1));
      if (section instanceof HTMLDetailsElement) section.open = true;
      section?.scrollIntoView?.({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [location.pathname, location.hash, location.search]);
  return <div className="settings-layout">
    <SettingsLinks active={active} />
    <div className="settings-main">{children}</div>
  </div>;
}

export function SettingsBack() {
  return <Link className="settings-back" to="/settings"><Icon name="left" />Settings</Link>;
}
