const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

// CRED_KEY: 32 raw bytes, base64, set as a Netlify env var (never committed).
const key = () => {
  const k = process.env.CRED_KEY;
  if (!k) throw Object.assign(new Error('CRED_KEY is not configured.'), { status: 500 });
  return Buffer.from(k, 'base64');
};

const seal = (obj) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map(b => b.toString('base64')).join('.');
};

const openSealed = (s) => {
  const [iv, tag, body] = s.split('.').map(p => Buffer.from(p, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
};

// Blobs normally configures itself from the Netlify runtime. On some deploys (classic
// bundled functions, local runs) that injection is missing and getStore throws
// "The environment has not been configured to use Netlify Blobs" — so fall back to an
// explicit siteID/token pair from env vars.
const siteID = () => process.env.NETLIFY_SITE_ID || process.env.SITE_ID || process.env.NETLIFY_BLOBS_SITE_ID;
const token = () => process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;

const store = (name) => {
  try {
    return getStore(name);
  } catch (e) {
    const id = siteID(), tk = token();
    if (id && tk) return getStore({ name, siteID: id, token: tk });
    throw Object.assign(new Error(
      'Storage is not configured. Add env vars NETLIFY_SITE_ID (Site configuration → General → Site ID) ' +
      'and NETLIFY_API_TOKEN (User settings → Applications → personal access token), then redeploy.'
    ), { status: 500 });
  }
};

const creds = () => store('creds');
const prefs = () => store('prefs');

// creds/<userId>/<platform>  -> sealed credential blob
exports.putCreds = (userId, platform, obj) =>
  creds().set(userId + '/' + platform, seal(obj));

exports.getCreds = async (userId, platform) => {
  const raw = await creds().get(userId + '/' + platform);
  if (!raw) throw Object.assign(new Error(platform + ' is not linked.'), { status: 409 });
  return openSealed(raw);
};

exports.dropCreds = (userId, platform) => creds().delete(userId + '/' + platform);

// prefs/<userId> -> { leagues: [{ platform, leagueId, teamId, leagueName, teamName, season }], hidden: [] }
exports.getPrefs = async (userId) => {
  const p = await prefs().get(userId, { type: 'json' });
  return p || { leagues: [], hidden: [] };
};

exports.putPrefs = (userId, p) => prefs().setJSON(userId, p);
