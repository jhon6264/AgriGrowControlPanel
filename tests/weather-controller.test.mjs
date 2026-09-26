import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderWeatherArt } from '../js/weather-art.js';
import * as core from '../js/weather-core.js';
import { readCache, writeCache } from '../js/weather-store.js';

const source = (await readFile(new URL('../js/weather.js', import.meta.url),'utf8')).replace(/^import .*;\r?$/gm,'').replace('export function initWeather','function initWeather');
function fixture({ online = true, cached = true, reduced = false } = {}) {
  let time = new Date('2026-09-26T09:59:59Z'), tick, reads = 0, failure = false;
  const elements = new Map(), events = {}, documentEvents = {}, values = new Map();
  const classes = () => {const set = new Set(); return {toggle:(key,on)=>on?set.add(key):set.delete(key),add:key=>set.add(key),remove:key=>set.delete(key),contains:key=>set.has(key)};};
  const element = id => {
    if (!elements.has(id)) elements.set(id,{innerHTML:'',textContent:'',classList:classes(),events:{},addEventListener(name,fn){this.events[name]=fn;},scrollIntoView(){},elements:{},style:{},getBoundingClientRect(){return {height:400};},animate(){return {finished:Promise.resolve(),cancel(){}};},querySelector(){return {focus(){},animate(){return {finished:Promise.resolve(),cancel(){}};}};}});
    return elements.get(id);
  };
  const storage = {getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
  if(cached)writeCache(storage,core.dateWindow('2026-09-26').map(date=>({...core.generateDay(date),updatedAt:time.valueOf()})),time.valueOf());
  const navigator = {onLine:online},document={getElementById:element,hidden:false,body:{classList:classes()},addEventListener:(key,fn)=>documentEvents[key]=fn};
  const store={async ensureWindow(date){reads++;if(failure)throw Object.assign(new Error('failure'),{code:'permission-denied'});return core.dateWindow(date).map(date=>({...core.generateDay(date),updatedAt:time.valueOf()}));}};
  class Clock extends Date {constructor(...args){super(...(args.length?args:[time.valueOf()]));}static now(){return time.valueOf();}}
  const context=vm.createContext({...core,renderWeatherArt,Date:Clock,Intl,document,navigator,window:{localStorage:storage,addEventListener:(key,fn)=>events[key]=fn},bootstrap:{Modal:class{}},setInterval:fn=>tick=fn,matchMedia:()=>({matches:reduced}),readCache,writeCache,createWeatherStore:()=>store,phNow:()=>core.phNow(time)});
  vm.runInContext(source+'\nthis.board = initWeather({},()=>{});',context);
  return {element,document,navigator,storage,events,documentEvents,board:context.board,get reads(){return reads;},setTime:value=>time=new Date(value),tick:()=>tick(),fail:()=>failure=true,
    preview:(date,slot)=>element('weather-upcoming').events.click({target:{closest:()=>({dataset:{date,slot}})}}),
    clickPeriod:id=>element('weather-main').events.click({target:{closest:selector=>selector==='[data-period]'?{dataset:{period:id}}:null}}),
    clickNow:()=>element('weather-main').events.click({target:{closest:selector=>selector==='[data-weather-action]'?{dataset:{weatherAction:'now'}}:null}}),
  };
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('live period follows PH clock; manual choice holds until Now',()=>{
  const f=fixture(); assert.match(f.element('weather-main').innerHTML,/Afternoon · Now/);
  f.setTime('2026-09-26T10:00:00Z');f.tick();assert.match(f.element('weather-main').innerHTML,/Evening · Now/);
  f.clickPeriod('morning');f.setTime('2026-09-26T15:00:00Z');f.tick();assert.match(f.element('weather-main').innerHTML,/weather-period-label">Morning</);
  f.clickNow();assert.match(f.element('weather-main').innerHTML,/Evening · Now/);
});
test('midnight and resume generate current window, preserving date labels',async()=>{
  const f=fixture(); f.setTime('2026-09-26T16:00:00Z');f.tick();await settle();
  assert.match(f.element('weather-main').innerHTML,/Today, Sunday, Sep 27, 2026/);assert.match(f.element('weather-main').innerHTML,/Midnight · Now/);
  f.document.hidden=true;f.documentEvents.visibilitychange();assert.ok(f.document.body.classList.contains('weather-paused'));
  f.setTime('2027-01-01T03:30:00Z');f.document.hidden=false;f.documentEvents.visibilitychange();await settle();
  assert.match(f.element('weather-main').innerHTML,/Today, Friday, Jan 1, 2027/);assert.match(f.element('weather-main').innerHTML,/Lunch · Now/);
  assert.equal((f.element('weather-upcoming').innerHTML.match(/data-date=/g)||[]).length,6);
  assert.ok(!f.document.body.classList.contains('weather-paused'));
});
test('offline uses cached data; expired dates unavailable; reconnect fills the new window',async()=>{
  const f=fixture({online:false});await f.board.refresh();assert.equal(f.reads,0);assert.match(f.element('weather-status').textContent,/Offline · Cached/);
  f.setTime('2026-10-10T03:00:00Z');f.tick();await settle();assert.match(f.element('weather-main').innerHTML,/Weather unavailable/);
  assert.doesNotMatch(f.element('weather-main').innerHTML,/Edit period/);
  f.navigator.onLine=true;f.events.online();await settle();assert.equal(f.reads,1);assert.doesNotMatch(f.element('weather-main').innerHTML,/Weather unavailable/);
  assert.equal(readCache(f.storage).days[0].forecastDate,'2026-10-10');
});
test('Firestore error keeps successful cache and reports failure; uncached offline is unavailable',async()=>{
  const f=fixture();const before=readCache(f.storage);f.fail();await f.board.refresh();assert.deepEqual(readCache(f.storage),before);assert.match(f.element('weather-status').textContent,/Firestore denied access/);
  const empty=fixture({online:false,cached:false});assert.match(empty.element('weather-main').innerHTML,/Weather unavailable/);assert.match(empty.element('weather-status').textContent,/No cached weather/);
});

for (const reduced of [false,true]) test(`preview swaps keep seven unique dates and never access storage backend (reduced=${reduced})`,async()=>{
 const f=fixture({reduced});
 const before=readCache(f.storage);
 const dates=()=>[...f.element('weather-upcoming').innerHTML.matchAll(/data-date="([^"]+)" data-slot="([^"]+)"/g)].map(m=>[m[1],m[2]]);
 f.preview('2026-09-27','2026-09-27');
 if(!reduced) f.preview('2026-09-28','2026-09-28'); // Ignore rapid input while flipping.
 await settle();
 assert.match(f.element('weather-main').innerHTML,/<h2>Sunday, Sep 27, 2026/);
 assert.deepEqual(dates()[0],['2026-09-26','2026-09-27']);
 assert.equal(new Set(['2026-09-27',...dates().map(x=>x[0])]).size,7);
 f.preview('2026-09-29','2026-09-29');await settle();
 assert.deepEqual(dates()[0],['2026-09-27','2026-09-27']);
 assert.deepEqual(dates()[2],['2026-09-26','2026-09-29']);
 f.preview('2026-09-26','2026-09-29');await settle();
 assert.match(f.element('weather-main').innerHTML,/<h2>Today, Saturday, Sep 26, 2026/);
 assert.match(f.element('weather-main').innerHTML,/Afternoon · Now/);
 assert.deepEqual(dates().map(x=>x[0]),core.dateWindow('2026-09-26').slice(1));
 assert.equal((f.element('weather-upcoming').innerHTML.match(/weather-art animated/g)||[]).length,6);
 assert.equal(f.reads,0);assert.deepEqual(readCache(f.storage),before);
});
