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

  /* scroll reveals

     threshold:0, not 0.12, and the difference is not cosmetic.

     A threshold asks what FRACTION of the element is on screen. A blog post is
     one .reveal element thirteen thousand pixels tall, so at a 900px viewport
     at most 6.5% of it can ever be visible at once. It could never reach 12%,
     the observer never fired, and .reveal{opacity:0} left forty per cent of her
     blog permanently blank. The HTML was always there, which is why it looked
     fine in the source and blank on screen.

     threshold:0 fires as soon as any part of the element enters, which is what
     "reveal on scroll" was always meant to mean. The small negative rootMargin
     keeps the effect by waiting until it is properly in view rather than
     touching the very bottom edge.

     The failsafe below is the belt to that braces: if anything is still hidden
     shortly after load, show it. Nothing on this site is worth hiding because
     an observer misbehaved. */
  (function(){
    var els = document.querySelectorAll('.reveal');
    var show = function(el){ el.classList.add('in'); };
    if (reduce || !('IntersectionObserver' in window)) {
      for (var i = 0; i < els.length; i++) show(els[i]);
      return;
    }
    var io = new IntersectionObserver(function(es){
      es.forEach(function(en){ if (en.isIntersecting) { show(en.target); io.unobserve(en.target); } });
    }, {threshold: 0, rootMargin: '0px 0px -6% 0px'});
    for (var i = 0; i < els.length; i++) io.observe(els[i]);

    setTimeout(function(){
      for (var j = 0; j < els.length; j++) {
        var r = els[j].getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) show(els[j]);
      }
    }, 1500);
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

  /* Contact form and mailing list.
     Progressive enhancement, not a requirement: without JavaScript the form
     still posts normally and the server answers with a redirect carrying
     ?sent=1, which the block below turns into the same confirmation. With
     JavaScript nobody leaves the page. */
  (function(){
    function status(form){
      // The contact form ships a live region already; the list form does not,
      // so borrow its note line rather than inventing a second pattern.
      return form.querySelector('[role="status"]') ||
             form.querySelector('.form-note');
    }

    function say(form, text, bad){
      var el = status(form);
      if (!el) return;
      el.textContent = text;
      el.style.color = bad ? '#B3261E' : '';
    }

    function wire(sel, url, success){
      var form = document.querySelector(sel);
      if (!form) return;
      form.addEventListener('submit', function(ev){
        if (!window.fetch || !window.FormData) return;   // let the browser post
        ev.preventDefault();
        var btn = form.querySelector('[type="submit"]');
        var was = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
        say(form, '');

        var data = {};
        new FormData(form).forEach(function(v, k){ data[k] = v; });

        fetch(url, {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
          body: JSON.stringify(data)
        }).then(function(r){
          return r.json().catch(function(){ return {ok: r.ok}; });
        }).then(function(j){
          if (j && j.ok) {
            form.reset();
            say(form, j.already ? 'You are already on the list.' : success);
          } else {
            say(form, (j && j.error) || 'That did not send. Please try again.', true);
          }
        }).catch(function(){
          say(form, 'That did not send. Please check your connection and try again.', true);
        }).then(function(){
          if (btn) { btn.disabled = false; btn.textContent = was; }
        });
      });
    }

    wire('.contact-form', '/api/contact',
      'Thank you, your message has been sent. Dr. Moss will reply to the address you gave.');
    wire('.sub-form', '/api/subscribe',
      'You are on the list. Thank you.');

  })();

  var yr = document.getElementById('yr');
  if (yr) yr.textContent = new Date().getFullYear();
