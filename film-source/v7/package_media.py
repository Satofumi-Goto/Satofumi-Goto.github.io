from pathlib import Path
import subprocess,json,hashlib
root=Path(__file__).resolve().parent
files=[]
for lang in ['ja','en']:
 d=root/'v7'/lang;d.mkdir(exist_ok=True)
 for old in d.glob('part-*.m4s'):old.unlink()
 subprocess.run(['ffmpeg','-y','-v','error','-i',str(root/'v7'/('Mobility_World_v7_'+lang+'.mp4')),'-c','copy','-hls_time','10','-hls_playlist_type','vod','-hls_segment_type','fmp4','-hls_fmp4_init_filename','init.mp4','-hls_segment_filename',str(d/'part-%03d.m4s'),str(d/'film.m3u8')],check=True)
 for p in sorted(d.iterdir()):
  b=p.read_bytes();sha=hashlib.sha1(b'blob '+str(len(b)).encode()+b'\0'+b).hexdigest()
  files.append({'local':str(p),'path':'media/mobility-world-v7/'+lang+'/'+p.name,'size':len(b),'sha':sha})
(root/'media-manifest.json').write_text(json.dumps(files))
print(len(files),'media files',sum(f['size'] for f in files),'bytes')
