#!/usr/bin/env node
/**
 * Create (or refresh) a Twilio TwiML App for this project and write its SID
 * into .env.local. Points its Voice URL at NEXT_PUBLIC_APP_URL/api/voice.
 *
 * Run: npm run provision-twiml
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
const APP_FRIENDLY_NAME = 'Betwext Conversation AI Demo';

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

if (!accountSid) {
  console.error('TWILIO_ACCOUNT_SID is not set in .env.local');
  process.exit(1);
}
if (!publicUrl) {
  console.error('NEXT_PUBLIC_APP_URL is not set in .env.local');
  process.exit(1);
}

const client =
  apiKey && apiSecret
    ? Twilio(apiKey, apiSecret, { accountSid })
    : Twilio(accountSid, authToken);

const voiceUrl = `${publicUrl}/api/voice`;
const existingSid = env.TWILIO_TWIML_APP_SID?.trim();

async function main() {
  if (existingSid) {
    try {
      const app = await client.applications(existingSid).fetch();
      console.log(`Found existing TwiML App ${existingSid} (${app.friendlyName}).`);
      if (app.voiceUrl !== voiceUrl || app.voiceMethod !== 'POST') {
        console.log(`Updating voiceUrl → ${voiceUrl}`);
        await client.applications(existingSid).update({ voiceUrl, voiceMethod: 'POST' });
      }
      console.log('Done.');
      return;
    } catch (err) {
      console.warn(`Existing SID ${existingSid} not usable (${err.status ?? ''} ${err.message ?? err}). Creating a fresh one…`);
    }
  }

  const created = await client.applications.create({
    friendlyName: APP_FRIENDLY_NAME,
    voiceUrl,
    voiceMethod: 'POST',
  });
  console.log(`Created TwiML App ${created.sid}`);
  console.log(`  friendlyName = ${created.friendlyName}`);
  console.log(`  voiceUrl     = ${created.voiceUrl}`);
  writeEnvUpdate('TWILIO_TWIML_APP_SID', created.sid);
  console.log(`Wrote TWILIO_TWIML_APP_SID=${created.sid} to .env.local`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
