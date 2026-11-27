/* global __dirname */
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const load = require('../../scripts/test-support/load-typescript.cjs');
const { arabicRoomName, localizedRoomName, localizedBedding } = load(path.resolve(__dirname, './roomNameModel.ts'));

test('real RateHawk room names read naturally in Arabic with gender agreement', () => {
  const cases = {
    'Standard Double room (full double bed)': 'غرفة قياسية مزدوجة (سرير مزدوج)',
    'Superior Double room (2 single beds)': 'غرفة سوبيريور مزدوجة (سريران منفردان)',
    'Junior Suite (full double bed) (king size bed)': 'جناح جونيور (سرير مزدوج، سرير كينج)',
    'Junior Suite (smoking, bed type is subject to availability)': 'جناح جونيور (للمدخنين، نوع السرير حسب التوفر)',
    'Standard Double room with balcony and with river view (full double bed)': 'غرفة قياسية مزدوجة مع شرفة وإطلالة على النهر (سرير مزدوج)',
    'Studio Room (shared bathroom) (sofa bed and single bed)': 'استوديو (حمام مشترك، أريكة سرير وسرير منفرد)',
    'Pool view Double room (2 single beds)': 'غرفة مزدوجة مع إطلالة على المسبح (سريران منفردان)',
    '1 Bedroom Double Suite (full double bed)': 'جناح مزدوج بغرفة نوم واحدة (سرير مزدوج)',
    '2 Bedrooms Double Apartment with sea view (2 single beds)': 'شقة مزدوجة بغرفتي نوم مع إطلالة على البحر (سريران منفردان)',
    'Double Suite beachfront (full double bed)': 'جناح مزدوج على الشاطئ (سرير مزدوج)',
    '1 Bedroom Premium Waterfront Double Apartment (full double bed)': 'شقة مميزة مزدوجة بغرفة نوم واحدة على الواجهة المائية (سرير مزدوج)',
    'Classic Double Studio (full double bed)': 'استوديو كلاسيكي مزدوج (سرير مزدوج)',
    'Avani Executive Double Suite (full double bed)': 'جناح Avani تنفيذي مزدوج (سرير مزدوج)',
    'Premium Sky Club Access Double room (full double bed)': 'غرفة Sky مميزة مزدوجة مع دخول إلى صالة النادي (سرير مزدوج)',
    'Double Apartment with balcony and with view (full double bed)': 'شقة مزدوجة مع شرفة وإطلالة (سرير مزدوج)',
    'Standard Double room with water view': 'غرفة قياسية مزدوجة مع إطلالة على الماء',
    'Junior Suite': 'جناح جونيور',
    'Family room (3 single beds)': 'غرفة عائلية (3 أسرّة منفردة)',
  };
  for (const [english, arabic] of Object.entries(cases)) assert.equal(arabicRoomName(english), arabic, english);
});

test('names with any unknown part stay in the supplier wording instead of mixing languages', () => {
  for (const name of ['Room with a unique hammock experience', 'Deluxe room (ask the front desk for details)', 'Ocean Breeze Lagoon Hideaway room', '']) {
    assert.equal(arabicRoomName(name), null, name);
  }
  assert.equal(localizedRoomName('Room with a unique hammock experience', 'ar'), 'Room with a unique hammock experience');
  assert.equal(localizedRoomName('Standard Double room', 'en'), 'Standard Double room');
  assert.equal(localizedRoomName('Standard Double room', 'ar'), 'غرفة قياسية مزدوجة');
  assert.equal(arabicRoomName('جناح ملكي'), 'جناح ملكي', 'already Arabic');
});

test('RateHawk bed lines read in Arabic only when every part is understood', () => {
  assert.equal(localizedBedding('full double bed', 'ar'), 'سرير مزدوج');
  assert.equal(localizedBedding('2 single beds, sofa bed', 'ar'), 'سريران منفردان، أريكة سرير');
  assert.equal(localizedBedding('Full Double Bed', 'ar'), 'سرير مزدوج');
  assert.equal(localizedBedding('full double bed', 'en'), 'full double bed');
  assert.equal(localizedBedding('full double bed, murphy bed', 'ar'), 'full double bed, murphy bed', 'Never half-translated');
  assert.equal(localizedBedding('سرير مزدوج', 'ar'), 'سرير مزدوج');
});
