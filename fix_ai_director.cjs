const fs = require('fs');
let code = fs.readFileSync('src/components/AiDirector.tsx', 'utf8');

code = code.replace(/#7b51b7/g, '#e0b451'); // change purple hex to gold hex
code = code.replace(/text-violet-400/g, 'text-[#e0b451]');
code = code.replace(/text-violet-300/g, 'text-[#e0b451]/80');
code = code.replace(/bg-violet-500/g, 'bg-[#e0b451]');
code = code.replace(/bg-violet-400/g, 'bg-[#e0b451]/80');
code = code.replace(/border-violet-500/g, 'border-[#e0b451]');

fs.writeFileSync('src/components/AiDirector.tsx', code);
