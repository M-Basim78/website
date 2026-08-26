/**
 * Sending mail, with no dependencies.
 *
 * The rest of this container has none, and nodemailer would be the first, for
 * what is a short conversation over a socket. SMTP is a line protocol and Node
 * ships TLS, so this is the whole client.
 *
 * Design notes, because they are load bearing:
 *
 * 1. SENDING NEEDS NO DNS. MX records are for RECEIVING mail at a domain, and
 *    medpsycmoss.com has none and needs none. This logs into an existing
 *    mailbox (her Gmail, via an app password) and sends as that account. No SPF,
 *    no DKIM, no MX, nothing added to the domain.
 *
 * 2. MAIL IS A NOTIFICATION, NEVER THE RECORD. Every message is written to disk
 *    before this is called, and a failure here is logged and swallowed. A
 *    student's enquiry must not be lost because an app password expired.
 *
 * 3. IT IS OFF UNTIL CONFIGURED. With no SMTP_HOST the site runs exactly as it
 *    does now, minus the notification. Nothing half-works.
 *
 * Env:
 *   SMTP_HOST   e.g. smtp.gmail.com          (unset = sending disabled)
 *   SMTP_PORT   465 implicit TLS, or 587 STARTTLS. Default 465.
 *   SMTP_USER   the full address to log in as
 *   SMTP_PASS   an app password, never her account password
 *   MAIL_FROM   defaults to SMTP_USER
 *   MAIL_TO     where contact form messages go. Defaults to SMTP_USER.
 */
const net = require('net');
const tls = require('tls');

const CRLF = '\r\n';

const cfg = () => ({
  host: process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.SMTP_USER || '',
  pass: process.env.SMTP_PASS || '',
  from: process.env.MAIL_FROM || process.env.SMTP_USER || '',
  to: process.env.MAIL_TO || process.env.SMTP_USER || '',
});

const configured = () => {
  const c = cfg();
  return !!(c.host && c.user && c.pass && c.from);
};

/* ---------------------------------------------------------------- encoding */

/**
 * A header value that may contain anything. Non-ASCII becomes RFC 2047, and a
 * newline is dropped rather than encoded: a header break is how a hostile
 * subject line injects extra headers, and she has a public form.
 */
function headerValue(s) {
  const clean = String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return '=?UTF-8?B?' + Buffer.from(clean, 'utf8').toString('base64') + '?=';
}

/** An address for MAIL FROM / RCPT TO: the bare address, nothing else. */
function bareAddress(s) {
  const m = String(s || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(s || '')).trim();
}

const isAddress = (s) => /^[^\s@,;:<>"']+@[^\s@,;:<>"']+\.[A-Za-z]{2,}$/.test(String(s || '').trim());

/** Base64 in 76 character lines, which is what the body is sent as. */
function b64Body(text) {
  const b = Buffer.from(String(text == null ? '' : text), 'utf8').toString('base64');
  const out = [];
  for (let i = 0; i < b.length; i += 76) out.push(b.slice(i, i + 76));
  return out.join(CRLF);
}

/* ------------------------------------------------------------------ socket */

/**
 * One SMTP conversation.
 *
 * Reads whole replies, so a multi-line 250-EHLO response is not mistaken for
 * several. A reply ends at a line whose fourth character is a space.
 */
function talk(socket, timeoutMs) {
  let buf = '';
  const waiters = [];

  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buf += chunk;
    // A complete reply: last line is "NNN " rather than "NNN-".
    const lines = buf.split(CRLF).filter(Boolean);
    const last = lines[lines.length - 1] || '';
    if (/^\d{3} /.test(last) && waiters.length) {
      const reply = buf;
      buf = '';
      waiters.shift()(reply);
    }
  });

  const read = () => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('SMTP timed out waiting for a reply')), timeoutMs);
    waiters.push((r) => { clearTimeout(t); resolve(r); });
  });

  const send = (line) => new Promise((resolve, reject) => {
    socket.write(line + CRLF, (err) => (err ? reject(err) : resolve()));
  });

  /** Send a command and require the reply to start with one of `expect`. */
  const cmd = async (line, expect, redact) => {
    if (line !== null) await send(line);
    const reply = await read();
    const code = reply.slice(0, 3);
    if (expect && expect.indexOf(code) < 0) {
      const shown = redact ? '(hidden)' : String(line).slice(0, 60);
      throw new Error('SMTP refused "' + shown + '": ' + reply.trim().slice(0, 200));
    }
    return reply;
  };

  return { cmd, read, send };
}

/**
 * Send one message. Resolves to true, or throws.
 *
 * Callers should not let it throw into a request: see sendQuietly.
 */
async function send(msg, opts) {
  const c = cfg();
  if (!configured()) throw new Error('SMTP is not configured.');

  // A seam for the tests, and only for the tests. They stand up a fake SMTP
  // server that speaks the protocol in cleartext and assert on what arrives on
  // the wire, which is the only way to know this client is correct without
  // pointing it at her real mailbox. Production never passes this, so the
  // encrypted paths below are the only ones that can run in the container.
  const connectWith = opts && opts.connect;

  const to = bareAddress(msg.to || c.to);
  const from = bareAddress(c.from);
  if (!isAddress(to)) throw new Error('Refusing to send to a malformed address.');
  if (!isAddress(from)) throw new Error('MAIL_FROM is not a valid address.');

  const timeoutMs = Number(msg.timeoutMs || 15000);
  const implicit = c.port === 465;

  const socket = await new Promise((resolve, reject) => {
    const onErr = (e) => reject(new Error('Could not reach ' + c.host + ':' + c.port + ' - ' + e.message));
    const s = connectWith
      ? connectWith(() => resolve(s))
      : implicit
        ? tls.connect({ host: c.host, port: c.port, servername: c.host }, () => resolve(s))
        : net.connect({ host: c.host, port: c.port }, () => resolve(s));
    s.once('error', onErr);
    s.setTimeout(timeoutMs, () => { s.destroy(); reject(new Error('Timed out connecting to ' + c.host)); });
  });

  let conn = talk(socket, timeoutMs);
  try {
    await conn.cmd(null, ['220']);                       // the greeting
    await conn.cmd('EHLO medpsycmoss.com', ['250']);

    if (!implicit && !connectWith) {
      // 587: upgrade in place, then say hello again over the encrypted channel.
      await conn.cmd('STARTTLS', ['220']);
      const plain = socket;
      const secure = await new Promise((resolve, reject) => {
        const t = tls.connect({ socket: plain, servername: c.host }, () => resolve(t));
        t.once('error', reject);
      });
      conn = talk(secure, timeoutMs);
      await conn.cmd('EHLO medpsycmoss.com', ['250']);
      socket.removeAllListeners('data');
    }

    // AUTH LOGIN: the username and password go as separate base64 lines.
    await conn.cmd('AUTH LOGIN', ['334']);
    await conn.cmd(Buffer.from(c.user, 'utf8').toString('base64'), ['334'], true);
    await conn.cmd(Buffer.from(c.pass, 'utf8').toString('base64'), ['235'], true);

    await conn.cmd('MAIL FROM:<' + from + '>', ['250']);
    await conn.cmd('RCPT TO:<' + to + '>', ['250', '251']);
    await conn.cmd('DATA', ['354']);

    const headers = [
      'From: ' + (msg.fromName ? headerValue(msg.fromName) + ' <' + from + '>' : from),
      'To: ' + to,
      'Subject: ' + headerValue(msg.subject || '(no subject)'),
      'Date: ' + new Date().toUTCString(),
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
    ];
    // Reply-To is what makes the contact form useful: she hits reply and it
    // goes to the student, not to herself.
    if (msg.replyTo && isAddress(bareAddress(msg.replyTo))) {
      headers.push('Reply-To: ' + bareAddress(msg.replyTo));
    }

    // The body is base64, so it can contain no bare "." line and needs no
    // dot-stuffing. That is most of why it is encoded rather than sent raw.
    await conn.send(headers.join(CRLF) + CRLF + CRLF + b64Body(msg.text));
    await conn.cmd('.', ['250']);
    await conn.send('QUIT');
  } finally {
    socket.destroy();
  }
  return true;
}

/**
 * Send, and never throw.
 *
 * Used on the request path. The message is already on disk by the time this
 * runs, so a failure costs a notification, not a student's enquiry.
 */
async function sendQuietly(msg) {
  if (!configured()) return { sent: false, reason: 'not-configured' };
  try {
    await send(msg);
    return { sent: true };
  } catch (e) {
    console.error('mail:', e.message);
    return { sent: false, reason: e.message };
  }
}

module.exports = { send, sendQuietly, configured, cfg, headerValue, bareAddress, isAddress, b64Body };
