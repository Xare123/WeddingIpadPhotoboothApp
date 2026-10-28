import test from 'node:test';
import assert from 'node:assert/strict';
import { editPhone } from '../src/phone-pad';
import { normalizePhone } from '../src/sharing';
test('pad inserts at caret and replaces/deletes selected digits', () => {
 assert.deepEqual(editPhone('2025550123',3,3,'9'),{value:'20295550123',caret:4});
 assert.deepEqual(editPhone('2025550123',3,6,'⌫'),{value:'2020123',caret:3});
 assert.deepEqual(editPhone('2025550123',0,0,'⌫'),{value:'2025550123',caret:0});
 assert.deepEqual(editPhone('2025550123',3,6,'8'),{value:'20280123',caret:4});
});
test('paste and padded US formats keep existing normalization', () => {
 for (const value of ['2025550123','(202) 555-0123','1 202 555 0123','+1 (202) 555-0123']) assert.equal(normalizePhone(value),'+12025550123');
});
