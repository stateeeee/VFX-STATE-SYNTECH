const fs = require('fs');
let code = fs.readFileSync('src/index.css', 'utf8');

code = code.replace(/--syn-accent: #e0b451;/, '--syn-accent: #8b5cf6;');
code = code.replace(/--syn-accent-rgb: 224, 180, 81;/, '--syn-accent-rgb: 139, 92, 246;');
code = code.replace(/--syn-accent-50: #fefcf3;/, '--syn-accent-50: #f5f3ff;');
code = code.replace(/--syn-accent-100: #fbf6d9;/, '--syn-accent-100: #ede9fe;');
code = code.replace(/--syn-accent-200: #f4e9b0;/, '--syn-accent-200: #ddd6fe;');
code = code.replace(/--syn-accent-300: #ebd67d;/, '--syn-accent-300: #c4b5fd;');
code = code.replace(/--syn-accent-400: #e5c25f;/, '--syn-accent-400: #a78bfa;');
code = code.replace(/--syn-accent-600: #c89a37;/, '--syn-accent-600: #7c3aed;');
code = code.replace(/--syn-accent-700: #96742c;/, '--syn-accent-700: #6d28d9;');
code = code.replace(/--syn-accent-800: #6b5124;/, '--syn-accent-800: #5b21b6;');
code = code.replace(/--syn-accent-900: #4a381a;/, '--syn-accent-900: #4c1d95;');
code = code.replace(/--syn-accent-950: #2a1f0e;/, '--syn-accent-950: #2e1065;');

code = code.replace(/--syn-violet: #a882ff;/, '--syn-violet: #e0b451;');
code = code.replace(/--syn-violet-rgb: 168, 130, 255;/, '--syn-violet-rgb: 224, 180, 81;');

fs.writeFileSync('src/index.css', code);
