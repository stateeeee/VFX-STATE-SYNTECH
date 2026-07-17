const fs = require('fs');

let code = fs.readFileSync('src/components/VfxCanvas.tsx', 'utf8');

// Change fallbacks for violet
code = code.replace(/#D4AF37/g, '#8b5cf6');
code = code.replace(/212, 175, 55/g, '139, 92, 246');
code = code.replace(/#8a6e2f/g, '#7c3aed');
code = code.replace(/138, 110, 47/g, '124, 58, 237');
code = code.replace(/#513d1e/g, '#5b21b6');
code = code.replace(/#2c200e/g, '#2e1065');

// Change DayMode hardcoded yellow to violet
code = code.replace(/#8a6e33/g, '#7c3aed');
code = code.replace(/#c8baa0/g, '#c4b5fd');
code = code.replace(/180, 140, 45/g, '139, 92, 246');
code = code.replace(/180, 100, 20/g, '139, 92, 246');
code = code.replace(/160, 118, 20/g, '139, 92, 246');
code = code.replace(/#a07614/g, '#8b5cf6');
code = code.replace(/#7a6538/g, '#7c3aed');
code = code.replace(/#5e4e2b/g, '#6d28d9');

// The user also wants the container to have a thick gray border.
// Let's add border-2 border-neutral-700 to the outermost div of VfxCanvas.
code = code.replace(
  'className="relative w-full h-full min-h-[300px] overflow-hidden"',
  'className="relative w-full h-full min-h-[300px] overflow-hidden border-2 border-neutral-700/60 rounded-xl"'
);

fs.writeFileSync('src/components/VfxCanvas.tsx', code);
