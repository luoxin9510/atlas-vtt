import type { Message } from '../../types';

export const uvttImport = {
  'uvttImport.notMapsOne': '{name} is not a map Atlas can import. Drop a .dd2vtt, .uvtt or .df2vtt file.',
  'uvttImport.notMapsMany': '{names} and {last} are not maps Atlas can import. Drop a .dd2vtt, .uvtt or .df2vtt file.',
  'uvttImport.notOpened': '"{name}" could not be opened. It is in the Scenes tab.',
  'uvttImport.importing': 'Importing {name}…',
  'uvttImport.failed': 'Could not import {name}. {problem}',
  'uvttImport.summary': 'Imported "{name}": {walls}, {doors}, {lights}.',
  'uvttImport.walls': { one: '{count} wall', other: '{count} walls' },
  'uvttImport.doors': { one: '{count} door', other: '{count} doors' },
  'uvttImport.lights': { one: '{count} light', other: '{count} lights' },
  'uvttImport.lightsOff': 'The lights are switched off, because the image already shows their glow.',
  'uvttImport.scaledDown': 'The image was scaled down to {width} × {height} pixels.',
} as const satisfies Record<string, Message>;
