import Dialog from '../components/Dialog';
import {
  EXPLORE_LENGTH_LABELS,
  EXPLORE_MOODS,
  EXPLORE_MOOD_KEYS,
  type ExploreFilters,
  type ExploreLength,
} from '../../shared/explore';

type Genre = { value: string; label: string };

function Chips({ label, options, selected, onToggle, max }: {
  label: string; options: Genre[]; selected: readonly string[]; onToggle: (value: string) => void; max: number;
}) {
  return (
    <fieldset className="explore-field">
      <legend>{label}</legend>
      <div className="explore-chips">
        {options.map(option => {
          const on = selected.includes(option.value);
          return (
            <button key={option.value} type="button" className="explore-chip" aria-pressed={on}
              disabled={!on && selected.length >= max} onClick={() => onToggle(option.value)}>
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: Array<[T, string]>; onChange: (value: T) => void;
}) {
  return (
    <fieldset className="explore-field">
      <legend>{label}</legend>
      <div className="explore-segmented">
        {options.map(([option, text]) => (
          <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}>{text}</button>
        ))}
      </div>
    </fieldset>
  );
}

/** Optional, skippable. Mood applies to this round only; the rest is saved only on request. */
export default function ExplorePreferences({ genres, filters, onChange, save, onSave, onClose }: {
  genres: Genre[];
  filters: ExploreFilters;
  onChange: (filters: ExploreFilters) => void;
  save: boolean;
  onSave: (save: boolean) => void;
  onClose: () => void;
}) {
  const set = <K extends keyof ExploreFilters>(key: K, value: ExploreFilters[K]) => onChange({ ...filters, [key]: value });
  const toggle = (key: 'genres' | 'excludeGenres', value: string) => {
    const other = key === 'genres' ? 'excludeGenres' : 'genres';
    const list = filters[key].includes(value) ? filters[key].filter(item => item !== value) : [...filters[key], value];
    onChange({ ...filters, [key]: list, [other]: filters[other].filter(item => item !== value) });
  };
  return (
    <Dialog title="Explore preferences" onClose={onClose} className="explore-preferences">
      <p className="explore-preferences__lead">Everything here is optional. Skip it and Explore uses what it already knows.</p>
      <fieldset className="explore-field">
        <legend>Mood for this round <span>Not saved</span></legend>
        <div className="explore-chips">
          <button type="button" className="explore-chip" aria-pressed={filters.mood === null} onClick={() => set('mood', null)}>Any</button>
          {EXPLORE_MOOD_KEYS.map(mood => (
            <button key={mood} type="button" className="explore-chip" aria-pressed={filters.mood === mood}
              onClick={() => set('mood', filters.mood === mood ? null : mood)}>
              {EXPLORE_MOODS[mood].label}
              <small>{EXPLORE_MOODS[mood].genres.join(', ')}</small>
            </button>
          ))}
        </div>
      </fieldset>
      <Chips label="Genres you enjoy" options={genres} selected={filters.genres} max={8} onToggle={value => toggle('genres', value)} />
      <Chips label="Never show" options={genres} selected={filters.excludeGenres} max={12} onToggle={value => toggle('excludeGenres', value)} />
      <Segmented<ExploreLength> label="Series length" value={filters.length} onChange={value => set('length', value)}
        options={[['any', 'Any'], ...(Object.entries(EXPLORE_LENGTH_LABELS) as Array<[ExploreLength, string]>)]} />
      <Segmented label="Audio" value={filters.audio} onChange={value => set('audio', value)}
        options={[['any', 'Any'], ['sub', 'Sub version listed'], ['dub', 'Dub version listed']]} />
      <Segmented label="Titles" value={filters.availability} onChange={value => set('availability', value)}
        options={[['available', 'Episodes on Solanime'], ['all', 'Whole catalogue']]} />
      <Segmented label="Mode" value={filters.mode} onChange={value => set('mode', value)}
        options={[['new', 'Find something new'], ['revisit', 'Continue or revisit']]} />
      <div className="explore-toggles">
        <label><input type="checkbox" checked={filters.includePlanned} onChange={event => set('includePlanned', event.target.checked)} />
          Include titles already on My List or MyAnimeList plan-to-watch</label>
        <label><input type="checkbox" checked={filters.includeDropped} onChange={event => set('includeDropped', event.target.checked)} />
          Give titles I dropped on MyAnimeList another chance</label>
        <label className="explore-toggles__save"><input type="checkbox" checked={save} onChange={event => onSave(event.target.checked)} />
          Save genres, exclusions, length and audio for future rounds</label>
      </div>
      <p className="field-hint">Audio choices use the versions listed for each title’s episodes. They don’t promise a particular dub language.</p>
      <div className="button-row">
        <button type="button" className="button button--primary" onClick={onClose}>Done</button>
        <button type="button" className="button button--outline" onClick={() => onChange({ ...filters, mood: null, genres: [], excludeGenres: [], length: 'any', audio: 'any' })}>Clear choices</button>
      </div>
    </Dialog>
  );
}
