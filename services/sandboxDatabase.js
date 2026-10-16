function sandboxDatabaseConfigured(env = process.env) {
    const name = env.PAYMENT_SANDBOX_DATABASE || '';
    if (!/^[a-z0-9_-]{1,63}$/i.test(name) || !/(?:sandbox|staging)/i.test(name)) return false;
    try {
        const uri = new URL(env.MONGO_URI);
        return ['mongodb:', 'mongodb+srv:'].includes(uri.protocol) && uri.pathname === `/${name}`;
    } catch { return false; }
}

function sandboxMongoUri(sourceUri, databaseName) {
    let uri;
    try { uri = new URL(sourceUri); } catch { throw new Error('sandbox_database_uri_invalid'); }
    uri.pathname = `/${databaseName}`;
    if (!sandboxDatabaseConfigured({ MONGO_URI: uri.href, PAYMENT_SANDBOX_DATABASE: databaseName })) {
        throw new Error('sandbox_database_name_invalid');
    }
    return uri.href;
}

module.exports = { sandboxDatabaseConfigured, sandboxMongoUri };
