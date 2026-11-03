for n in "$@"; do
google-chrome --headless=new --no-sandbox --disable-gpu --no-pdf-header-footer --virtual-time-budget=4000 --print-to-pdf=out/$n.pdf out/${n}_local.html 2>/dev/null
pdfinfo out/$n.pdf | egrep "Pages|Page size"
pdftoppm -r 110 -png out/$n.pdf out/$n
done
