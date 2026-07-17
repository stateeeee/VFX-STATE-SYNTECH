const fs = require('fs');

let code = fs.readFileSync('src/components/NodalComposition.tsx', 'utf8');

code = code.replace(/text-gold/g, 'text-violet');
code = code.replace(/border-gold/g, 'border-violet');
code = code.replace(/bg-gold/g, 'bg-violet');

fs.writeFileSync('src/components/NodalComposition.tsx', code);
