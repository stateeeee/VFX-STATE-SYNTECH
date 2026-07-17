const fs = require('fs');

const files = [
  'src/components/ChainLab.tsx',
  'src/components/EffectHost.tsx',
  'src/components/NodalComposition.tsx',
  'src/App.tsx'
];

files.forEach(filePath => {
  let code = fs.readFileSync(filePath, 'utf8');

  // Simple un-replaces for distinct ones
  code = code.split('border-[#7b51b7]/30').join('border-neutral-200');
  code = code.split('border-[#7b51b7]/50').join('border-ink-700/60');
  code = code.split('border-[#7b51b7]/60').join('border-ink-700/70');
  
  // Custom un-replaces for /40
  code = code.split("isDayMode ? 'border-[#7b51b7]/40").join("isDayMode ? 'border-neutral-300");
  code = code.split("? 'border-[#7b51b7]/40 text-neutral-600").join("? 'border-neutral-300 text-neutral-600");
  code = code.split(": 'border-[#7b51b7]/40 text-neutral-400").join(": 'border-ink-700 text-neutral-400");
  code = code.split("bg-ink-850 border-[#7b51b7]/40").join("bg-ink-850 border-ink-700");
  code = code.split(": 'border-[#7b51b7]/40 hover:").join(": 'border-ink-700 hover:");
  code = code.split(": 'border-[#7b51b7]/40'").join(": 'border-ink-700/50'");

  fs.writeFileSync(filePath, code);
});
