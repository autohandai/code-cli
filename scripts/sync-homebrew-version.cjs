/**
 * Syncs the Homebrew formula URL version with package.json version.
 * Called during release to keep homebrew/autohand.rb in sync.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const formulaPath = path.join(ROOT, 'homebrew', 'autohand.rb');
const pkgPath = path.join(ROOT, 'package.json');

const version = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
const formula = fs.readFileSync(formulaPath, 'utf-8');

const updated = formula.replace(
  /autohand-cli-[\d.]+(?:-[\w.]+)?\.tgz/,
  `autohand-cli-${version}.tgz`,
);

if (updated !== formula) {
  fs.writeFileSync(formulaPath, updated);
  console.log(`Homebrew formula updated to ${version}`);
} else {
  console.log(`Homebrew formula already at ${version}`);
}
