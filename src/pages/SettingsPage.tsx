import { Link } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import { useAppState } from '../state';
import Avatar from '../account/Avatar';
import AppearanceSettings from '../components/AppearanceSettings';
import MyAnimeListConnection from '../components/MyAnimeListConnection';
import '../styles/settings.css';

export default function SettingsPage() {
  const account = useAccount();
  const { preferences } = useAppState();
  const [prefs, setPrefs] = preferences;
  return <div className="settings-page">
    <header className="settings-heading"><h1>Settings</h1><p>Playback and appearance for {account.profile?.name}.</p></header>
    {account.profile && <Link className="settings-profile-card" to="/profiles?returnTo=%2Fsettings" aria-label={`Switch profile. Current profile: ${account.profile.name}`}>
      <Avatar profile={account.profile} />
      <span className="settings-profile-card__copy"><small>Current profile</small><strong>{account.profile.name}</strong></span>
      <span className="settings-profile-card__action" aria-hidden="true">Switch</span>
    </Link>}
    <nav className="settings-navigation" aria-label="Settings sections">
      <a href="#playback">Playback</a><a href="#appearance">Appearance</a><a href="#connections">MyAnimeList</a><Link to="/account">Account & privacy</Link><Link to="/profiles?returnTo=%2Fsettings">Profiles</Link>
    </nav>
    <section id="playback" className="settings-section" aria-labelledby="playback-heading">
      <h2 id="playback-heading">Playback</h2>
      <div className="preference-list">
        <label><span><strong>Preferred version</strong><small>Used when available.</small></span>
          <select value={prefs.preferredLanguage} onChange={event => setPrefs({ ...prefs, preferredLanguage: event.target.value })}>
            <option value="sub">Subtitled</option><option value="dub">Dubbed</option><option value="raw">Original, without subtitles</option>
          </select></label>
        <label><span><strong>Remember progress</strong><small>Resume where you left off.</small></span>
          <input type="checkbox" checked={prefs.rememberProgress} onChange={event => setPrefs({ ...prefs, rememberProgress: event.target.checked })} /></label>
        <label><span><strong>Autoplay next</strong><small>When the player reports completion.</small></span>
          <input type="checkbox" checked={prefs.autoplayNext} onChange={event => setPrefs({ ...prefs, autoplayNext: event.target.checked })} /></label>
      </div>
      <p className="field-hint settings-playback-note">Availability varies by source.</p>
    </section>
    <section id="appearance" className="settings-section" aria-labelledby="settings-appearance"><h2 id="settings-appearance">Appearance</h2><AppearanceSettings /></section>
    <MyAnimeListConnection />
    <section className="settings-section settings-account-link" aria-labelledby="settings-account"><h2 id="settings-account">Account & privacy</h2>
      <p>Manage your password, recovery code, signed-in devices, data export, and sign out.</p>
      <Link className="button button--outline" to="/account">Manage account</Link>
    </section>
  </div>;
}
