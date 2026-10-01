import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import { useAppState } from '../state';
import Avatar from '../account/Avatar';
import AppearanceSettings from '../components/AppearanceSettings';
import MyAnimeListConnection from '../components/MyAnimeListConnection';
import SelectControl from '../components/SelectControl';
import SettingsFrame, { SettingsBack, SettingsLinks } from '../components/SettingsFrame';

const sections = { playback: 'Playback', appearance: 'Appearance', connections: 'Connected apps' } as const;
type Section = keyof typeof sections;

export default function SettingsPage() {
  const account = useAccount();
  const { preferences } = useAppState();
  const [prefs, setPrefs] = preferences;
  const [params] = useSearchParams();
  const { hash } = useLocation();
  // Preserve bookmarked section links and the MyAnimeList return destination.
  const requested = params.get('section') ?? hash.slice(1);
  const section: Section = Object.hasOwn(sections, requested) ? requested as Section : 'playback';
  const isIndex = !Object.hasOwn(sections, requested);
  return <SettingsFrame active={section}>
  <div className={`settings-page${isIndex ? ' settings-page--index' : ''}`}>
    {isIndex && <div className="settings-index">
    <header className="settings-heading"><h1>Settings</h1></header>
    {account.profile && <Link className="settings-profile-card" to="/profiles?returnTo=%2Fsettings" aria-label={`Switch profile. Current profile: ${account.profile.name}`}>
      <Avatar profile={account.profile} />
      <span className="settings-profile-card__copy"><small>Current profile</small><strong>{account.profile.name}</strong></span>
      <span className="settings-profile-card__action" aria-hidden="true">Switch</span>
    </Link>}
    <SettingsLinks mobile />
    </div>}
    <div className="settings-detail">
    <SettingsBack />
    <header className="settings-heading"><h1>{sections[section]}</h1>
      {account.profile && <p className="settings-profile-context"><Avatar profile={account.profile} small /><span>{account.profile.name}</span></p>}
    </header>
    {section === 'playback' && <section id="playback" className="settings-section" aria-label="Playback preferences">
      <div className="preference-list">
        <label className="settings-row"><span className="settings-row__copy"><strong>Preferred version</strong></span>
          <SelectControl className="settings-control" value={prefs.preferredLanguage} onChange={event => setPrefs(current => ({ ...current, preferredLanguage: event.target.value }))}>
            <option value="sub">Subtitled</option><option value="dub">Dubbed</option><option value="raw">No subtitles</option>
          </SelectControl></label>
        <label className="settings-row"><span className="settings-row__copy"><strong>Remember progress</strong></span>
          <input className="settings-toggle" type="checkbox" checked={prefs.rememberProgress} onChange={event => setPrefs(current => ({ ...current, rememberProgress: event.target.checked }))} /></label>
        <label className="settings-row"><span className="settings-row__copy"><strong>Autoplay next episode</strong></span>
          <input className="settings-toggle" type="checkbox" aria-label="Autoplay next episode" checked={prefs.autoplayNext} onChange={event => setPrefs(current => ({ ...current, autoplayNext: event.target.checked }))} /></label>
      </div>
    </section>}
    {section === 'appearance' && <section id="appearance" className="settings-section" aria-label="Appearance preferences"><AppearanceSettings /></section>}
    {section === 'connections' && <MyAnimeListConnection />}
    </div>
  </div>
  </SettingsFrame>;
}
