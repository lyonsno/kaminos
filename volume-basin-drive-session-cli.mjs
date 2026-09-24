#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  parseVolumeBasinDriveSession,
  serializeVolumeBasinDriveSession,
} from './volume-basin-drive-session.mjs';

const [command = 'normalize'] = process.argv.slice(2);
if (command !== 'normalize') {
  throw new Error(`unsupported basin drive session command: ${command}`);
}
const session = parseVolumeBasinDriveSession(readFileSync(0, 'utf8'));
process.stdout.write(serializeVolumeBasinDriveSession(session));
