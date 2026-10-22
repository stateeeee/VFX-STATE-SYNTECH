/* Builds public/assets/pet/state_pet.bin from tools/pet/state_pet.obj (Meshy export).
 *
 * The OBJ is 5.7 MB of text and would be parsed on the main thread at startup;
 * this flattens it once into an indexed, GPU-ready binary:
 *   u32 vertexCount | u32 indexCount | f32 pos[3n] | f32 normal[3n] | f32 uv[2n] | u16 index[indexCount]
 * Vertices are de-duplicated on the (v, vt, vn) triple, so UV seams stay intact.
 * Run:  node tools/pet/build-pet.cjs
 */
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'state_pet.obj');
const out = path.join(__dirname, '..', '..', 'public', 'assets', 'pet', 'state_pet.bin');

const V = [], VT = [], VN = [];
const map = new Map();
const pos = [], nor = [], uv = [], idx = [];

const vert = (tok) => {
  let i = map.get(tok);
  if (i !== undefined) return i;
  const [a, b, c] = tok.split('/');
  const v = V[parseInt(a, 10) - 1];
  const t = b ? VT[parseInt(b, 10) - 1] : [0, 0];
  const n = c ? VN[parseInt(c, 10) - 1] : [0, 1, 0];
  i = pos.length / 3;
  pos.push(v[0], v[1], v[2]);
  nor.push(n[0], n[1], n[2]);
  uv.push(t[0], t[1]);
  map.set(tok, i);
  return i;
};

for (const line of fs.readFileSync(src, 'utf8').split('\n')) {
  const p = line.trim().split(/\s+/);
  if (p[0] === 'v') V.push([+p[1], +p[2], +p[3]]);
  else if (p[0] === 'vt') VT.push([+p[1], +p[2]]);
  else if (p[0] === 'vn') VN.push([+p[1], +p[2], +p[3]]);
  else if (p[0] === 'f') {
    const f = p.slice(1).map(vert);
    for (let k = 1; k + 1 < f.length; k++) idx.push(f[0], f[k], f[k + 1]); // fan-triangulate
  }
}

const n = pos.length / 3;
if (n > 65535) throw new Error(`${n} vertices does not fit a u16 index`);
const buf = Buffer.alloc(8 + n * 32 + idx.length * 2);
buf.writeUInt32LE(n, 0);
buf.writeUInt32LE(idx.length, 4);
let o = 8;
for (const arr of [pos, nor, uv]) for (const x of arr) { buf.writeFloatLE(x, o); o += 4; }
for (const x of idx) { buf.writeUInt16LE(x, o); o += 2; }
fs.writeFileSync(out, buf);
console.log(`vertices ${n}, triangles ${idx.length / 3}, ${(buf.length / 1024).toFixed(0)} KB -> ${path.relative(process.cwd(), out)}`);
