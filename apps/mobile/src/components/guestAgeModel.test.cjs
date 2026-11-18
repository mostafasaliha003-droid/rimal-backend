const test = require('node:test');
const assert = require('node:assert/strict');
const { childAgeInput, appendRoomWithSameCounts, isValidChildAge, firstInvalidChildAge } = require('./guestAgeModel.ts');
test('child ages accept zero and Arabic digits but never turn missing or invalid input into an infant age',()=>{assert.equal(childAgeInput('0'),0);assert.equal(childAgeInput('١٥'),15);assert.equal(childAgeInput('۱۷'),17);for(const value of ['', 'abc', '1a','-1','1.5'])assert.equal(childAgeInput(value),'',value);});

test('reusing room counts appends only the selected occupancy with independent blank ages', () => {
  const rooms = [{ adults: 2, children: [5] }, { adults: 4, children: [0, 17, 17] }];
  const next = appendRoomWithSameCounts(rooms, 1);
  assert.equal(next.length, 3);
  assert.equal(rooms.length, 2);
  assert.deepEqual(next[2], { adults: 4, children: ['', '', ''] });
  next[2].children[0] = 8;
  assert.deepEqual(rooms[1].children, [0, 17, 17]);
  assert.deepEqual(firstInvalidChildAge(next), { roomIndex: 2, childIndex: 1 });
});

test('room counts can be reused while ages are pending and for adult-only rooms', () => {
  const rooms = [{ adults: 1, children: [] }, { adults: 6, children: ['', 12, 3, ''] }];
  assert.deepEqual(appendRoomWithSameCounts(rooms, 0).at(-1), { adults: 1, children: [] });
  assert.deepEqual(appendRoomWithSameCounts(rooms, 1).at(-1), { adults: 6, children: ['', '', '', ''] });
  assert.deepEqual(firstInvalidChildAge(rooms), { roomIndex: 1, childIndex: 0 });
});

test('room nine can be added but the maximum or invalid source occupancy cannot append another', () => {
  const eight = Array.from({ length: 8 }, () => ({ adults: 2, children: [2, 3] }));
  const nine = appendRoomWithSameCounts(eight, 7);
  assert.equal(nine.length, 9);
  assert.equal(appendRoomWithSameCounts(nine, 0), nine);
  for (const index of [-1, 0.5, 8, NaN]) assert.equal(appendRoomWithSameCounts(eight, index), eight);
  for (const source of [{ adults: 0, children: [] }, { adults: 7, children: [] },
    { adults: 1.5, children: [] }, { adults: 2, children: [1, 2, 3, 4, 5] }]) {
    const rooms = [source];
    assert.equal(appendRoomWithSameCounts(rooms, 0), rooms);
  }
});

test('validation reports the first missing or invalid age in room and child order', () => {
  for (const age of [0, 1, 16, 17]) assert.equal(isValidChildAge(age), true);
  for (const age of ['', null, '0', -1, 18, 2.5, NaN]) assert.equal(isValidChildAge(age), false);
  const rooms = [{ adults: 2, children: [0, 17] }, { adults: 1, children: [9, '', 18] }];
  assert.deepEqual(firstInvalidChildAge(rooms), { roomIndex: 1, childIndex: 1 });
  rooms[1].children[1] = 15;
  assert.deepEqual(firstInvalidChildAge(rooms), { roomIndex: 1, childIndex: 2 });
  rooms[1].children[2] = 0;
  assert.equal(firstInvalidChildAge(rooms), null);
});
