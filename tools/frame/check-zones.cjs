/* Measures the zones the operator called out, so their state is checked, not eyeballed. */
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const page = await (await b.newContext()).newPage();
  await page.goto('about:blank');
  const src = fs.readFileSync(__dirname + '/out/preview-day.png').toString('base64');
  const out = await page.evaluate(async ({ src }) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + src; await im.decode();
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
    const at = (fx, fy) => { const x = Math.round(fx * c.width), y = Math.round(fy * c.height);
      const d = g.getImageData(x, y, 1, 1).data; return `${fx},${fy} -> rgb(${d[0]},${d[1]},${d[2]})`; };
    return [
      'RED zone 1 (must be black): ' + at(0.9325, 0.571),
      'RED zone 2 (must be black): ' + at(0.920, 0.768),
      'BLUE zone (must be white):  ' + at(0.780, 0.949),
      'hero centre (white ok):     ' + at(0.500, 0.400),
    ];
  }, { src });
  out.forEach((l) => console.log(l));
  await b.close();
})();
