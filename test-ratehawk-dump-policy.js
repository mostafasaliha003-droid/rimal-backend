const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { gzipSync } = require('node:zlib');
const { randomUUID } = require('node:crypto');
const { approvedHosts, assertPublicDumpUrl, isPublicAddress, createPublicLookup } = require('./services/ratehawkDumpDownloadPolicy');

const hosts = ['downloads.example.com'];
test('dump destination policy rejects unexpected hosts, credentials, ports, IP literals and private names', () => {
    assert.equal(assertPublicDumpUrl('https://downloads.example.com/file?signature=fixture', hosts).hostname, hosts[0]);
    for (const url of ['http://downloads.example.com/file', 'https://user:password@downloads.example.com/file',
        'https://downloads.example.com:444/file', 'https://unexpected.example.com/file',
        'https://127.0.0.1/file', 'https://[::1]/file', 'https://downloads.example.com./file']) {
        assert.throws(() => assertPublicDumpUrl(url, hosts), /destination_forbidden/);
    }
    for (const names of [[], ['127.0.0.1'], ['localhost'], ['storage.local'], ['server.internal'], ['*.example.com']]) {
        assert.throws(() => approvedHosts(names), /destination_forbidden/);
    }
});

test('public address checks cover IPv4, IPv6, mapped and private or reserved addresses', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublicAddress(ip), true, ip);
    for (const ip of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.1.1', '192.168.0.1',
        '100.64.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1',
        '::', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1', '2001:db8::1', '2001:0db8::1', 'invalid']) {
        assert.equal(isPublicAddress(ip), false, ip);
    }
});

test('HTTPS lookup supports Node dual-stack all:true shape and rejects every mixed public/private response', async () => {
    const rows = [{ address: '1.1.1.1', family: 4 }, { address: '2606:4700:4700::1111', family: 6 }];
    const lookup = createPublicLookup(hosts, (host, options, callback) => {
        assert.equal(host, hosts[0]); assert.equal(options.all, true); callback(null, rows);
    });
    const all = await new Promise((resolve, reject) => lookup(hosts[0], { all: true }, (error, result) => error ? reject(error) : resolve(result)));
    assert.deepEqual(all, rows);
    const first = await new Promise((resolve, reject) => lookup(hosts[0], {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
    assert.deepEqual(first, rows[0]);
    for (const privateIp of ['127.0.0.1', 'fd00::1']) {
        const unsafe = createPublicLookup(hosts, (host, options, callback) => callback(null, [...rows, { address: privateIp, family: privateIp.includes(':') ? 6 : 4 }]));
        await assert.rejects(new Promise((resolve, reject) => unsafe(hosts[0], { all: true }, error => error ? reject(error) : resolve())), /destination_forbidden/);
    }
});

test('guarded download disables redirects and leaves an owned Mongo connection untouched', async context => {
    const axios = require('axios'), mongoose = require('mongoose');
    const { syncDump } = require('./services/hotelDumpSyncService');
    const connect = context.mock.method(mongoose, 'connect', async () => { throw new Error('unexpected global Mongo connection'); });
    const close = context.mock.method(mongoose.connection, 'close', async () => { throw new Error('unexpected global Mongo close'); });
    context.mock.method(axios, 'get', async (url, options) => {
        assert.equal(options.maxRedirects, 0); assert.equal(options.proxy, false);
        assert.equal(options.validateStatus(302), false);
        assert.equal(typeof options.httpsAgent.options.lookup, 'function');
        return { data: Readable.from([gzipSync(Buffer.from('{"id":123}\n'))]) };
    });
    let writes = 0;
    const result = await syncDump({ name: `download-policy-fixture-${randomUUID()}`,
        getUrl: async () => 'https://downloads.example.com/region.gz', compression: 'gzip',
        manageConnection: false, downloadPolicy: { allowedHosts: hosts },
        operationFactory: row => ({ updateOne: { filter: { id: row.id } } }),
        model: { bulkWrite: async () => { writes++; return { upsertedCount: 1 }; } } });
    assert.equal(result.upserted, 1); assert.equal(writes, 1);
    assert.equal(connect.mock.callCount(), 0); assert.equal(close.mock.callCount(), 0);
});
