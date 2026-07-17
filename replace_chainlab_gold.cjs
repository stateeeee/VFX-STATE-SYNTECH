const fs = require('fs');

const files = [
  'src/components/ChainLab.tsx',
  'src/components/AiDirector.tsx'
];

files.forEach(filePath => {
  if (!fs.existsSync(filePath)) return;
  let code = fs.readFileSync(filePath, 'utf8');
  code = code.replace(/text-gold/g, 'text-violet');
  code = code.replace(/border-gold/g, 'border-violet');
  code = code.replace(/bg-gold/g, 'bg-violet');
  fs.writeFileSync(filePath, code);
});
