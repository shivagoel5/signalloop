// Shared page behavior: sections fade in, screenshots open in a lightbox, and the navigation marks where you are.
(function(){
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduce&&'IntersectionObserver' in window){
    var els=[].slice.call(document.querySelectorAll('section, .hero, .page-head'));
    els.forEach(function(el){el.classList.add('rv')});
    var io=new IntersectionObserver(function(es){es.forEach(function(x){
      if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target)}})},{threshold:.06});
    els.forEach(function(el){io.observe(el)});
  }
  var page=document.body.getAttribute('data-page');
  var mark=function(name,on){var a=document.querySelector('.nav a[data-page="'+name+'"]');if(a)a.classList.toggle('on',on)};
  mark(page,true);
  // On the product page, "Live demo" is marked while the demo is on screen.
  var tryEl=document.getElementById('try');
  if(page==='home'&&tryEl&&'IntersectionObserver' in window){
    new IntersectionObserver(function(es){es.forEach(function(x){mark('try',x.isIntersecting);mark('home',!x.isIntersecting)})},{rootMargin:'-35% 0px -55% 0px'}).observe(tryEl);
  }
  var lb=document.getElementById('lb');if(!lb)return;
  var lbimg=lb.querySelector('img');
  document.querySelectorAll('.report img').forEach(function(img){
    img.addEventListener('click',function(){lbimg.src=img.src;lb.classList.add('open')});
  });
  function close(){lb.classList.remove('open');lbimg.src=''}
  lb.addEventListener('click',close);
  addEventListener('keydown',function(e){if(e.key==='Escape')close()});
})();
