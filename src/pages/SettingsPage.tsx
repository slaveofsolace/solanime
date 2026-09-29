import { Link } from 'react-router-dom';
import { useAccount } from '../account/AccountProvider';
import { useAppState } from '../state';
import AppearanceSettings from '../components/AppearanceSettings';
import MyAnimeListConnection from '../components/MyAnimeListConnection';
import '../styles/settings.css';

export default function SettingsPage() {
  const account = useAccount();
  const { preferences } = useAppState();
  const [prefs, setPrefs] = preferences;
  return <div className="settings-page">
    <header className="settings-heading"><h1>Settings</h1><p>Preferences for {account.profile?.name}.</p></header>
    <nav className="settings-navigation" aria-label="Settings sections">
      <a href="#playback">Playback</a><a href="#appearance">Appearance</a><a href="#connections">MyAnimeList</a><Link to="/account">Account & privacy</Link><Link to="/profiles?returnTo=%2Fsettings">Profiles</Link>
    </nav>
    <section id="playback" className="settings-section" aria-labelledby="playback-heading">
      <h2 id="playback-heading">Playback</h2>
      <div className="preference-list">
        <label><span><strong>Preferred version</strong><small>Used when the episode has that version.</small></span>
          <select value={prefs.preferredLanguage} onChange={event => setPrefs({ ...prefs, preferredLanguage: event.target.value })}>
            <option value="sub">Subtitled</option><option value="dub">Dubbed</option><option value="raw">Original, without subtitles</option>
          </select></label>
        <label><span><strong>Remember progress</strong><small>For players that report viewing progress.</small></span>
          <input type="checkbox" checked={prefs.rememberProgress} onChange={event => setPrefs({ ...prefs, rememberProgress: event.target.checked })} /></label>
        <label><span><strong>Autoplay next</strong><small>Open the next episode when the player reports completion.</small></span>
          <input type="checkbox" checked={prefs.autoplayNext} onChange={event => setPrefs({ ...prefs, autoplayNext: event.target.checked })} /></label>
      </div>
      <p className="field-hint">Subtitle tracks and video quality are selected in the player when the source supports them.</p>
    </section>
    <section id="appearance" className="settings-section" aria-labelledby="settings-appearance"><h2 id="settings-appearance">Appearance</h2><AppearanceSettings /></section>
    <MyAnimeListConnection />
    <section className="settings-section" aria-labelledby="settings-account"><h2 id="settings-account">Account & privacy</h2>
      <p>Manage your password, recovery code, signed-in devices, data export, and sign out.</p>
      <Link className="button button--outline" to="/account">Manage account</Link>
    </section>
  </div>;
}
