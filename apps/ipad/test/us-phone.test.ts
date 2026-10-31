import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePhone } from '../src/sharing';

test('ordinary U.S. phone formats normalize to the same E.164 recipient', () => {
  for (const input of [
    '2025550123', '(202)555-0123', '(202) 555-0123',
    '202-555-0123', '202 555 0123', '202.555.0123',
    '12025550123', '1 (202) 555-0123', '+12025550123', '+1 (202) 555-0123',
    '  (202) 555-0123  ',
  ]) assert.equal(normalizePhone(input), '+12025550123', input);
});

test('phone normalization rejects extensions, letters, non-US prefixes and invalid lengths', () => {
  for (const input of [
    '', '202555012', '20255501234', '22025550123', '+2025550123',
    '+44 20 7946 0958', '+1 202 555 012', '+1 202 555 01234',
    '202-555-0123 x9', '202-555-0123 ext. 9', '202-555-0123#9',
    '202-ABC-0123', '202/555/0123', '++12025550123', '1+2025550123',
    '1025550123', '2021550123', '２０２５５５０１２３',
  ]) assert.throws(() => normalizePhone(input), /10-digit U\.S\. phone number/, input);
});
