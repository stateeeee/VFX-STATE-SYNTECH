const fs = require('fs');

let code = fs.readFileSync('src/components/AiDirector.tsx', 'utf8');
code = code.replace(/e0b451/g, '8b5cf6');
fs.writeFileSync('src/components/AiDirector.tsx', code);
