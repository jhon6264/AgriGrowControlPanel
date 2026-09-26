import test from 'node:test';
import assert from 'node:assert/strict';
import { phNow, dateWindow, generateDay, PERIODS, validDay, applyPeriod, dayId } from '../js/weather-core.js';
import { createWeatherStore, readCache, writeCache, CACHE_KEY } from '../js/weather-store.js';

test('Philippine period boundaries are independent of device timezone', () => {
  for (const [time, period] of [['00:00','midnight'],['05:59','midnight'],['06:00','morning'],['10:59','morning'],['11:00','lunch'],['12:59','lunch'],['13:00','afternoon'],['17:59','afternoon'],['18:00','evening'],['23:59','evening']]) {
    assert.equal(phNow(new Date(`2026-09-26T${time}:00+08:00`)).period, period);
  }
  assert.deepEqual(phNow(new Date('2026-12-31T16:00:00Z')), {date:'2027-01-01',hour:0,period:'midnight'});
  assert.equal(phNow(new Date('2026-09-26T23:00:00-07:00')).date, '2026-09-27');
});
test('seven dates cross month, leap day, and year boundaries; resume skips expired dates', () => {
  assert.deepEqual(dateWindow('2026-12-29'), ['2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03','2027-01-04']);
  assert.equal(dateWindow('2028-02-27')[2], '2028-02-29');
  assert.equal(dateWindow('2026-09-29')[2], '2026-10-01');
  assert.equal(dateWindow(phNow(new Date('2026-10-04T16:00:00Z')).date)[0], '2026-10-05');
});
test('deterministic bounded generation has five periods, gentle temperatures, no nighttime sun', () => {
  for (const date of dateWindow('2026-01-01', 365)) {
    const day = generateDay(date);
    assert.deepEqual(day, generateDay(date)); assert.ok(validDay(day));
    assert.equal(Object.keys(day.periods).length, 5);
    assert.notEqual(day.periods.midnight.condition, 'sunny'); assert.notEqual(day.periods.evening.condition, 'sunny');
    const temps = PERIODS.map(p => day.periods[p.id].temperatureC);
    assert.equal(day.minTemperatureC, Math.min(...temps)); assert.equal(day.maxTemperatureC, Math.max(...temps));
    temps.slice(1).forEach((temp, i) => assert.ok(Math.abs(temp - temps[i]) <= 2));
  }
});
test('overrides recalculate extremes; reset restores exact generated period; invalid input rejected', () => {
  const day = generateDay('2026-09-26');
  const edited = applyPeriod(day, 'afternoon', { ...day.periods.afternoon, temperatureC: 40 });
  assert.equal(edited.day.maxTemperatureC, 40); assert.equal(edited.day.periods.afternoon.overridden, true);
  assert.equal(applyPeriod(edited.day, 'afternoon', edited.day.periods.afternoon).changed, false);
  assert.deepEqual(applyPeriod(edited.day, 'afternoon', null, true).day, day);
  assert.equal(applyPeriod(day, 'afternoon', null, true).changed, false);
  assert.throws(() => applyPeriod(day,'midnight',{...day.periods.midnight,condition:'sunny'}));
  assert.throws(() => applyPeriod(day,'morning',{...day.periods.morning,temperatureC:NaN}));
  assert.throws(() => applyPeriod(day,'invalid',null,true));
});

// Optimistic transaction adapter: overlapping reads retry after a competing commit.
function memoryDatabase() {
  const docs = new Map([['legacy', { condition:'Rainy',forecastDate:'2025-01-01' }]]);
  let version = 0, revision = 0, retries = 0;
  return { docs, get revision(){return revision;}, get retries(){return retries;},
    get: async id => structuredClone(docs.get(id) ?? null),
    async transaction(callback) {
      for (;;) {
        const start = version, writes = new Map(); let bump = false;
        const result = await callback({
          get: async id => structuredClone(docs.get(id) ?? null),
          create: (id, data) => writes.set(id, structuredClone(data)),
          update: (id, data) => writes.set(id, structuredClone(data)),
          bump: () => { bump = true; },
        });
        if (start !== version) { retries++; continue; }
        for (const [id,data] of writes) docs.set(id,data);
        if (writes.size) version++;
        if (bump) revision++;
        return result;
      }
    },
  };
}
test('simultaneous tabs create seven documents once, preserve edits and legacy docs, fill only gaps', async () => {
  const db = memoryDatabase(), store = createWeatherStore(db);
  await Promise.all([store.ensureWindow('2026-09-26'), store.ensureWindow('2026-09-26')]);
  assert.equal(db.docs.size,8); assert.equal(db.revision,1); assert.ok(db.retries > 0);
  const day = db.docs.get(dayId('2026-09-26'));
  await store.edit(day.forecastDate,'morning',{...day.periods.morning,temperatureC:38});
  await store.ensureWindow('2026-09-26'); assert.equal(db.revision,2);
  assert.equal(db.docs.get(dayId(day.forecastDate)).periods.morning.temperatureC,38);
  await store.ensureWindow('2026-09-27'); assert.equal(db.revision,3); assert.equal(db.docs.size,9);
  assert.deepEqual(db.docs.get('legacy'),{condition:'Rainy',forecastDate:'2025-01-01'});
});
test('concurrent edits to different periods survive; reset and unchanged reset revise correctly', async () => {
  const db=memoryDatabase(), store=createWeatherStore(db); await store.ensureWindow('2026-09-26');
  const day=db.docs.get(dayId('2026-09-26'));
  await Promise.all(['morning','afternoon'].map(p=>store.edit(day.forecastDate,p,{...day.periods[p],temperatureC:40})));
  assert.equal(db.docs.get(dayId(day.forecastDate)).periods.morning.temperatureC,40);
  assert.equal(db.docs.get(dayId(day.forecastDate)).periods.afternoon.temperatureC,40);
  assert.equal(db.revision,3);
  await store.edit(day.forecastDate,'afternoon',null,true); assert.equal(db.revision,4);
  await store.edit(day.forecastDate,'afternoon',null,true); assert.equal(db.revision,4);
});
test('transaction failures reject without fabricated saved data; corrupt/blocked cache is safe', async () => {
  const failed=createWeatherStore({transaction:async()=>{throw new Error('permission-denied');}});
  await assert.rejects(failed.ensureWindow('2026-09-26'),/permission-denied/);
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  const days=dateWindow('2026-09-26').map(d=>generateDay(d));
  assert.ok(writeCache(storage,days,123)); assert.deepEqual(readCache(storage),{days,loadedAt:123});
  values.set(CACHE_KEY,'corrupt'); assert.equal(readCache(storage),null);
  assert.equal(writeCache(null,days),false); assert.equal(readCache(null),null);
});
