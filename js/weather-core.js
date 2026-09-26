export const TIMEZONE = 'Asia/Manila';
export const LOCATION = 'davao-del-sur';
export const VERSION = 1;
export const CONDITIONS = {
  sunny: 'Sunny', cloudy: 'Cloudy', rainy: 'Rainy',
  'heavy-rain': 'Heavy Rain', 'heavy-rain-thunder': 'Heavy Rain with Thunder',
};
export const PERIODS = [
  { id: 'midnight', label: 'Midnight', start: 0, end: 6, time: '12 AM – 6 AM' },
  { id: 'morning', label: 'Morning', start: 6, end: 11, time: '6 AM – 11 AM' },
  { id: 'lunch', label: 'Lunch', start: 11, end: 13, time: '11 AM – 1 PM' },
  { id: 'afternoon', label: 'Afternoon', start: 13, end: 18, time: '1 PM – 6 PM' },
  { id: 'evening', label: 'Evening', start: 18, end: 24, time: '6 PM – 12 AM' },
];
const phFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
export function phNow(now = new Date()) {
  const p = Object.fromEntries(phFormatter.formatToParts(now).map(x => [x.type, x.value]));
  const hour = Number(p.hour);
  return { date: `${p.year}-${p.month}-${p.day}`, hour, period: PERIODS.find(p => hour >= p.start && hour < p.end).id };
}
export function dateWindow(date, count = 7) {
  const start = Date.parse(date + 'T00:00:00+08:00');
  return Array.from({ length: count }, (_, i) => phNow(new Date(start + i * 86400000)).date);
}
export function dayId(date) { return `${LOCATION}_${date}`; }
export function dateText(date, options = {}) {
  return new Intl.DateTimeFormat('en-PH', { timeZone: TIMEZONE, month: 'short', day: 'numeric', ...options }).format(new Date(date + 'T12:00:00+08:00'));
}
function random(seed) {
  let n = 2166136261;
  for (const c of seed) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return () => { n += 0x6D2B79F5; let t = Math.imul(n ^ n >>> 15, 1 | n); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function summarize(periods) {
  const temperatures = PERIODS.map(p => periods[p.id].temperatureC);
  return { minTemperatureC: Math.min(...temperatures), maxTemperatureC: Math.max(...temperatures) };
}
export function generateDay(date, version = VERSION) {
  if (version !== VERSION) throw new Error('Unsupported weather generator version.');
  const rand = random(`${LOCATION}:${date}:${version}`);
  const base = 24 + Math.round(rand() * 3);
  const offsets = [0, 2, 4, 3, 1];
  const periods = {};
  const ids = Object.keys(CONDITIONS);
  PERIODS.forEach((p, i) => {
    const roll = rand();
    let condition = ids[roll < .28 ? 0 : roll < .58 ? 1 : roll < .8 ? 2 : roll < .94 ? 3 : 4];
    if ((p.start < 6 || p.start >= 18) && condition === 'sunny') condition = 'cloudy';
    const severity = ids.indexOf(condition);
    periods[p.id] = {
      condition, temperatureC: base + offsets[i],
      rainChancePct: Math.min(100, [5, 20, 60, 80, 90][severity] + Math.round(rand() * 10)),
      humidityPct: Math.min(100, 58 + severity * 7 + Math.round(rand() * 10)),
      windKph: Math.round((4 + severity * 4 + rand() * 6) * 10) / 10,
      overridden: false,
    };
  });
  return { schemaVersion: 2, generatorVersion: version, locationCode: LOCATION, locationName: 'Davao del Sur', forecastDate: date, timezone: TIMEZONE, source: 'Simulated weather', isActive: true, periods, ...summarize(periods) };
}
export function validatePeriod(value, periodId) {
  if (!PERIODS.some(p => p.id === periodId) || !Object.hasOwn(CONDITIONS, value.condition)) throw new Error('Choose a valid weather condition.');
  if (['midnight', 'evening'].includes(periodId) && value.condition === 'sunny') throw new Error('Sunny is available only during daytime periods.');
  for (const [key, min, max] of [['temperatureC', 10, 45], ['rainChancePct', 0, 100], ['humidityPct', 0, 100], ['windKph', 0, 150]]) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) throw new Error(`${key} must be between ${min} and ${max}.`);
  }
  return value;
}
export function validDay(day, date = day?.forecastDate) {
  try {
    if (day?.schemaVersion !== 2 || day.locationCode !== LOCATION || day.forecastDate !== date || day.timezone !== TIMEZONE || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    for (const p of PERIODS) validatePeriod(day.periods[p.id], p.id);
    const summary = summarize(day.periods);
    if (day.minTemperatureC !== summary.minTemperatureC || day.maxTemperatureC !== summary.maxTemperatureC) return false;
    return true;
  } catch { return false; }
}
export function applyPeriod(day, periodId, value, reset = false) {
  if (!validDay(day)) throw new Error('This weather record cannot be edited.');
  if (!PERIODS.some(p => p.id === periodId)) throw new Error('Choose a valid period.');
  const next = reset ? generateDay(day.forecastDate, day.generatorVersion).periods[periodId] : { ...validatePeriod(value, periodId), overridden: true };
  const periods = { ...day.periods, [periodId]: next };
  const changed = ['condition', 'temperatureC', 'rainChancePct', 'humidityPct', 'windKph', 'overridden'].some(key => day.periods[periodId][key] !== next[key]);
  return { changed, day: { ...day, periods, ...summarize(periods) } };
}
