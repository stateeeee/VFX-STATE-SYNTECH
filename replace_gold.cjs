const fs = require('fs');

let appCode = fs.readFileSync('src/App.tsx', 'utf8');

appCode = appCode.replace(/text-gold/g, 'text-violet');
appCode = appCode.replace(/border-gold/g, 'border-violet');
appCode = appCode.replace(/bg-gold/g, 'bg-violet');
appCode = appCode.replace(/rgba\(224,180,81/g, 'rgba(139,92,246');

fs.writeFileSync('src/App.tsx', appCode);
