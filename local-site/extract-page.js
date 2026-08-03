/**
 * Browser-side extraction, injected by build-resources.mjs.
 *
 * Gator is an absolutely-positioned canvas: a resource card is a bare overlay
 * <a> with no text, and its title sits in an unrelated sibling div that merely
 * happens to be painted on top. DOM structure cannot pair them, so this pairs
 * them geometrically the way a reader does, by what sits inside the card's box.
 */
() => {
  const clean = s => (s || '')
    .replace(/[\u200B-\u200F\uFEFF\u2060]/g, '')
    .replace(/[\uE000-\uF8FF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const NAV = new Set(['home', 'about me', 'blog', 'podcast', 'store', 'resources',
    'my work', 'contact', 'about', 'more', 'button', 'title', '0',
    'workbooks & courses', 'all resources', 'instagram', 'youtube', 'spotify',
    'psychiatry', 'medicine', 'moss', 'psychiatry resident', 'lived experience',
    'medical doctor (m.d)', 'residency personal statement examples',
    'mock interview prep', 'leave of absence guide', 'usmle accommodations help',
    'apple podcasts', 'transcipt coming soon', 'transcript coming soon',
    'coming soon', 'read more', 'learn more', 'click here']);

  // Her own channels. They belong in the footer, not in a resource list.
  const OWN = [
    /instagram\.com\/stephmossmd/i, /youtube\.com\/@?doctormoss/i,
    /youtube\.com\/c\/medpsycmoss/i, /open\.spotify\.com\/?$/i,
    /podcasts\.apple\.com\/us\/podcast\/life-as-a-patient-doctor/i,
    /open\.spotify\.com\/show\/685WDhQHXulbCmh2siIOp3/i,
    /bookshop\.org\/shop\/medpsycmoss/i, /linktr\.ee/i,
  ];

  const INTERNAL = /localhost|medpsycmoss\.com|mywebsitebuilder|gator\.com|webzai/i;

  const vis = el => {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  const blocks = [];
  document.querySelectorAll('body *').forEach(el => {
    if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|PATH|IFRAME)$/.test(el.tagName)) return;
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += ' ' + n.nodeValue;
    own = clean(own);
    if (!own || !vis(el)) return;
    const r = el.getBoundingClientRect();
    blocks.push({
      text: own, size: parseFloat(getComputedStyle(el).fontSize) || 0,
      x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height,
      cx: r.x + scrollX + r.width / 2, cy: r.y + scrollY + r.height / 2,
    });
  });

  const notNav = b => !NAV.has(b.text.toLowerCase());

  // Page title: the earliest large non-chrome block.
  let title = '';
  const tc = blocks.filter(b => notNav(b) && b.text.length > 3 && b.size >= 20)
    .sort((a, b) => a.y - b.y || b.size - a.size);
  title = tc.length ? tc[0].text : clean(document.title);

  const seen = new Set();
  const entries = [];

  document.querySelectorAll('a[href]').forEach(a => {
    const href = a.href;
    if (!/^https?:/i.test(href) || INTERNAL.test(href)) return;
    if (OWN.some(re => re.test(href))) return;
    if (!vis(a)) return;

    const r = a.getBoundingClientRect();
    const box = { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };

    let label = clean(a.textContent);
    let blurb = '';
    let source = 'text';

    if (!label || NAV.has(label.toLowerCase())) {
      // Overlay card: everything painted inside the link's own box.
      const inside = blocks.filter(b =>
        b.cx >= box.x && b.cx <= box.x + box.w &&
        b.cy >= box.y && b.cy <= box.y + box.h && notNav(b));
      if (inside.length) {
        const byType = [...inside].sort((p, q) => q.size - p.size || p.y - q.y);
        label = byType[0].text;
        source = 'card';
        const rest = inside.filter(b => b.text !== label)
          .sort((p, q) => p.y - q.y);
        if (rest.length) blurb = rest[0].text;
      }
    }

    if (!label || NAV.has(label.toLowerCase())) {
      // Nearest non-chrome text directly above the card.
      let best = null, bd = 1e9;
      for (const b of blocks) {
        if (!notNav(b)) continue;
        const dy = box.y - (b.y + b.h);
        const dx = Math.abs(b.cx - (box.x + box.w / 2));
        if (dy >= -10 && dy < 150 && dx < Math.max(box.w, 200)) {
          const d = dy + dx * 0.25;
          if (d < bd) { bd = d; best = b; }
        }
      }
      if (best) { label = best.text; source = 'near'; }
    }

    const key = href.replace(/[#?].*$/, '').replace(/\/$/, '');
    if (seen.has(key)) return;
    seen.add(key);

    let host = '';
    try { host = new URL(href).hostname.replace(/^www\./, ''); } catch { }
    if (!label || NAV.has(label.toLowerCase())) { label = ''; source = 'none'; }

    entries.push({ label, blurb, href, host, source });
  });

  // Her own pages linked from this one. The posts-* pages are lists of her blog
  // writing, so without these they would render empty.
  const CHROME = new Set(['', 'about-me', 'blog', 'podcast', 'store', 'resources',
    'my-work', 'contact', 'about', 'index']);
  const internal = [];
  const iseen = new Set();
  document.querySelectorAll('a[href]').forEach(a => {
    let u;
    try { u = new URL(a.getAttribute('href') || '', location.origin); } catch { return; }
    if (!/localhost|medpsycmoss\.com/i.test(u.hostname)) return;
    if (!vis(a)) return;

    let p = decodeURIComponent(u.pathname).replace(/^\/+|\/+$/g, '');
    // serve.js rewrites archived internal links through /view/undefined/undefined/
    p = p.replace(/^view\/undefined\/undefined\/?/, '');
    if (!p || CHROME.has(p.toLowerCase())) return;
    if (/^(store|products)\//i.test(p)) return;
    if (iseen.has(p)) return;
    iseen.add(p);

    const r = a.getBoundingClientRect();
    const box = { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height };
    let label = clean(a.textContent);
    if (!label || NAV.has(label.toLowerCase())) {
      const inside = blocks.filter(b =>
        b.cx >= box.x && b.cx <= box.x + box.w &&
        b.cy >= box.y && b.cy <= box.y + box.h && notNav(b));
      if (inside.length) {
        inside.sort((p2, q) => q.size - p2.size || p2.y - q.y);
        label = inside[0].text;
      }
    }
    internal.push({ label: label || '', path: p });
  });

  return { title, docTitle: clean(document.title), entries, internal };
}
