/**
 * Tests for the traffic counter.
 *
 * The things worth proving: bots do not inflate the numbers, the same person
 * reading five pages is one visitor, nothing identifying is written to disk,
 * and a restart does not double count.
 *
 *   node cms/analytics.test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Analytics, dayOf, lastDays } = require('./analytics.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   ' + extra : '')); }
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpm-analytics-'));
const make = () => new Analytics({ contentDir: tmp, salt: 'test-salt', autoFlush: false });

const req = (ip, ua, ref) => ({
  headers: Object.assign(
    { 'user-agent': ua === undefined ? 'Mozilla/5.0 (iPhone) Safari' : ua },
    ref ? { referer: ref } : {}, { host: 'medpsycmoss.com' }),
  socket: { remoteAddress: ip || '203.0.113.7' },
});

(async () => {
  console.log('\ncounting');
  {
    const a = make();
    ok('a normal page view counts', a.record(req(), '/') === true);
    a.record(req(), '/store');
    a.record(req(), '/store');
    const s = await a.summary(1);
    ok('three views recorded', s.views === 3, 'got ' + s.views);
    ok('one visitor, not three', s.visitors === 1, 'got ' + s.visitors);
    ok('the busiest page is /store', s.topPages[0].name === '/store' && s.topPages[0].count === 2);
  }

  console.log('\ndifferent people are different visitors');
  {
    const a = make();
    a.record(req('198.51.100.1'), '/');
    a.record(req('198.51.100.2'), '/');
    a.record(req('198.51.100.2'), '/blog');
    const s = await a.summary(1);
    ok('two visitors from two addresses', s.visitors === 2, 'got ' + s.visitors);
    ok('three views between them', s.views === 3, 'got ' + s.views);
  }

  console.log('\nbots do not count');
  {
    const a = make();
    const bots = [
      'Googlebot/2.1 (+http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; bingbot/2.0)',
      'curl/8.4.0',
      'python-requests/2.31.0',
      'facebookexternalhit/1.1',
      'Mozilla/5.0 (compatible; AhrefsBot/7.0)',
      'Mozilla/5.0 HeadlessChrome/120',
      'GPTBot/1.0',
      'Better Uptime Bot',
    ];
    let counted = 0;
    for (const ua of bots) if (a.record(req('192.0.2.9', ua), '/')) counted++;
    ok('every bot was ignored', counted === 0, counted + ' slipped through');
    ok('a request with no user agent is ignored', a.record(req('192.0.2.9', ''), '/') === false);
    const s = await a.summary(1);
    ok('the day is still empty', s.views === 0 && s.visitors === 0);
  }

  console.log('\nreferrers');
  {
    const a = make();
    a.record(req('198.51.100.5', undefined, 'https://www.google.com/search?q=x'), '/');
    a.record(req('198.51.100.6', undefined, 'https://instagram.com/p/abc'), '/');
    a.record(req('198.51.100.7'), '/');
    a.record(req('198.51.100.8', undefined, 'https://medpsycmoss.com/blog'), '/store');
    const s = await a.summary(1);
    const byName = Object.fromEntries(s.topReferrers.map(r => [r.name, r.count]));
    ok('google is recorded without the www', byName['google.com'] === 1, JSON.stringify(byName));
    ok('instagram is recorded', byName['instagram.com'] === 1);
    ok('no referrer is direct', byName.direct >= 1);
    ok('our own pages are direct, not a referrer', byName['medpsycmoss.com'] === undefined);
    ok('the search query string is never kept',
      s.topReferrers.every(r => r.name.indexOf('?') < 0 && r.name.indexOf('/') < 0));
  }

  console.log('\nnothing identifying reaches the disk');
  {
    const a = make();
    a.record(req('198.51.100.44', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari'), '/about');
    await a.flush();
    const file = path.join(tmp, 'analytics', dayOf(new Date()) + '.json');
    const raw = fs.readFileSync(file, 'utf8');
    ok('the day file was written', fs.existsSync(file));
    ok('no IP address in the file', raw.indexOf('198.51.100.44') < 0);
    ok('no user agent in the file', raw.indexOf('iPhone') < 0);
    const parsed = JSON.parse(raw);
    ok('the visitor is a short hash', /^[0-9a-f]{12}$/.test(parsed.seen[0]), parsed.seen[0]);
    ok('the count survives as a number', parsed.views === 1 && parsed.visitors === 1);
  }

  console.log('\na restart does not double count');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpm-restart-'));
    const first = new Analytics({ contentDir: dir, salt: 'stable-salt', autoFlush: false });
    first.record(req('198.51.100.99'), '/');
    first.record(req('198.51.100.99'), '/store');
    await first.flush();

    const second = new Analytics({ contentDir: dir, salt: 'stable-salt', autoFlush: false });
    second.record(req('198.51.100.99'), '/blog');
    const s = await second.summary(1);
    ok('views carry over and add up', s.views === 3, 'got ' + s.views);
    ok('the returning visitor is still one visitor', s.visitors === 1, 'got ' + s.visitors);
  }

  console.log('\nthe thirty day window');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpm-window-'));
    const a = new Analytics({ contentDir: dir, salt: 's', autoFlush: false });
    // 90 days of history, so the window before this one is full rather than
    // half covered, which is what makes the comparison meaningful.
    const days = lastDays(90);
    for (const d of days) {
      fs.writeFileSync(path.join(dir, 'analytics', d + '.json'),
        JSON.stringify({ date: d, views: 2, visitors: 1, pages: { '/': 2 }, referrers: {}, seen: [] }));
    }
    const s = await a.summary(30);
    ok('exactly 30 days are in the window', s.perDay.length === 30);
    ok('30 days of two views is 60', s.views === 60, 'got ' + s.views);
    ok('the window ends today', s.to === dayOf(new Date()));
    ok('the previous 30 days are counted too', s.previous.views === 60, 'got ' + s.previous.views);
    const first = await a.since();
    ok('it knows the first day on record', first === days[0], first + ' vs ' + days[0]);
    ok('the comparison is a real change figure',
      s.views === s.previous.views, s.views + ' vs ' + s.previous.views);
  }

  console.log('\npruning');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpm-prune-'));
    const a = new Analytics({ contentDir: dir, salt: 's', autoFlush: false });
    const old = dayOf(new Date(Date.now() - 500 * 864e5));
    const recent = dayOf(new Date(Date.now() - 10 * 864e5));
    for (const d of [old, recent]) {
      fs.writeFileSync(path.join(dir, 'analytics', d + '.json'), JSON.stringify({ date: d, views: 1 }));
    }
    const removed = await a.prune(400);
    ok('the ancient day was pruned', removed === 1, 'removed ' + removed);
    ok('the recent day survived', fs.existsSync(path.join(dir, 'analytics', recent + '.json')));
  }

  console.log('\n' + (fail ? 'FAILED' : 'ALL PASSED') + '  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
