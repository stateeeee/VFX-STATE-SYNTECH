/*
 * Day-mode variants of the five effect covers.
 *
 * The covers are the operator's own effect screenshots: a bright star standing on
 * a BLACK plate. At night that plate is invisible — the card is black too. On the
 * cage's warm-ivory day surface the same plate reads as five black rectangles, and
 * the operator rejected that.
 *
 * So the black is KEYED OUT, exactly as the shell already keys the logo: fully
 * transparent under 26 (the same threshold the cage's flood-fill uses), then a
 * ramp to opaque at 70, so the star's dark edges feather into the ivory instead
 * of being cut. The artwork itself is never touched — this writes new files.
 *
 * Reads   public/assets/covers/<ModuleId>.webp
 * Writes  public/assets/covers/day/<ModuleId>.webp
 *
 * Run: NODE_PATH=/opt/node22/lib/node_modules node tools/frame/build-day-covers.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'public/assets/covers');
const DST = path.join(SRC, 'day');

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox', '--force-color-profile=srgb'],
  });
  const work = await (await browser.newContext()).newPage();
  await work.goto('about:blank');
  fs.mkdirSync(DST, { recursive: true });

  const names = fs.readdirSync(SRC).filter((f) => /\.(webp|png|jpg)$/i.test(f));
  if (!names.length) throw new Error(`no covers in ${SRC}`);

  for (const name of names) {
    const b64 = fs.readFileSync(path.join(SRC, name)).toString('base64');
    const out = await work.evaluate(async ({ b64, mime }) => {
      const im = new Image(); im.src = `data:${mime};base64,` + b64; await im.decode();
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height);
      let cleared = 0;
      for (let i = 0; i < d.data.length; i += 4) {
        const mx = Math.max(d.data[i], d.data[i + 1], d.data[i + 2]);
        if (mx <= 26) { d.data[i + 3] = 0; cleared++; }
        else if (mx < 70) d.data[i + 3] = Math.round(((mx - 26) / 44) * 255);
      }
      g.putImageData(d, 0, 0);
      return { url: c.toDataURL('image/webp', 0.92), cleared, total: c.width * c.height };
    }, { b64, mime: /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'image/webp' });

    const dst = path.join(DST, name.replace(/\.(png|jpg|jpeg)$/i, '.webp'));
    fs.writeFileSync(dst, Buffer.from(out.url.split(',')[1], 'base64'));
    /* Report AFTER the write, never before it: a reporting line that throws
       before the write leaves the old file on disk while the change looks
       applied. That cost three rounds on the cage. */
    console.log(`  ${name.padEnd(22)} → ${path.basename(dst)}  ${(out.cleared / out.total * 100).toFixed(1)}% keyed, ${(fs.statSync(dst).size / 1024).toFixed(0)} KB`);
  }
  console.log(`\nwrote ${names.length} day covers to ${DST}`);
  await browser.close();
})();
