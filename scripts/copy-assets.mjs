import { mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('dist/src/infrastructure', {
  recursive: true
});

copyFileSync(
  'src/infrastructure/schema.sql',
  'dist/src/infrastructure/schema.sql'
);