#!/usr/bin/env node
/**
 * Make a password hash for CMS_PASSWORD_HASH.
 *   node cms/hash-password.js "her password"
 * Set the output as an environment variable so the plain password is never
 * stored in the repo or in the compose file.
 */
const crypto = require('crypto');
const pw = process.argv[2];
if (!pw) { console.error('usage: node cms/hash-password.js "<password>"'); process.exit(1); }
const salt = crypto.randomBytes(16).toString('hex');
console.log(`${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`);
