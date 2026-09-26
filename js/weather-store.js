import { applyPeriod, dateWindow, dayId, generateDay, validDay } from './weather-core.js';

// The adapter keeps transaction logic independently testable without a live database.
export function createWeatherStore(adapter) {
  return {
    async ensureWindow(date) {
      const dates = dateWindow(date);
      await adapter.transaction(async tx => {
        const records = await Promise.all(dates.map(d => tx.get(dayId(d))));
        let changed = false;
        dates.forEach((d, i) => {
          if (records[i] != null) return; // Includes legacy or unsupported records: never overwrite.
          tx.create(dayId(d), generateDay(d));
          changed = true;
        });
        if (changed) tx.bump();
      });
      const records = await Promise.all(dates.map(d => adapter.get(dayId(d))));
      return records.filter((day, i) => validDay(day, dates[i]));
    },
    async edit(date, period, value, reset = false) {
      return adapter.transaction(async tx => {
        const current = await tx.get(dayId(date));
        const result = applyPeriod(current, period, value, reset);
        if (result.changed) { tx.update(dayId(date), result.day); tx.bump(); }
        return result.changed;
      });
    },
  };
}

export const CACHE_KEY = 'agrigrow.weather.window.v2';
export function readCache(storage) {
  try {
    const cache = JSON.parse(storage.getItem(CACHE_KEY));
    if (!Array.isArray(cache?.days) || !Number.isFinite(cache.loadedAt)) return null;
    return { ...cache, days: cache.days.filter(day => validDay(day)) };
  } catch { return null; }
}
export function writeCache(storage, days, loadedAt = Date.now()) {
  try { storage.setItem(CACHE_KEY, JSON.stringify({ days, loadedAt })); return true; }
  catch { return false; }
}
