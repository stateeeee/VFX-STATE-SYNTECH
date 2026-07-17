const fs = require('fs');

let code = fs.readFileSync('src/components/VfxCanvas.tsx', 'utf8');

code = code.replace(
  'className="relative w-full h-full min-h-[300px] overflow-hidden border-2 border-neutral-700/60 rounded-xl"',
  'className="relative w-full h-full min-h-[300px] overflow-hidden"'
);

fs.writeFileSync('src/components/VfxCanvas.tsx', code);
