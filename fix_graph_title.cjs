const fs = require('fs');

let code = fs.readFileSync('src/components/NodalComposition.tsx', 'utf8');

const oldHeader = `<div className="flex items-center gap-3 text-[9px] font-mono text-neutral-500 relative">
          <button`;

const newHeader = `<div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Share2 className={\`w-4 h-4 \${isDayMode ? 'text-neutral-500' : 'text-neutral-400'}\`} />
            <h2 className={\`font-mono text-[11px] font-bold tracking-[0.2em] uppercase \${
              isDayMode ? 'text-neutral-700' : 'text-neutral-300'
            }\`}>Graph</h2>
          </div>
          <div className="flex items-center gap-3 text-[9px] font-mono text-neutral-500 relative">
            <button`;

code = code.replace(oldHeader, newHeader);

// We also need to import Share2 since we might have lost it? Wait, let's check if it's imported.
fs.writeFileSync('src/components/NodalComposition.tsx', code);
