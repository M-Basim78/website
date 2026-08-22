/* MedPsycMoss shared behaviour. Loaded by every page with <script src="/new/js/site.js" defer>.
   Guards mean a page can omit any component without erroring. */
  /* The shop lives on this site now. There is no per-product URL to rewrite to,
     so product links simply point at /store and the buy buttons below do the
     rest. The old data-p rewrite pointed at Gator and has been removed. */

  /* Buy buttons.
     The button carries only a product id. The server decides the price, so a
     tampered attribute buys nothing. Without JavaScript the href still leads to
     the product page, which is why this is a link and not a <button>. */
  (function(){
    var buys = document.querySelectorAll('[data-buy]');
    if (!buys.length) return;

    function busy(el, on, original) {
      el.setAttribute('aria-busy', on ? 'true' : 'false');
      if (on) { el.dataset.label = el.textContent; el.textContent = 'Taking you to checkout...'; }
      else if (original) { el.textContent = original; }
    }

    for (var i = 0; i < buys.length; i++) {
      buys[i].addEventListener('click', function (ev) {
        var el = ev.currentTarget;
        var id = el.getAttribute('data-buy');
        if (!id) return;
        ev.preventDefault();
        if (el.getAttribute('aria-busy') === 'true') return;

        /* An option picker on the same card, if the product has one. */
        var scope = el.closest('[data-product]') || document;
        var sel = scope.querySelector('select[data-option]');
        var optionId = sel ? sel.value : '';

        var label = el.textContent;
        busy(el, true);

        fetch('/api/store/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ productId: id, optionId: optionId })
        }).then(function (r) {
          return r.json().then(function (d) { return { ok: r.ok, d: d }; });
        }).then(function (res) {
          if (res.ok && res.d.url) { window.location = res.d.url; return; }
          busy(el, false, label);
          alert(res.d.error || 'Sorry, checkout is unavailable right now. Please try again shortly.');
        }).catch(function () {
          busy(el, false, label);
          alert('Sorry, checkout is unavailable right now. Please try again shortly.');
        });
      });
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
