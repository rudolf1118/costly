import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tokensCss } from './css.ts';

const target = fileURLToPath(new URL('../tokens.css', import.meta.url));
writeFileSync(target, tokensCss());
