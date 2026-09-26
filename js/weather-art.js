// Fixed watercolor layers: only transforms and opacity change during playback.
export function renderWeatherArt(condition, animated = false) {
  if (!['sunny', 'cloudy', 'rainy', 'heavy-rain', 'heavy-rain-thunder'].includes(condition)) return '';
  let layers;
  if (condition === 'sunny') {
    layers = '<span class="weather-layer sun-rays"></span><span class="weather-layer sun-disc"></span><span class="weather-layer sun-cloud"></span>';
  } else if (condition === 'cloudy') {
    layers = '<span class="weather-layer cloud-back"></span><span class="weather-layer cloud-front"></span>';
  } else {
    const count = condition === 'rainy' ? 7 : 18;
    const drops = Array.from({ length: count }, (_, i) => {
      const duration = (condition === 'rainy' ? 2.3 : 1.25) + (i % 4) * .13;
      const phase = ((i * .61803398875 + .17) % 1);
      return `<span class="rain-lane" style="--x:${18 + (i * 37 % 65)}%;--speed:${duration.toFixed(2)}s;--delay:${(-phase * duration).toFixed(3)}s;--rest:${(phase * 330).toFixed(1)}%"><span class="weather-drop"></span></span>`;
    }).join('');
    layers = `<span class="weather-rain">${drops}</span>${condition === 'heavy-rain-thunder' ? '<span class="weather-layer lightning"></span>' : ''}<span class="weather-layer rain-cloud"></span>`;
  }
  return `<span class="weather-art ${animated ? 'animated' : ''}" data-condition="${condition}" aria-hidden="true">${layers}</span>`;
}
