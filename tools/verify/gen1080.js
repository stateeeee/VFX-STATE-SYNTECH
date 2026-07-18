const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  await page.goto('about:blank');
  const dataUrl = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1920; c.height = 1080;
    const g = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(24), { mimeType: 'video/webm', videoBitsPerSecond: 12e6 });
    const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    rec.start();
    const t0 = performance.now();
    const iv = setInterval(() => {
      const t = (performance.now() - t0) / 1000;
      const grad = g.createLinearGradient(0, 0, 1920, 0);
      grad.addColorStop(0, '#101020'); grad.addColorStop(0.5, '#3a6a4a'); grad.addColorStop(1, '#c0c8d8');
      g.fillStyle = grad; g.fillRect(0, 0, 1920, 1080);
      g.fillStyle = '#ffffff'; g.beginPath();
      g.arc(960 + Math.cos(t * 2.1) * 560, 540 + Math.sin(t * 2.1) * 300, 165, 0, 7); g.fill();
      g.fillStyle = '#000000'; g.fillRect(((t * 390) % 2100) - 90, 0, 135, 1080);
      g.fillStyle = '#d03030'; g.fillRect(300, 780 + Math.sin(t * 3.3) * 90, 240, 135);
    }, 1000 / 24);
    await new Promise((r) => setTimeout(r, 3000));
    clearInterval(iv); rec.stop(); await stopped;
    const blob = new Blob(chunks, { type: 'video/webm' });
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
  });
  fs.writeFileSync('__SCRATCH__/parity1080.webm', Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('parity1080.webm written');
  await browser.close();
})();
