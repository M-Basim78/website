/**
 * Tests for the contact form, the mailing list, and the SMTP client.
 *
 * The SMTP half runs against a fake server that speaks the real protocol and
 * captures what arrives. That matters more than it sounds: the alternative is
 * finding out the client is wrong by pointing it at her live Gmail account.
 *
 *   node cms/inbox.test.js
 */
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { Inbox } = require('./inbox.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '   ' + extra : '')); }
};

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mpm-inbox-'));
const req = (ip) => ({ headers: {}, socket: { remoteAddress: ip || '203.0.113.5' } });

/* ------------------------------------------------------- a fake SMTP server */
/**
 * Speaks just enough SMTP to accept one message, and records everything it was
 * told so the test can assert on the wire format.
 */
function fakeSmtp() {
  const seen = { commands: [], data: '' };
  const server = net.createServer((sock) => {
    let inData = false;
    let body = '';
    sock.write('220 fake ESMTP\r\n');
    sock.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      if (inData) {
        body += text;
        if (body.indexOf('\r\n.\r\n') >= 0) {
          seen.data = body.slice(0, body.indexOf('\r\n.\r\n'));
          inData = false;
          sock.write('250 OK queued\r\n');
        }
        return;
      }
      for (const line of text.split('\r\n').filter(Boolean)) {
        seen.commands.push(line);
        const up = line.toUpperCase();
        if (up.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (up === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (up.startsWith('MAIL FROM')) sock.write('250 OK\r\n');
        else if (up.startsWith('RCPT TO')) sock.write('250 OK\r\n');
        else if (up === 'DATA') { inData = true; sock.write('354 go ahead\r\n'); }
        else if (up === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write(seen.commands.filter(c => c === line).length === 1 &&
          seen.commands.filter(c => c.toUpperCase() === 'AUTH LOGIN').length &&
          seen.commands[seen.commands.length - 2] === 'AUTH LOGIN'
            ? '334 UGFzc3dvcmQ6\r\n' : '235 authenticated\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return { server, seen };
}

(async () => {
  console.log('\nvalidation');
  {
    const box = new Inbox({ contentDir: tmp() });
    ok('a blank name is refused', box.validate({ email: 'a@b.co', subject: 's', message: 'hi' }).error === 'Please add your name.');
    ok('a bad address is refused', !box.validate({ name: 'A', email: 'nope', subject: 's', message: 'hi' }).ok);
    ok('an empty message is refused', !box.validate({ name: 'A', email: 'a@b.co', subject: 's', message: '' }).ok);
    const good = box.validate({ name: 'Priya', email: 'p@example.com', subject: 'Hello', message: 'A question.' });
    ok('a real submission passes', good.ok && !good.spam);
    ok('the honeypot marks it spam', box.validate({ website: 'http://x', name: 'A', email: 'a@b.co', subject: 's', message: 'x' }).spam === true);
    ok('and a honeypot hit is not an error', box.validate({ website: 'x' }).ok === true);

    const long = box.validate({ name: 'A'.repeat(500), email: 'a@b.co', subject: 'S'.repeat(500), message: 'M'.repeat(20000) });
    ok('oversized fields are truncated, not rejected', long.ok && long.value.name.length === 120 && long.value.message.length === 8000);
  }

  console.log('\nmessages are written to disk');
  {
    const dir = tmp();
    const box = new Inbox({ contentDir: dir });
    const v = box.validate({ name: 'Priya', email: 'p@example.com', subject: 'Hello', message: 'A question.' });
    const rec = await box.save(v.value, req());
    ok('a file was written', fs.existsSync(path.join(dir, 'messages', rec.id + '.json')));
    ok('it arrives unread', rec.read_at === '');

    const raw = fs.readFileSync(path.join(dir, 'messages', rec.id + '.json'), 'utf8');
    ok('the IP address is not in the file', raw.indexOf('203.0.113.5') < 0);

    ok('it lists', (await box.list()).length === 1);
    ok('unread count is 1', (await box.unreadCount()) === 1);
    await box.markRead(rec.id, true);
    ok('marking read drops the count', (await box.unreadCount()) === 0);
    await box.markRead(rec.id, false);
    ok('and it can be put back', (await box.unreadCount()) === 1);

    ok('a traversal id is refused', (await box.markRead('../../etc/passwd', true)) === null);
    ok('deleting works', (await box.remove(rec.id)) === true);
    ok('and the list is empty again', (await box.list()).length === 0);
  }

  console.log('\nthe mailing list');
  {
    const box = new Inbox({ contentDir: tmp() });
    ok('a bad address is refused', !(await box.subscribe({ email: 'nope' })).ok);
    ok('signing up works', (await box.subscribe({ email: 'Priya@Example.COM', name: 'Priya' })).ok);
    const again = await box.subscribe({ email: 'priya@example.com' });
    ok('signing up twice is not an error', again.ok && again.already === true);
    const data = await box.subscribers();
    ok('there is exactly one entry', data.list.length === 1);
    ok('the address was lowercased', data.list[0].email === 'priya@example.com');
    ok('the honeypot is caught here too', (await box.subscribe({ website: 'x', email: 'bot@x.co' })).spam === true);

    const csv = await box.subscribersCsv();
    ok('the CSV has a header and one row', csv.trim().split('\r\n').length === 2, JSON.stringify(csv));
    ok('the CSV quotes its fields', csv.indexOf('"priya@example.com"') > 0);
  }

  console.log('\nthrottling');
  {
    const box = new Inbox({ contentDir: tmp() });
    const r = req('198.51.100.77');
    let blocked = 0;
    for (let i = 0; i < 8; i++) if (box.throttled(r)) blocked++;
    ok('a flood from one source is throttled', blocked === 3, 'blocked ' + blocked);
    ok('a different source is unaffected', box.throttled(req('198.51.100.78')) === false);
  }

  console.log('\nthe SMTP client, against a fake server');
  {
    const { server, seen } = fakeSmtp();
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    // Point the client at the fake, in cleartext, and reload it so it re-reads env.
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = String(port);
    process.env.SMTP_USER = 'her@gmail.com';
    process.env.SMTP_PASS = 'app password';
    process.env.MAIL_FROM = 'her@gmail.com';
    process.env.MAIL_TO = 'her@gmail.com';
    delete require.cache[require.resolve('./mail.js')];
    const mail = require('./mail.js');

    ok('it reports itself configured', mail.configured() === true);

    // A complete conversation against the fake, in cleartext, through the test
    // seam. This is the part that proves the client before her app password
    // ever touches it.
    await mail.send({
      subject: 'Website enquiry: Café question',
      replyTo: 'student@example.com',
      fromName: 'MedPsycMoss website',
      to: 'her@gmail.com',
      text: 'Line one.\nLine two with an accent: naïve.',
    }, { connect: (onReady) => net.connect({ host: '127.0.0.1', port: port }, onReady) });

    const cmds = seen.commands.join(' | ');
    ok('it said EHLO', /EHLO/.test(cmds));
    ok('it authenticated', /AUTH LOGIN/.test(cmds));
    ok('the password never appears in cleartext', cmds.indexOf('app password') < 0);
    ok('the username was base64 encoded',
      cmds.indexOf(Buffer.from('her@gmail.com', 'utf8').toString('base64')) >= 0);
    ok('MAIL FROM used the bare address', /MAIL FROM:<her@gmail\.com>/.test(cmds));
    ok('RCPT TO used the bare address', /RCPT TO:<her@gmail\.com>/.test(cmds));

    const headers = seen.data.split('\r\n\r\n')[0];
    const body = seen.data.split('\r\n\r\n').slice(1).join('\r\n\r\n');
    ok('From carries the display name', /^From: MedPsycMoss website <her@gmail\.com>$/m.test(headers), headers);
    ok('Reply-To is the student, so replying reaches them',
      /^Reply-To: student@example\.com$/m.test(headers), headers);
    ok('the accented subject was encoded', /^Subject: =\?UTF-8\?B\?/m.test(headers), headers);
    ok('the body was declared base64', /Content-Transfer-Encoding: base64/.test(headers));
    ok('the body decodes back to what was sent',
      Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')
        === 'Line one.\nLine two with an accent: naïve.',
      JSON.stringify(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')));

    ok('an ASCII header passes through', mail.headerValue('Hello there') === 'Hello there');
    ok('a non-ASCII header is RFC 2047 encoded', mail.headerValue('Café') === '=?UTF-8?B?' + Buffer.from('Café', 'utf8').toString('base64') + '?=');
    ok('a newline cannot be injected into a header',
      mail.headerValue('Subject\r\nBcc: victim@example.com').indexOf('\n') < 0);
    ok('an address is extracted from angle brackets', mail.bareAddress('Her Name <her@gmail.com>') === 'her@gmail.com');
    ok('a valid address is recognised', mail.isAddress('a.b+c@example.co.uk') === true);
    ok('a header-injection address is refused', mail.isAddress('a@b.co\r\nRCPT TO:<x@y.z>') === false);
    ok('the body is base64 in short lines',
      mail.b64Body('x'.repeat(500)).split('\r\n').every(l => l.length <= 76));
    ok('the body round-trips',
      Buffer.from(mail.b64Body('Ça va? Yes.').replace(/\r\n/g, ''), 'base64').toString('utf8') === 'Ça va? Yes.');

    // sendQuietly must never throw, whatever happens on the wire.
    process.env.SMTP_HOST = '127.0.0.1';
    process.env.SMTP_PORT = '1';         // nothing listens here
    delete require.cache[require.resolve('./mail.js')];
    const mail2 = require('./mail.js');
    const r = await mail2.sendQuietly({ subject: 'x', text: 'y', to: 'a@b.co' });
    ok('sendQuietly swallows a dead server', r.sent === false && !!r.reason);

    delete process.env.SMTP_HOST;
    delete require.cache[require.resolve('./mail.js')];
    const mail3 = require('./mail.js');
    ok('with no SMTP_HOST it reports unconfigured', mail3.configured() === false);
    const r3 = await mail3.sendQuietly({ subject: 'x', text: 'y' });
    ok('and sending is a no-op, not an error', r3.sent === false && r3.reason === 'not-configured');

    server.close();
  }

  console.log('\n' + (fail ? 'FAILED' : 'ALL PASSED') + '  ' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})();
