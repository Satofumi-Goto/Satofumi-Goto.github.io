import sys,pathlib
css=pathlib.Path('common.css').read_text(); js=pathlib.Path('fit.js').read_text()
head=('<meta name="claude:viewport-fit-sides" content="cover">\n'
 '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap">\n'
 '<style>\n'+css+'</style>')
for n in sys.argv[1:]:
    src=pathlib.Path(n+'.html').read_text()
    out=src.replace('<!--HEAD-->',head).replace('<!--SCRIPT-->','<script>\n'+js+'</script>')
    pathlib.Path('out').mkdir(exist_ok=True)
    pathlib.Path('out/'+n+'.html').write_text(out)
    # local full doc for rendering
    pathlib.Path('out/'+n+'_local.html').write_text('<!doctype html><html lang="ja"><head><meta charset="utf-8">'+out.split('</style>')[0]+'</style></head><body>'+out.split('</style>',1)[1]+'</body></html>')
