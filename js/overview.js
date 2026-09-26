import { phNow, dateWindow, dateText, CONDITIONS, PERIODS } from './weather-core.js';
import { renderWeatherArt } from './weather-art.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const peso = value => new Intl.NumberFormat('en-PH', { style:'currency', currency:'PHP' }).format(value);
const categories = {vegetable:'Vegetables',fruit:'Fruits',spice:'Spices'};

export function marketSummary(records) {
  const products = records.filter(p => p.isActive !== false && p.amount != null && Number.isFinite(Number(p.amount)) && Number(p.amount) > 0);
  const changes = products.filter(p => p.previousAmount != null && Number(p.previousAmount) > 0 && Number.isFinite(Number(p.previousAmount))).map(p => ({name:p.commodityName, difference:Number(p.amount)-Number(p.previousAmount),percent:(Number(p.amount)-Number(p.previousAmount))/Number(p.previousAmount)*100}));
  return {products,changes,groups:Object.entries(categories).map(([id,label])=>{
    const items=products.filter(p=>p.category===id);
    return {id,label,count:items.length,average:items.length?items.reduce((sum,p)=>sum+Number(p.amount),0)/items.length:null};
  })};
}

export function initOverview() {
  let prices = [], loaded = false, weather = {days:[],stale:true};
  const el = id => document.getElementById(id);
  function renderPrices() {
    const {products,changes,groups}=marketSummary(prices);
    const rising=changes.filter(p=>p.difference>0),falling=changes.filter(p=>p.difference<0);
    el('overview-stats').innerHTML = [
      ['Products tracked',products.length,'Across fruits, vegetables & spices'],
      ['Prices increased',rising.length,'Compared with the previous saved price'],
      ['Prices decreased',falling.length,`${changes.filter(p=>p.difference===0).length} unchanged · ${products.length-changes.length} without a previous price`],
    ].map(([label,value,note])=>`<div class="ov-stat"><span>${label}</span><strong>${loaded?value:'—'}</strong><small>${note}</small></div>`).join('');
    const max=Math.max(1,...groups.map(g=>g.average||0));
    el('overview-categories').innerHTML = !loaded?'<p class="ov-empty">Loading market prices…</p>':!products.length?'<p class="ov-empty">Add products to see category averages.</p>':groups.map(g=>`<div class="ov-bar-row"><div><strong>${g.label}</strong><small>${g.count} products</small><b>${g.average==null?'—':peso(g.average)}<small> / kg</small></b></div><div class="ov-track"><span class="ov-bar ${g.id}" style="width:${(g.average||0)/max*100}%"></span></div></div>`).join('');
    const movers=changes.filter(p=>p.difference!==0).sort((a,b)=>Math.abs(b.percent)-Math.abs(a.percent)).slice(0,5);
    const largest=Math.max(1,...movers.map(p=>Math.abs(p.percent)));
    el('overview-movers').innerHTML=!loaded?'<p class="ov-empty">Loading price movements…</p>':!movers.length?'<p class="ov-empty">Price movements appear after a product’s price changes.</p>':movers.map(p=>`<div class="ov-mover"><div><strong>${escape(p.name)}</strong><span class="${p.difference>0?'ov-up':'ov-down'}">${p.difference>0?'+':''}${p.percent.toLocaleString('en-PH',{maximumFractionDigits:1})}%</span></div><div class="ov-diverging"><span class="${p.difference>0?'ov-positive':'ov-negative'}" style="width:${Math.log1p(Math.abs(p.percent))/Math.log1p(largest)*50}%;${p.difference>0?'left:50%':'right:50%'}"></span></div><small>${p.difference>0?'+':''}${peso(p.difference)} / kg vs previous</small></div>`).join('');
  }
  function renderWeather() {
    const now=phNow(), dates=dateWindow(now.date), days=dates.map(d=>weather.days.find(day=>day.forecastDate===d));
    const today=days[0], period=today?.periods[now.period];
    el('overview-weather-date').textContent=dateText(now.date,{weekday:'long'})+' · Philippine time';
    el('overview-weather-current').innerHTML=period?`<div class="ov-weather-art">${renderWeatherArt(period.condition,true)}</div><div><span class="ov-overline">${PERIODS.find(p=>p.id===now.period).label}</span><h3>${CONDITIONS[period.condition]}</h3><strong class="ov-temperature">${period.temperatureC}<small>°C</small></strong><p>Low ${today.minTemperatureC}°C · High ${today.maxTemperatureC}°C</p></div><dl class="ov-weather-details"><div><dt>Rain chance</dt><dd>${period.rainChancePct}%</dd></div><div><dt>Humidity</dt><dd>${period.humidityPct}%</dd></div><div><dt>Wind</dt><dd>${period.windKph} <small>km/h</small></dd></div></dl>`:'<p class="ov-empty">Weather unavailable. Connect to load the latest saved forecast.</p>';
    el('overview-weather-note').textContent=weather.loadedAt?(weather.stale?'Cached weather · ':'')+'Loaded '+new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(weather.loadedAt))+' PHT':'Forecast will appear when weather is available.';
    const values=days.filter(Boolean).flatMap(d=>[d.minTemperatureC,d.maxTemperatureC]);
    if(!values.length){el('overview-forecast').innerHTML='<p class="ov-empty">The seven-day outlook will appear when weather is available.</p>';return;}
    const low=Math.floor(Math.min(...values)/5)*5-2,high=Math.ceil(Math.max(...values)/5)*5+2;
    const y=t=>145-(t-low)/(high-low)*120;
    const columns=days.map((d,i)=>{const x=42+i*73;
      return `<g><text x="${x}" y="183" text-anchor="middle">${i===0?'Today':dateText(dates[i],{weekday:'short'}).split(',')[0]}</text><text class="ov-date" x="${x}" y="201" text-anchor="middle">${dateText(dates[i])}</text>${d?`<title>${dateText(dates[i])}: low ${d.minTemperatureC}°C, high ${d.maxTemperatureC}°C; ${CONDITIONS[d.periods.afternoon.condition]} in the afternoon</title><line x1="${x}" x2="${x}" y1="${y(d.maxTemperatureC)}" y2="${y(d.minTemperatureC)}" class="ov-range-line"/><circle cx="${x}" cy="${y(d.maxTemperatureC)}" r="5" class="ov-high"/><circle cx="${x}" cy="${y(d.minTemperatureC)}" r="5" class="ov-low"/><text x="${x}" y="${y(d.maxTemperatureC)-13}" text-anchor="middle">${d.maxTemperatureC}°</text><text x="${x}" y="${y(d.minTemperatureC)+21}" text-anchor="middle">${d.minTemperatureC}°</text>`:`<text x="${x}" y="100" text-anchor="middle">—</text>`}</g>`;
    }).join('');
    el('overview-forecast').innerHTML=`<svg viewBox="0 0 522 215" role="img" aria-labelledby="ov-chart-title ov-chart-description"><title id="ov-chart-title">Seven-day temperature range in Celsius</title><desc id="ov-chart-description">${days.map((d,i)=>`${dateText(dates[i])}: ${d?`low ${d.minTemperatureC}, high ${d.maxTemperatureC} degrees Celsius`:'unavailable'}`).join('; ')}</desc><line x1="20" x2="505" y1="163" y2="163" class="ov-grid-line"/>${columns}</svg>`;
  }
  renderPrices();renderWeather();
  return { prices(records){prices=records;loaded=true;renderPrices();}, weather(snapshot){weather=snapshot;renderWeather();} };
}
