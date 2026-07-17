const fs = require('fs');

let code = fs.readFileSync('src/index.css', 'utf8');

// Swap hero gradient colors
code = code.replace(
  'background-image: linear-gradient(100deg, #ffda4d 0%, #ffb31a 25%, #b34dff 50%, #8c33ff 75%, #ffda4d 100%);',
  'background-image: linear-gradient(100deg, #8b5cf6 0%, #7c3aed 25%, #ffda4d 50%, #ffb31a 75%, #8b5cf6 100%);'
);

fs.writeFileSync('src/index.css', code);
