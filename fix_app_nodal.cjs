const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(
  /onPickSource=\{pickSource\}\n\s*\/>/g,
  'onPickSource={pickSource}\n                        isStreaming={isStreaming}\n                      />'
);
fs.writeFileSync('src/App.tsx', code);
