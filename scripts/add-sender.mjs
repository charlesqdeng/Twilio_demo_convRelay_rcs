#!/usr/bin/env node
/**
 * Add a phone number as a sender to this app's dedicated Messaging Service.
 * Usage:
 *   npm run add-sender -- +1XXXXXXXXXX
 *
 * SAFETY: refuses to attach a number that is already a sender in some OTHER
 * Messaging Service. This prevents accidentally pulling a shared sender out
 * of a teammate's service. If you need to reassign, do it deliberately via
 * the Console.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '..');
const Twilio = require(path.join(projectRoot, 'node_modules/twilio'));
const ENV_PATH = path.join(projectRoot, '.env.local');

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run add-sender -- +1XXXXXXXXXX');
  process.exit(1);
}
const phoneNumber = arg.trim();

function loadEnv() {
  const text = fs.readFileSync(ENV_PATH, 'utf-8');
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    env[k] = v;
  }
  return env;
}

const env = loadEnv();
const client = Twilio(
  env.TWILIO_API_KEY_SID || env.TWILIO_API_KEY,
  env.TWILIO_API_KEY_SECRET || env.TWILIO_API_SECRET,
  { accountSid: env.TWILIO_ACCOUNT_SID },
);

const targetSvcSid = env.TWILIO_MESSAGING_SERVICE_SID?.trim();
if (!targetSvcSid) {
  console.error('TWILIO_MESSAGING_SERVICE_SID is not set. Run: npm run provision-msg first.');
  process.exit(1);
}

async function main() {
  const ipns = await client.incomingPhoneNumbers.list({ phoneNumber, limit: 5 });
  const ipn = ipns[0];
  if (!ipn) {
    console.error(`No IncomingPhoneNumber found on this account matching ${phoneNumber}`);
    process.exit(1);
  }
  console.log(`Found ${ipn.phoneNumber} (${ipn.sid}) friendlyName="${ipn.friendlyName}"`);

  // Safety: is this number ALREADY in some other Messaging Service?
  const allSvcs = await client.messaging.v1.services.list({ limit: 500 });
  const conflicts = [];
  for (const svc of allSvcs) {
    if (svc.sid === targetSvcSid) continue;
    const senders = await client.messaging.v1.services(svc.sid).phoneNumbers.list({ limit: 100 });
    if (senders.some((s) => s.phoneNumber === phoneNumber)) {
      conflicts.push({ sid: svc.sid, friendlyName: svc.friendlyName });
    }
  }

  if (conflicts.length > 0) {
    console.error('\nRefusing to add — this number is already a sender in another Messaging Service:');
    for (const c of conflicts) console.error(`  ${c.sid}  friendlyName="${c.friendlyName}"`);
    console.error('\nRemove it from that service first (via the Console) or pick a different number.');
    process.exit(1);
  }

  const targetSvc = await client.messaging.v1.services(targetSvcSid).fetch();
  const already = await client.messaging.v1.services(targetSvcSid).phoneNumbers.list({ limit: 20 });
  if (already.some((s) => s.phoneNumber === phoneNumber)) {
    console.log(`Already a sender in ${targetSvcSid} (${targetSvc.friendlyName}). Nothing to do.`);
    return;
  }

  await client.messaging.v1
    .services(targetSvcSid)
    .phoneNumbers.create({ phoneNumberSid: ipn.sid });

  console.log(`\nAttached ${phoneNumber} to ${targetSvcSid} (${targetSvc.friendlyName}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
