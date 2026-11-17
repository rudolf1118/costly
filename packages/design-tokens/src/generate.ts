import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tailwindThemeCss, tokensCss } from './css.ts';

const write = (file: string, content: string) =>
  writeFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), content);

write('tokens.css', tokensCss());
write('tailwind.css', tailwindThemeCss());
