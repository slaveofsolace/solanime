# Browser test assets

`motion.mp4` is original four-second synthetic test footage, not an anime episode. It is used only by isolated browser tests and is not included in the application build.

The 0.5 fixture uses baseline H.264, no B-frames, one-second keyframes and a silent AAC track. The earlier video-only long-GOP fixture intermittently stalled after seeking in the Linux WebKit test engine despite a full reported buffer. This encoding revision tests a conservative media path; it is not a claim that every external codec or source is fixed. Seek, actual advancing playback, HTTP ranges and native completion assertions remain enabled.

Regenerate with FFmpeg:

```sh
ffmpeg -f lavfi -i 'testsrc2=size=160x90:rate=10' \
  -f lavfi -i 'anullsrc=channel_layout=stereo:sample_rate=48000' \
  -t 4 -c:v libx264 -profile:v baseline -level:v 3.0 -g 10 -bf 0 \
  -crf 32 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart motion.mp4
```

Browser tests use fresh in-memory account and catalogue databases. They cannot modify the imported catalogue or private production accounts and do not resolve live provider streams.
