import { describe, expect, it, vi } from 'vitest';
import { createMediaSeeker } from '../src/lib/mediaSeek';
function fixture(paused = false) {
  const video = Object.assign(new EventTarget(), {
    paused,
    ended: false,
    duration: 120,
    currentTime: 0,
    seeking: true,
    pause: vi.fn(function (this: { paused: boolean }) {
      this.paused = true;
    }),
    play: vi.fn(function (this: { paused: boolean }) {
      this.paused = false;
      return Promise.resolve();
    }),
  });
  const error = vi.fn();
  const seeker = createMediaSeeker(video as unknown as HTMLVideoElement, error);
  return { video, error, seeker };
}
describe('native seek lifecycle', () => {
  it('pauses before seeking and resumes only on the actual seeked event', () => {
    const { video, seeker } = fixture();
    seeker.seek(20);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(20);
    expect(video.play).not.toHaveBeenCalled();
    video.dispatchEvent(new Event('seeked'));
    expect(video.play).toHaveBeenCalledOnce();
    video.dispatchEvent(new Event('seeked'));
    expect(video.play).toHaveBeenCalledOnce();
  });
  it('does not start a paused video', () => {
    const { video, seeker } = fixture(true);
    seeker.seek(20);
    video.dispatchEvent(new Event('seeked'));
    expect(video.play).not.toHaveBeenCalled();
    expect(video.pause).not.toHaveBeenCalled();
  });
  it('coalesces repeated slider positions without losing playback intent', () => {
    const { video, seeker } = fixture();
    seeker.seek(20);
    seeker.seek(40);
    seeker.seek(60);
    video.dispatchEvent(new Event('seeked'));
    expect(video.currentTime).toBe(60);
    expect(video.play).toHaveBeenCalledOnce();
  });
  it('cancels a pending resume after user action or disposal', () => {
    const { video, seeker } = fixture();
    seeker.seek(20);
    seeker.cancel();
    video.dispatchEvent(new Event('seeked'));
    expect(video.play).not.toHaveBeenCalled();
    video.paused = false;
    seeker.seek(40);
    seeker.dispose();
    video.dispatchEvent(new Event('seeked'));
    expect(video.play).not.toHaveBeenCalled();
    seeker.seek(90);
    expect(video.currentTime).toBe(40);
  });
  it('clamps targets and rejects invalid positions', () => {
    const { video, seeker } = fixture(true);
    seeker.seek(-1);
    expect(video.currentTime).toBe(0);
    seeker.seek(200);
    expect(video.currentTime).toBe(120);
    seeker.seek(NaN);
    expect(video.currentTime).toBe(120);
  });
  it('reports refused resume without an unhandled rejection or fake completion', async () => {
    const { video, seeker, error } = fixture();
    video.play.mockRejectedValueOnce(new Error('blocked'));
    const ended = vi.fn();
    video.addEventListener('ended', ended);
    seeker.seek(20);
    video.dispatchEvent(new Event('seeked'));
    await Promise.resolve();
    expect(error).toHaveBeenCalledOnce();
    expect(ended).not.toHaveBeenCalled();
  });
});
