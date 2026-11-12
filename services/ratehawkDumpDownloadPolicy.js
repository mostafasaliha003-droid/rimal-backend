const dns = require('node:dns');
const net = require('node:net');
const https = require('node:https');

function fail() { return Object.assign(new Error('static_sync_dump_destination_forbidden'), { code: 'static_sync_dump_destination_forbidden' }); }
function approvedHosts(values) {
    if (!Array.isArray(values) || !values.length) throw fail();
    const hosts = values.map(value => String(value).trim().toLowerCase());
    if (hosts.some(host => !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)
        || net.isIP(host) || /(?:^|\.)(?:localhost|local|internal|onion)$/.test(host)
        || host.endsWith('.home.arpa'))) throw fail();
    return [...new Set(hosts)];
}
function assertPublicDumpUrl(value, values) {
    const hosts = approvedHosts(values);
    let url;
    try { url = new URL(value); } catch { throw fail(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash
        || !hosts.includes(url.hostname.toLowerCase()) || net.isIP(url.hostname.replace(/^\[|\]$/g, ''))) throw fail();
    return url;
}
function isPublicAddress(address) {
    if (net.isIP(address) === 4) {
        const [a, b, c] = address.split('.').map(Number);
        return a !== 0 && a !== 10 && a !== 127 && a < 224
            && !(a === 100 && b >= 64 && b <= 127) && !(a === 169 && b === 254)
            && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168)
            && !(a === 192 && b === 0) && !(a === 198 && (b === 18 || b === 19))
            && !(a === 198 && b === 51 && c === 100) && !(a === 203 && b === 0 && c === 113);
    }
    if (net.isIP(address) === 6) {
        // Only global unicast addresses are eligible. This excludes loopback,
        // unspecified, link-local, unique-local, multicast and IPv4-mapped forms.
        if (!/^[23][a-f\d]{3}:/i.test(address)) return false;
        const prefix = address.toLowerCase().split(':').map(value => Number.parseInt(value || '0', 16));
        if (prefix[0] === 0x2001 && [0xdb8, 0, 0x10, 0x20, 2].includes(prefix[1])) return false;
        if (prefix[0] === 0x2002) return false;
        return true;
    }
    return false;
}
function createPublicLookup(values, resolver = dns.lookup) {
    const hosts = approvedHosts(values);
    return (hostname, options, callback) => {
        if (!hosts.includes(String(hostname).toLowerCase())) { callback(fail()); return; }
        resolver(hostname, { all: true, verbatim: true }, (error, addresses) => {
            if (error) { callback(error); return; }
            if (!Array.isArray(addresses) || !addresses.length || addresses.some(row => !isPublicAddress(row.address))) {
                callback(fail()); return;
            }
            if (options?.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
        });
    };
}
function guardedDownloadOptions(url, values) {
    assertPublicDumpUrl(url, values);
    return { maxRedirects: 0, proxy: false,
        httpsAgent: new https.Agent({ lookup: createPublicLookup(values) }) };
}

module.exports = { approvedHosts, assertPublicDumpUrl, isPublicAddress, createPublicLookup, guardedDownloadOptions };
