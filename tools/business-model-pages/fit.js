(function(){
  var fit=document.querySelector('.fit'), sheet=document.querySelector('.sheet');
  function size(){
    if(window.matchMedia('print').matches){sheet.style.transform='';fit.style.height='';return;}
    var w=sheet.offsetWidth, s=Math.min(1, fit.clientWidth/w);
    sheet.style.transform=s<1?'scale('+s+')':'';
    fit.style.height=(sheet.offsetHeight*s)+'px';
  }
  size(); window.addEventListener('resize',size);
  if(document.fonts&&document.fonts.ready){document.fonts.ready.then(size);}
})();
