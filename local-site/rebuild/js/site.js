/* MedPsycMoss shared behaviour. Loaded by every page with <script src="/new/js/site.js" defer>.
   Guards mean a page can omit any component without erroring. */
  /* Every checkout link is built from this one base.  At launch, change it to
     'https://store.medpsycmoss.com' and nothing else needs touching.  The hrefs
     in the HTML already point at the current live store, so the page works with
     JavaScript disabled and is crawlable as-is. */
  var STORE_BASE = 'https://medpsycmoss.com/store';

  (function(){
    var links = document.querySelectorAll('a[data-p]');
    for (var i = 0; i < links.length; i++) {
      links[i].href = STORE_BASE + '/' + links[i].getAttribute('data-p');
    }
  })();

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* live ECG sweep: a drawing segment travels the trace forever (seamless linear loop) */
  (function(){
    var p = document.getElementById('hbLive');
    if (!p || reduce || !p.animate) return;
    var L = p.getTotalLength();
    var seg = L * 0.16;
    p.style.strokeDasharray = seg + ' ' + (L - seg);
    p.style.strokeDashoffset = seg;
    p.animate(
      [{strokeDashoffset: seg}, {strokeDashoffset: -(L - seg)}],
      {duration: 5200, iterations: Infinity, easing: 'linear'}
    );
  })();

  /* marquee: duplicate content once for a perfect -50% loop */
  (function(){
    var t = document.getElementById('marq');
    if (!t || reduce) return;
    t.innerHTML += t.innerHTML;
  })();

  /* scroll reveals */
  (function(){
    var els = document.querySelectorAll('.reveal');
    if (reduce || !('IntersectionObserver' in window)) {
      for (var i = 0; i < els.length; i++) els[i].classList.add('in');
      return;
    }
    var io = new IntersectionObserver(function(es){
      es.forEach(function(en){ if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, {threshold: 0.12});
    els.forEach(function(e){ io.observe(e); });
  })();

  /* dock highlights current section */
  (function(){
    var map = {store:0, free:1, pod:2, story:3};
    var links = document.querySelectorAll('.dock a');
    if (!links.length || !('IntersectionObserver' in window)) return;
    var io = new IntersectionObserver(function(es){
      es.forEach(function(en){
        if (en.isIntersecting) {
          for (var i = 0; i < links.length; i++) links[i].classList.remove('on');
          var idx = map[en.target.id];
          if (idx !== undefined) links[idx].classList.add('on');
        }
      });
    }, {rootMargin: '-40% 0px -50% 0px'});
    ['store','free','pod','story'].forEach(function(id){
      var el = document.getElementById(id); if (el) io.observe(el);
    });
  })();

  document.getElementById('yr').textContent = new Date().getFullYear();
