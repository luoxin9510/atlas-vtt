const fs = require('fs');
const path = require('path');
const { getPluginTargetDirs, markForHotReload } = require('./worktree-targets');
const { forkManifest } = require('./forkManifest');

const distDir = path.join(__dirname, '..', 'dist');
const rootManifest = path.join(__dirname, '..', 'manifest.json');
const artifactFiles = [
  { source: path.join(distDir, 'main.js'), targetName: 'main.js', required: true },
  { source: path.join(distDir, 'styles.css'), targetName: 'styles.css', required: false },
  { source: rootManifest, targetName: 'manifest.json', required: true },
];

const targets = getPluginTargetDirs(path.join(__dirname, '..'));

const missingRequired = artifactFiles.filter((file) => file.required && !fs.existsSync(file.source));
if (missingRequired.length > 0) {
  console.error(
    '❌ Required build artifacts not found:',
    missingRequired.map((item) => item.source).join(', ')
  );
  process.exitCode = 1;
} else {
  let copiedCount = 0;

  for (const target of targets) {
    fs.mkdirSync(target.dirPath, { recursive: true });
    markForHotReload(target.dirPath);

    for (const file of artifactFiles) {
      if (!fs.existsSync(file.source)) continue;
      const targetPath = path.join(target.dirPath, file.targetName);
      // The installed manifest carries the fork's id; the repository's manifest.json stays as it is.
      if (file.source === rootManifest) {
        const manifest = JSON.parse(fs.readFileSync(file.source, 'utf8'));
        fs.writeFileSync(targetPath, `${JSON.stringify(forkManifest(manifest), null, 2)}\n`);
      } else {
        fs.copyFileSync(file.source, targetPath);
      }
    }

    copiedCount += 1;
    console.log(`✅ Copied plugin artifacts to ${target.label}`);
  }

  if (copiedCount === 0) {
    console.log('ℹ️ No local vault targets detected; skipping postbuild copy');
  }
}
