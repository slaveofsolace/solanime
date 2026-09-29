/** Seek while preserving playback intent, without loading a second media element.
 * Pause before the seek so WebKit's media pipeline can flush the old position.
 * Resume only after its real seeked event; completion stays owned by the browser.
 */
export function createMediaSeeker(video: HTMLVideoElement, onError: () => void) {
  let pending: { resume: boolean; done: () => void } | null = null;
  let disposed = false;
  let generation = 0;
  const cancel = () => {
    generation += 1;
    if (pending) video.removeEventListener('seeked', pending.done);
    pending = null;
  };
  return {
    seek(seconds: number) {
      if (
        disposed ||
        !Number.isFinite(seconds) ||
        !Number.isFinite(video.duration) ||
        video.duration <= 0
      )
        return;
      const resume = pending?.resume ?? (!video.paused && !video.ended);
      cancel();
      const current = generation;
      if (resume) video.pause();
      const done = () => {
        if (disposed || current !== generation) return;
        video.removeEventListener('seeked', done);
        pending = null;
        if (resume && !video.ended) {
          void video.play().catch(() => {
            if (!disposed && current === generation) onError();
          });
        }
      };
      pending = { resume, done };
      video.addEventListener('seeked', done);
      try {
        video.currentTime = Math.max(0, Math.min(video.duration, seconds));
        // Seeking to the existing position may legitimately emit no event.
        if (!video.seeking) done();
      } catch {
        cancel();
        onError();
      }
    },
    cancel,
    dispose() {
      cancel();
      disposed = true;
    },
  };
}
