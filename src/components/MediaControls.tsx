import { useEffect, useRef, useState, type RefObject, type KeyboardEvent } from 'react';
import Icon from './Icon';
import { createMediaSeeker } from '../lib/mediaSeek';
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds),
    minutes = Math.floor(whole / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
    : `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}
export default function MediaControls({
  videoRef,
  frameRef,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  frameRef: RefObject<HTMLDivElement | null>;
}) {
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1),
    [muted, setMuted] = useState(false),
    [fullscreen, setFullscreen] = useState(false);
  const [message, setMessage] = useState(''),
    [tracks, setTracks] = useState<TextTrack[]>([]),
    [caption, setCaption] = useState(-1);
  const lastVolume = useRef(1);
  const seeker = useRef<ReturnType<typeof createMediaSeeker> | null>(null);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const instance = createMediaSeeker(video, () =>
      setMessage('Seek complete. Press Play to resume.'),
    );
    seeker.current = instance;
    return () => {
      instance.dispose();
      if (seeker.current === instance) seeker.current = null;
    };
  }, [videoRef]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const sync = () => {
      setPlaying(!video.paused && !video.ended);
      setTime(video.currentTime || 0);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      setVolume(video.volume);
      setMuted(video.muted);
    };
    const syncTracks = () => {
      const list = Array.from(video.textTracks).filter((track) =>
        ['captions', 'subtitles'].includes(track.kind),
      );
      setTracks(list);
      setCaption(list.findIndex((track) => track.mode === 'showing'));
    };
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === frameRef.current);
    const events = [
      'timeupdate',
      'loadedmetadata',
      'durationchange',
      'play',
      'pause',
      'ended',
      'volumechange',
      'seeked',
      'emptied',
    ];
    events.forEach((event) => video.addEventListener(event, sync));
    video.textTracks.addEventListener('addtrack', syncTracks);
    video.textTracks.addEventListener('removetrack', syncTracks);
    video.textTracks.addEventListener('change', syncTracks);
    document.addEventListener('fullscreenchange', syncFullscreen);
    sync();
    syncTracks();
    return () => {
      events.forEach((event) => video.removeEventListener(event, sync));
      video.textTracks.removeEventListener('addtrack', syncTracks);
      video.textTracks.removeEventListener('removetrack', syncTracks);
      video.textTracks.removeEventListener('change', syncTracks);
      document.removeEventListener('fullscreenchange', syncFullscreen);
    };
  }, [videoRef, frameRef]);
  const play = async () => {
    const video = videoRef.current;
    if (!video) return;
    setMessage('');
    seeker.current?.cancel();
    try {
      if (video.paused) await video.play();
      else video.pause();
    } catch {
      setMessage('Playback could not start. Try another server.');
    }
  };
  const seek = (value: number) => {
    const video = videoRef.current;
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      seeker.current?.seek(value);
      setTime(video.currentTime);
    }
  };
  const changeVolume = (value: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, value));
    video.muted = value === 0;
    if (value > 0) lastVolume.current = value;
  };
  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted || video.volume === 0) {
      video.muted = false;
      if (video.volume === 0) video.volume = lastVolume.current;
    } else video.muted = true;
  };
  const toggleFullscreen = async () => {
    setMessage('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (frameRef.current?.requestFullscreen) await frameRef.current.requestFullscreen();
      else {
        const video = videoRef.current as
          | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
          | null;
        if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
        else setMessage('Fullscreen is not available in this browser.');
      }
    } catch {
      setMessage('Fullscreen is not available in this context.');
    }
  };
  const key = (event: KeyboardEvent) => {
    if (
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      (event.target as HTMLElement).closest(
        'input,button,select,a,textarea,[contenteditable="true"]',
      )
    )
      return;
    const action: Record<string, () => void> = {
      ' ': () => void play(),
      Enter: () => void play(),
      k: () => void play(),
      f: () => void toggleFullscreen(),
      m: toggleMute,
      ArrowLeft: () => seek(time - 10),
      ArrowRight: () => seek(time + 10),
      ArrowUp: () => changeVolume(volume + 0.1),
      ArrowDown: () => changeVolume(volume - 0.1),
    };
    if (action[event.key]) {
      event.preventDefault();
      action[event.key]();
    }
  };
  return (
    <div
      className="media-controls"
      role="group"
      aria-label="Playback controls"
      tabIndex={0}
      onKeyDown={key}
    >
      <input
        className="media-seek"
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(time, duration || 0)}
        disabled={!duration}
        aria-label="Seek video"
        aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
        onChange={(event) => seek(Number(event.target.value))}
      />
      <div className="media-controls__row">
        <button
          className="media-button"
          type="button"
          onClick={() => void play()}
          aria-label={playing ? 'Pause video' : 'Play video'}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button
          className="media-button media-skip"
          type="button"
          aria-label="Rewind 10 seconds"
          onClick={() => seek(time - 10)}
        >
          <Icon name="left" />
          <small>10</small>
        </button>
        <button
          className="media-button media-skip"
          type="button"
          aria-label="Forward 10 seconds"
          onClick={() => seek(time + 10)}
        >
          <small>10</small>
          <Icon name="right" />
        </button>
        <button
          className="media-button"
          type="button"
          aria-label={muted || volume === 0 ? 'Unmute video' : 'Mute video'}
          onClick={toggleMute}
        >
          <Icon name={muted || volume === 0 ? 'muted' : 'volume'} />
        </button>
        <input
          className="media-volume"
          type="range"
          aria-label="Video volume"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          onChange={(event) => changeVolume(Number(event.target.value))}
        />
        <span className="media-time">
          {formatTime(time)} <span>/ {formatTime(duration)}</span>
        </span>
        <div className="media-controls__extras">
          {tracks.length > 0 && (
            <select
              aria-label="Captions"
              value={caption}
              onChange={(event) => {
                const index = Number(event.target.value);
                tracks.forEach((track, i) => {
                  track.mode = i === index ? 'showing' : 'disabled';
                });
                setCaption(index);
              }}
            >
              <option value={-1}>Captions off</option>
              {tracks.map((track, index) => (
                <option value={index} key={index}>
                  {track.label || track.language || `Track ${index + 1}`}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Playback speed"
            defaultValue="1"
            onChange={(event) => {
              if (videoRef.current) videoRef.current.playbackRate = Number(event.target.value);
            }}
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
          <button
            className="media-button"
            type="button"
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen video'}
            onClick={() => void toggleFullscreen()}
          >
            <Icon name="expand" />
          </button>
        </div>
      </div>
      {message && (
        <p className="media-error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
