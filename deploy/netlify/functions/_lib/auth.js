// App-level account gate. The app keeps accounts on the device (any username, any
// password) and names the caller in the x-efl-user header; that name is the storage
// key for their leagues and credentials. A Netlify Identity session, if one happens
// to be present, is honoured too.
exports.requireUser = (context, event) => {
  const idn = context && context.clientContext && context.clientContext.user;
  if (idn) return { id: idn.sub, email: idn.email };
  const h = (event && event.headers) || {};
  const raw = String(h['x-efl-user'] || h['X-Efl-User'] || '').trim();
  if (!raw) {
    const e = new Error('Not signed in.');
    e.status = 401;
    throw e;
  }
  return { id: 'u_' + raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '_').slice(0, 64), email: raw };
};

exports.json = (status, body) => ({
  statusCode: status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body)
});

exports.fail = (e) => exports.json(e.status || 500, { error: e.message || 'Server error.' });
