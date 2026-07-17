const fs = require('fs');
let code = fs.readFileSync('src/components/NodalComposition.tsx', 'utf8');

const oldCode = `            </div>
          )}
        </div>
        <div className="flex items-center">`;

const newCode = `            </div>
          )}
        </div>
        </div>
        <div className="flex items-center">`;

code = code.replace(oldCode, newCode);
fs.writeFileSync('src/components/NodalComposition.tsx', code);
