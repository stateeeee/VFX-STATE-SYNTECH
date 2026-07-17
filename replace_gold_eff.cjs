const fs = require('fs');

let code = fs.readFileSync('src/components/EffectHost.tsx', 'utf8');

code = code.replace(/text-gold/g, 'text-violet');

fs.writeFileSync('src/components/EffectHost.tsx', code);
