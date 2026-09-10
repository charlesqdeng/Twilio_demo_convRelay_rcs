#!/usr/bin/env node
/**
 * Create a dedicated Messaging Service for the Betwext Conversation AI Demo
 * and point its inbound webhook at NEXT_PUBLIC_APP_URL/api/rcs-inbound. Writes
 * the new SID back to .env.local as TWILIO_MESSAGING_SERVICE_SID.
 *
 * IMPORTANT: this script no longer moves senders. A phone number can only
 * belong to one Messaging Service at a time, so blindly moving a number out of
 * a shared service breaks whoever else was using it. Add a sender manually
 * once the service exists:
 *
 *   npm run add-sender -- +1XXXXXXXXXX
 *
 * ...or via the Twilio Console. Only add numbers that are not already in
 * another team member's Messaging Service.
 *
 * Run: npm run provision-msg
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
const NEW_SERVICE_FRIENDLY_NAME = 'Betwext Conversation AI Demo';

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) throw new Error('.env.local not found');
  const text = fs.readFileSync(ENV_PATH, 'utf-8');
  const env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
  return env;
}

function writeEnvUpdate(key, value) {
  const text = fs.readFileSync(ENV_PATH, 'utf-8');
  const lines = text.split(/\r?\n/);
  let replaced = false;
  const out = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed.startsWith('//')) return line;
    if (trimmed.startsWith(`${key}=`)) {
      replaced = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!replaced) out.push(`${key}=${value}`);
  fs.writeFileSync(ENV_PATH, out.join('\n'));
}

const env = loadEnv();
const accountSid = env.TWILIO_ACCOUNT_SID;
const apiKey = env.TWILIO_API_KEY_SID || env.TWILIO_API_KEY;
const apiSecret = env.TWILIO_API_KEY_SECRET || env.TWILIO_API_SECRET;
const authToken = env.TWILIO_AUTH_TOKEN;
const publicUrl = (env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');

if (!accountSid) exitWith('TWILIO_ACCOUNT_SID is not set in .env.local');
if (!publicUrl) exitWith('NEXT_PUBLIC_APP_URL is not set in .env.local');

function exitWith(msg) {
  console.error(msg);
  process.exit(1);
}

const client =
  apiKey && apiSecret
    ? Twilio(apiKey, apiSecret, { accountSid })
    : Twilio(accountSid, authToken);

const inboundUrl = `${publicUrl}/api/rcs-inbound`;

async function findExistingDemoService() {
  const all = await client.messaging.v1.services.list({ limit: 200 });
  return all.find((s) => s.friendlyName === NEW_SERVICE_FRIENDLY_NAME) ?? null;
}

async function main() {
  console.log(`Public URL              = ${publicUrl}`);
  console.log(`Target inbound URL      = ${inboundUrl}\n`);

  let svc = await findExistingDemoService();
  if (svc) {
    console.log(`Found existing "${NEW_SERVICE_FRIENDLY_NAME}" service ${svc.sid}.`);
    if (svc.inboundRequestUrl !== inboundUrl || svc.inboundMethod !== 'POST') {
      console.log(`Updating inboundRequestUrl → ${inboundUrl}`);
      svc = await client.messaging.v1.services(svc.sid).update({
        inboundRequestUrl: inboundUrl,
        inboundMethod: 'POST',
        useInboundWebhookOnNumber: false,
      });
    }
  } else {
    console.log('Creating dedicated messaging service…');
    svc = await client.messaging.v1.services.create({
      friendlyName: NEW_SERVICE_FRIENDLY_NAME,
      inboundRequestUrl: inboundUrl,
      inboundMethod: 'POST',
      useInboundWebhookOnNumber: false,
    });
    console.log(`  created ${svc.sid}`);
  }

  writeEnvUpdate('TWILIO_MESSAGING_SERVICE_SID', svc.sid);
  console.log(`\nWrote TWILIO_MESSAGING_SERVICE_SID=${svc.sid} to .env.local`);

  const senders = await client.messaging.v1.services(svc.sid).phoneNumbers.list({ limit: 20 });
  console.log('\nCurrent senders in this service:');
  if (senders.length === 0) {
    console.log('  (none — add one before sending will work)');
    console.log('\nNext step: assign a phone number that is NOT already in another team member\'s service.');
    console.log('Either use the Twilio Console, or run:');
    console.log('  npm run add-sender -- +1XXXXXXXXXX');
  } else {
    for (const s of senders) console.log(`  ${s.phoneNumber}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
