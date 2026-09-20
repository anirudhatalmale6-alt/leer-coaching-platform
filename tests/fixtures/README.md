# Video fixtures

Real files, produced by ffmpeg and confirmed with ffprobe - not hand-written
byte arrays. The point of the codec check is that real encoders lay files out
in ways you would not guess, so a synthetic fixture would only prove the parser
agrees with my own idea of the format.

Note what `ffprobe` reports for each, and where `moov` lands:

| file | codec | moov |
| --- | --- | --- |
| `h264.mp4` | h264 / avc1 | after mdat |
| `hevc.mp4` | hevc / hvc1 | after mdat |
| `h264.mov` | h264 / avc1 | after mdat |
| `hevc.mov` | hevc / hvc1 | after mdat |
| `hevc_faststart.mov` | hevc / hvc1 | before mdat |

`moov` after the media data is the normal case for .mov, and it is what an
iPhone produces. A detector that reads only the head of the file finds nothing
on exactly the clips this feature exists for.

Regenerate:

```sh
cd tests/fixtures
gen() { ffmpeg -y -f lavfi -i "testsrc=duration=1:size=192x108:rate=15" "$@"; }
gen -c:v libx264 -pix_fmt yuv420p h264.mp4
gen -c:v libx265 -pix_fmt yuv420p -tag:v hvc1 hevc.mp4
gen -c:v libx265 -pix_fmt yuv420p -tag:v hvc1 -f mov hevc.mov
gen -c:v libx264 -pix_fmt yuv420p -f mov h264.mov
ffmpeg -y -i hevc.mov -c copy -movflags +faststart hevc_faststart.mov
```
