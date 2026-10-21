from pathlib import Path
import subprocess
root=Path(__file__).resolve().parent
for lang in ['ja','en']:
    old=root/'v7'/f'Mobility_World_v7_{lang}.mp4'
    duration=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(old)]))
    if abs(duration-281)<.15:
        print(lang,'already assembled',flush=True)
        continue
    assert abs(duration-300)<.15,duration
    out=root/'v7'/f'final-{lang}.mp4'
    filters=(
      '[0:v]trim=0:75,setpts=PTS-STARTPTS[v0];'
      '[1:v]setpts=PTS-STARTPTS[v1];'
      '[0:v]trim=120:300,setpts=PTS-STARTPTS[v2];'
      '[v0][v1][v2]concat=n=3:v=1:a=0,'
      'drawbox=x=1080:y=680:w=200:h=40:color=0x051323:t=fill,'
      'drawbox=x=0:y=717:w=1280:h=3:color=0x051323:t=fill[v];'
      '[0:a]atrim=0:101,asetpts=PTS-STARTPTS,afade=t=out:st=100.8:d=0.2[a0];'
      '[0:a]atrim=120:300,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.2[a1];'
      '[a0][a1]concat=n=2:v=0:a=1[a]')
    subprocess.run(['ffmpeg','-y','-v','error','-threads','2','-i',str(old),'-i',str(root/'v7'/f'swap-rows-{lang}.mp4'),'-filter_complex_threads','2','-filter_complex',filters,'-map','[v]','-map','[a]','-c:v','libx264','-preset','veryfast','-crf','23','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',str(out)],check=True)
    out.replace(old)
    print(lang,'ASSEMBLED 281 seconds',flush=True)
