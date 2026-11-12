import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRatehawkDateTime, formatRatehawkDateTime } from './ratehawkDateTime.js';

test('offsetless ETG cancellation deadlines stay in UTC in every customer timezone', () => {
    const original = process.env.TZ;
    try {
        for (const zone of ['Asia/Dubai', 'America/Los_Angeles', 'Europe/Madrid']) {
            process.env.TZ = zone;
            assert.equal(parseRatehawkDateTime('2026-10-25T14:00:00').toISOString(), '2026-10-25T14:00:00.000Z');
            const display = formatRatehawkDateTime('2026-10-25T14:00:00', 'en-GB');
            assert.match(display, /14:00:00 UTC\+0$/);
        }
    } finally {
        if (original === undefined) delete process.env.TZ;
        else process.env.TZ = original;
    }
});

test('explicit offsets convert to labelled UTC and invalid deadlines remain unknown', () => {
    assert.equal(parseRatehawkDateTime('2026-10-25T18:00:05+04:00').toISOString(), '2026-10-25T14:00:05.000Z');
    assert.match(formatRatehawkDateTime('2026-10-25T14:00:05Z', 'en-GB'), /14:00:05 UTC\+0$/);
    for (const value of [undefined, '', 'invalid', 123, '2026-10-25', '2026-02-30T14:00:00', '2026-10-25T24:00:00']) assert.equal(formatRatehawkDateTime(value), '');
});
