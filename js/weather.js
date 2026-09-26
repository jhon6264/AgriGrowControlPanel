import { doc, getDocFromServer, runTransaction, increment, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { TIMEZONE, CONDITIONS, PERIODS, phNow, dateWindow, dateText } from './weather-core.js';
import { createWeatherStore, readCache, writeCache } from './weather-store.js';
import { renderWeatherArt } from './weather-art.js';

export function initWeather(db, notify, onData = () => {}) {
  const el = id => document.getElementById(id);
  const stamp = value => value?.toMillis?.() ?? value ?? null;
  const decode = snapshot => snapshot.exists() ? { ...snapshot.data(), updatedAt: stamp(snapshot.data().updatedAt), createdAt: stamp(snapshot.data().createdAt) } : null;
  const ref = id => doc(db, 'weatherRecords', id);
  const store = createWeatherStore({
    get: async id => decode(await getDocFromServer(ref(id))),
    transaction: callback => runTransaction(db, async transaction => callback({
      get: async id => decode(await transaction.get(ref(id))),
      create: (id, data) => transaction.set(ref(id), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
      update: (id, data) => transaction.update(ref(id), { periods: data.periods, minTemperatureC: data.minTemperatureC, maxTemperatureC: data.maxTemperatureC, updatedAt: serverTimestamp() }),
      bump: () => transaction.set(doc(db, 'contentVersions', 'weather'), { revision: increment(1), updatedAt: serverTimestamp() }, { merge: true }),
    })),
  });
  let storage;
  try { storage = window.localStorage; } catch { storage = null; }
  const cached = readCache(storage);
  let days = cached?.days || [], loadedAt = cached?.loadedAt, stale = true, error = '', inFlight, saving = false;
  let current = phNow(), selectedDate = current.date, selectedPeriod = current.period, follow = true, editTarget;
  const modal = new bootstrap.Modal(el('weather-modal'));
  const form = el('weather-edit-form');
  const clockFormat = new Intl.DateTimeFormat('en-PH', { timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const updatedFormat = new Intl.DateTimeFormat('en-PH', { timeZone: TIMEZONE, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const updated = time => time ? updatedFormat.format(new Date(time)) + ' PHT' : 'Unknown';
  const art = renderWeatherArt;

  let swapping = false, deferredRender = false;
  function render(force = false) {
    if (swapping && !force) { deferredRender = true; return; }
    deferredRender = false;
    current = phNow();
    const dates = dateWindow(current.date);
    if (!dates.includes(selectedDate)) { selectedDate = current.date; follow = true; }
    if (follow && selectedDate === current.date) selectedPeriod = current.period;
    onData({ days, loadedAt, stale: stale || !navigator.onLine, error });
    const day = days.find(day => day.forecastDate === selectedDate);
    const p = day?.periods[selectedPeriod];
    el('weather-status').textContent = error || (!navigator.onLine ? loadedAt ? `Offline · Cached ${updated(loadedAt)}` : 'Offline · No cached weather available' : stale ? loadedAt ? `Cached ${updated(loadedAt)} · Checking for updates…` : 'Loading simulated weather…' : `Updated ${updated(loadedAt)}`);
    el('weather-status').classList.toggle('weather-warning', !!error || !navigator.onLine);
    el('weather-main').innerHTML = `
      <div class="weather-card-heading"><h2>${selectedDate === current.date ? 'Today, ' : ''}${dateText(selectedDate, { weekday: 'long', year: 'numeric' })}</h2><div class="weather-card-actions"><button class="weather-text-button" data-weather-action="now" ${selectedDate !== current.date || follow ? 'hidden' : ''}>Now</button></div></div>
      ${p ? `<div class="weather-current"><div class="weather-illustration">${art(p.condition, true)}</div><div class="weather-reading"><p class="weather-period-label">${PERIODS.find(x => x.id === selectedPeriod).label}${follow && selectedDate === current.date ? ' · Now' : ''}</p><h3>${CONDITIONS[p.condition]}</h3><div class="weather-temperature">${p.temperatureC}<span>°C</span></div><p class="weather-range">Low ${day.minTemperatureC}°C <span> / </span> High ${day.maxTemperatureC}°C</p></div><dl class="weather-metrics"><div><dt>Rain chance</dt><dd>${p.rainChancePct}%</dd></div><div><dt>Humidity</dt><dd>${p.humidityPct}%</dd></div><div><dt>Wind</dt><dd>${p.windKph} <small>km/h</small></dd></div></dl></div>` : '<div class="weather-unavailable">Weather unavailable for this date.<br><small>Connect to load and generate missing days.</small></div>'}
      <div class="weather-periods" aria-label="Weather periods">${PERIODS.map(period => `<button type="button" data-period="${period.id}" aria-pressed="${period.id === selectedPeriod}" class="${period.id === selectedPeriod ? 'selected' : ''}"><strong>${period.label}</strong><small>${period.time}</small></button>`).join('')}</div>
      <div class="weather-card-footer"><span>${day ? `${p?.overridden ? 'Admin override · ' : ''}Saved ${updated(day.updatedAt)}` : ''}</span><span>Philippine time · UTC+8</span></div>`;
    el('weather-upcoming').innerHTML = dates.slice(1).map(slot => {
      const date = slot === selectedDate ? current.date : slot;
      const day = days.find(day => day.forecastDate === date), p = day?.periods[date === current.date ? current.period : 'afternoon'];
      return `<button class="weather-day ${selectedDate === date ? 'selected' : ''}" type="button" data-date="${date}" data-slot="${slot}"><span class="weather-day-name">${date === current.date ? 'Today · ' : ''}${dateText(date, { weekday: 'short' })}</span>${p ? art(p.condition, true) : '<span class="weather-art weather-missing" aria-hidden="true">—</span>'}<strong>${p ? CONDITIONS[p.condition] : 'Unavailable'}</strong><span>${p ? `${day.minTemperatureC}° / ${day.maxTemperatureC}°C` : 'Connect to load'}</span></button>`;
    }).join('');
    el('weather-main').classList.toggle('viewing-future', selectedDate !== current.date);
  }

  async function refresh() {
    if (inFlight) return inFlight;
    if (!navigator.onLine) { stale = true; error = ''; render(); return; }
    inFlight = (async () => {
      try {
        let date, records;
        do { date = phNow().date; records = await store.ensureWindow(date); }
        while (date !== phNow().date); // A slow request may cross Philippine midnight.
        days = records; loadedAt = Date.now(); stale = false;
        error = records.length < 7 ? 'Some dates are unavailable because their saved records use an unsupported format.' : '';
        if (!writeCache(storage, days, loadedAt)) error ||= 'Weather loaded. Local storage is unavailable; offline caching could not be saved.';
      } catch (e) {
        stale = true;
        error = `${e.code === 'permission-denied' ? 'Firestore denied access to weather or contentVersions.' : 'Could not refresh weather. Check your connection and try again.'} ${loadedAt ? 'Showing cached data from ' + updated(loadedAt) + '.' : 'No saved weather available.'}`;
      } finally { inFlight = null; render(); }
    })();
    return inFlight;
  }
  function select(date, period, live = false) {
    selectedDate = date; selectedPeriod = period; follow = live; render();
  }
  async function previewDay(button) {
    if (swapping) return;
    const date = button.dataset.date, slot = button.dataset.slot;
    const now = phNow();
    if (!dateWindow(now.date).includes(date)) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const main = el('weather-main');
    const slots = [...new Set([slot, selectedDate].filter(d => d !== now.date))];
    const cards = () => [main, ...slots.map(d => el('weather-upcoming').querySelector(`[data-slot="${d}"]`)).filter(Boolean)];
    const focusSlot = () => {
      if (!el('weather-panel').hidden) el('weather-upcoming').querySelector(`[data-slot="${slot}"]`)?.focus({ preventScroll: true });
    };
    swapping = true;
    let animations = [];
    try {
      main.style.minHeight = `${main.getBoundingClientRect().height}px`;
      main.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
      if (!reduced) {
        animations = cards().map(card => card.animate([{ transform: 'perspective(1200px) rotateY(0deg)' }, { transform: 'perspective(1200px) rotateY(90deg)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' }));
        await Promise.all(animations.map(animation => animation.finished));
      }
      const latest = phNow();
      selectedDate = date; follow = date === latest.date;
      selectedPeriod = follow ? latest.period : 'afternoon';
      render(true);
      animations.forEach(animation => animation.cancel());
      if (!reduced) {
        animations = cards().map(card => card.animate([{ transform: 'perspective(1200px) rotateY(-90deg)' }, { transform: 'perspective(1200px) rotateY(0deg)' }], { duration: 300, easing: 'ease-out', fill: 'forwards' }));
        await Promise.all(animations.map(animation => animation.finished));
      }
    } finally {
      animations.forEach(animation => animation.cancel());
      main.style.minHeight = '';
      swapping = false;
      if (deferredRender) render();
      focusSlot();
    }
  }
  function chooseCondition(condition) {
    form.elements.condition.value = condition;
    el('weather-condition-trigger').textContent = CONDITIONS[condition];
    el('weather-condition-options').querySelectorAll('button').forEach(button => {
      const active = button.dataset.condition === condition;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
    });
  }
  function openEdit() {
    const day = days.find(day => day.forecastDate === selectedDate);
    if (!day || !navigator.onLine || saving) return;
    editTarget = { date: selectedDate, period: selectedPeriod };
    el('weather-edit-context').textContent = `${dateText(selectedDate, { year: 'numeric' })} · ${PERIODS.find(p => p.id === selectedPeriod).label} · Davao del Sur`;
    el('weather-edit-error').textContent = '';
    const p = day.periods[selectedPeriod];
    for (const key of ['temperatureC', 'rainChancePct', 'humidityPct', 'windKph']) form.elements[key].value = p[key];
    el('weather-condition-options').innerHTML = Object.entries(CONDITIONS).filter(([id]) => id !== 'sunny' || !['midnight', 'evening'].includes(selectedPeriod)).map(([id, label]) => `<button type="button" class="dropdown-item" data-condition="${id}">${label}</button>`).join('');
    chooseCondition(p.condition); modal.show();
  }
  async function save(reset = false) {
    if (saving || !editTarget) return;
    if (!navigator.onLine) { el('weather-edit-error').textContent = 'Connect to save weather changes.'; return; }
    if (!reset && !form.reportValidity()) return;
    const value = { condition: form.elements.condition.value };
    for (const key of ['temperatureC', 'rainChancePct', 'humidityPct', 'windKph']) value[key] = Number(form.elements[key].value);
    saving = true; el('weather-save').disabled = el('weather-reset').disabled = true;
    el('weather-edit-error').textContent = '';
    try {
      const changed = await store.edit(editTarget.date, editTarget.period, value, reset);
      modal.hide(); notify(changed ? reset ? 'Generated period restored.' : 'Weather period updated.' : 'Weather is already up to date.');
      if (inFlight) await inFlight;
      await refresh();
    } catch (e) { el('weather-edit-error').textContent = e.code ? 'Could not save. Check your connection and Firestore permissions, then retry.' : e.message; }
    finally { saving = false; el('weather-save').disabled = el('weather-reset').disabled = !navigator.onLine; render(); }
  }
  el('weather-main').addEventListener('click', event => {
    if (swapping) return;
    const period = event.target.closest('[data-period]');
    if (period) { select(selectedDate, period.dataset.period); return; }
    const action = event.target.closest('[data-weather-action]')?.dataset.weatherAction;
    if (action === 'now') { const now = phNow(); select(now.date, now.period, true); }
  });
  el('weather-upcoming').addEventListener('click', event => {
    const button = event.target.closest('[data-date]');
    if (button) previewDay(button).catch(() => { swapping = false; render(); });
  });
  el('weather-condition-options').addEventListener('click', event => {
    const condition = event.target.closest('[data-condition]')?.dataset.condition;
    if (condition) { chooseCondition(condition); bootstrap.Dropdown.getOrCreateInstance(el('weather-condition-trigger')).hide(); }
  });
  form.addEventListener('submit', event => { event.preventDefault(); save(); });
  el('weather-reset').addEventListener('click', () => save(true));
  function tick() {
    el('weather-clock').textContent = clockFormat.format(new Date()) + ' PHT';
    const now = phNow(), changedDate = now.date !== current.date, changedPeriod = now.period !== current.period;
    if (changedDate || changedPeriod) {
      if (changedDate && follow) selectedDate = now.date;
      current = now; render(); if (changedDate) refresh();
    }
  }
  function resume() { document.body.classList.toggle('weather-paused', document.hidden); if (!document.hidden) { tick(); refresh(); } }
  window.addEventListener('pageshow', resume);
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('offline', () => { stale = true; error = ''; el('weather-save').disabled = el('weather-reset').disabled = true; render(); });
  window.addEventListener('online', () => { el('weather-save').disabled = el('weather-reset').disabled = saving; refresh(); });
  setInterval(tick, 1000); tick(); render();
  return { refresh, enter: () => { tick(); render(); refresh(); } };
}
