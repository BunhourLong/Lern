/// <reference types="node" />

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { fonts } from './fonts';

const mobile = join(__dirname, '../..');
const fontDir = join(mobile, 'android/app/src/main/assets/fonts');

function readPostScriptName(file: string) {
  const font = readFileSync(file);
  const signature = font.toString('latin1', 0, 4);
  if (
    font.length < 12 ||
    !['\x00\x01\x00\x00', 'OTTO', 'true'].includes(signature)
  ) {
    throw new Error(`${file} is not an sfnt font`);
  }

  const tableCount = font.readUInt16BE(4);
  for (let i = 0; i < tableCount; i++) {
    const entry = 12 + i * 16;
    if (font.toString('ascii', entry, entry + 4) !== 'name') {
      continue;
    }

    const table = font.readUInt32BE(entry + 8);
    const recordCount = font.readUInt16BE(table + 2);
    const storage = table + font.readUInt16BE(table + 4);
    for (let j = 0; j < recordCount; j++) {
      const record = table + 6 + j * 12;
      const platform = font.readUInt16BE(record);
      const nameId = font.readUInt16BE(record + 6);
      if (nameId !== 6 || (platform !== 3 && platform !== 1)) {
        continue;
      }

      const length = font.readUInt16BE(record + 8);
      const start = storage + font.readUInt16BE(record + 10);
      const name = font.subarray(start, start + length);
      return platform === 3
        ? Buffer.from(name).swap16().toString('utf16le')
        : name.toString('latin1');
    }
    break;
  }

  throw new Error(`${file} has no Windows or Mac PostScript name record`);
}

test('bundles the same Kantumruy Pro fonts and license on Android and iOS', () => {
  const names = Object.values(fonts);
  const files = names.map(name => `${name}.ttf`);
  const assets = readdirSync(fontDir);
  expect(assets.filter(file => file.endsWith('.ttf')).sort()).toEqual(
    [...files].sort(),
  );
  expect(assets).toContain('OFL.txt');

  for (const name of names) {
    expect(readPostScriptName(join(fontDir, `${name}.ttf`))).toBe(name);
  }

  const plist = readFileSync(join(mobile, 'ios/Lern/Info.plist'), 'utf8');
  const registeredFontsArray =
    plist.match(/<key>UIAppFonts<\/key>\s*<array>([\s\S]*?)<\/array>/)?.[1] ??
    '';
  const registeredFonts = [
    ...registeredFontsArray.matchAll(/<string>([\s\S]*?)<\/string>/g),
  ]
    .map(match => match[1])
    .sort();
  const project = readFileSync(
    join(mobile, 'ios/Lern.xcodeproj/project.pbxproj'),
    'utf8',
  );
  const start = project.indexOf('/* Begin PBXResourcesBuildPhase section */');
  const end = project.indexOf('/* End PBXResourcesBuildPhase section */');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const resources = project.slice(start, end);

  expect({
    registered: registeredFonts,
    resources: [...files, 'OFL.txt'].filter(file =>
      resources.includes(`/* ${file} in Resources */`),
    ),
  }).toEqual({ registered: [...files].sort(), resources: [...files, 'OFL.txt'] });

  const resourceLines = resources.split('\n').map(line => line.trim());
  const projectLines = project.split('\n').map(line => line.trim());
  for (const file of files) {
    const resource = resourceLines.find(line =>
      line.endsWith(`/* ${file} in Resources */,`),
    );
    const resourceId = resource?.split(/\s+/)[0];
    const buildFile = projectLines.find(
      line =>
        line.startsWith(`${resourceId} `) &&
        line.includes('isa = PBXBuildFile;'),
    );
    const referenceId = buildFile?.match(/\bfileRef = (\w+)\b/)?.[1];
    const reference = projectLines.find(
      line =>
        line.startsWith(`${referenceId} `) &&
        line.includes('isa = PBXFileReference;'),
    );
    expect(reference).toContain(
      `path = "../android/app/src/main/assets/fonts/${file}"; sourceTree = SOURCE_ROOT;`,
    );
  }
});
