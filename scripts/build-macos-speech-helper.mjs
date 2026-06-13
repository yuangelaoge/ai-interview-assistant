import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, 'dist', 'helpers');
const helperPath = path.join(outDir, 'macos-speech-recognizer');
const helperIdentifier = 'cn.interview.assistant.macos-speech-helper';
const sourcePath = path.join(repoRoot, 'native', 'macos-speech', 'SpeechRecognizer.swift');
const infoPlistPath = path.join(repoRoot, 'native', 'macos-speech', 'Info.plist');
const moduleCachePath = path.join(os.tmpdir(), 'ai-interview-assistant-swift-module-cache');
const targetArch = process.arch === 'x64' ? 'x86_64' : process.arch;
const deploymentTarget = process.env.AI_INTERVIEW_MACOS_SPEECH_DEPLOYMENT_TARGET || '13.0';

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(moduleCachePath, { recursive: true });

if (process.platform !== 'darwin') {
  console.log('Skipping macOS Speech helper build on non-macOS platform.');
  process.exit(0);
}

const swiftcProbe = spawnSync('xcrun', ['--find', 'swiftc'], {
  encoding: 'utf8'
});

if (swiftcProbe.status !== 0) {
  console.warn('Skipping macOS Speech helper build: swiftc was not found.');
  process.exit(0);
}

const result = spawnSync(
  'xcrun',
  [
    'swiftc',
    sourcePath,
    '-target',
    `${targetArch}-apple-macosx${deploymentTarget}`,
    '-o',
    helperPath,
    '-framework',
    'Speech',
    '-framework',
    'AVFoundation',
    '-module-cache-path',
    moduleCachePath,
    '-Xlinker',
    '-sectcreate',
    '-Xlinker',
    '__TEXT',
    '-Xlinker',
    '__info_plist',
    '-Xlinker',
    infoPlistPath
  ],
  {
    stdio: 'inherit'
  }
);

if (result.status !== 0) {
  console.warn('Skipping macOS Speech helper build: swiftc failed.');
  process.exit(0);
}

fs.chmodSync(helperPath, 0o755);

const signResult = spawnSync(
  'codesign',
  ['--force', '--sign', '-', '--identifier', helperIdentifier, helperPath],
  {
    stdio: 'inherit'
  }
);

if (signResult.status !== 0) {
  console.warn('macOS Speech helper was built, but ad-hoc signing failed.');
}

console.log(`Built macOS Speech helper: ${path.relative(repoRoot, helperPath)}`);
