# Browser test assets

`motion.mp4` is an original four-second synthetic test pattern, not an anime episode. It is used only by the isolated browser tests and is not copied into the application build.

Regenerate with FFmpeg:

```sh
ffmpeg -f lavfi -i 'testsrc2=size=160x90:rate=10' -t 4 -c:v libx264 -crf 40 -preset veryslow -pix_fmt yuv420p -movflags +faststart motion.mp4
```

Browser tests use a fresh in-memory database. They cannot modify the imported catalogue and do not resolve live provider streams.
