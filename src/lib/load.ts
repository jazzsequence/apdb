/**
 * Reads the flat YAML files in /data and parses them against the schemas.
 *
 * Deliberately dependency-light and framework-free — `node`, `yaml`, `zod`.
 * Both the CI validator and the static build call this.
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { Channel, Game, Person, Show } from './schema.js';

export const DATA_ROOT = fileURLToPath(new URL('../../data/', import.meta.url));

/** A schema or referential-integrity problem, located precisely enough to fix. */
export interface Problem {
  file: string;
  path?: string;
  message: string;
}

export interface Dataset {
  people: Person[];
  shows: Show[];
  channels: Channel[];
  games: Game[];
}

const EXTENSIONS = new Set(['.yml', '.yaml']);

async function listDataFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => EXTENSIONS.has(extname(name)) && !name.startsWith('.'))
    .sort()
    .map((name) => join(dir, name));
}

/**
 * Parse every file in one collection directory. Collects problems instead of
 * throwing, so a contributor sees every error in their PR at once rather than
 * fixing them one CI run at a time.
 */
async function loadCollection<S extends z.ZodTypeAny>(
  dirName: string,
  schema: S,
  problems: Problem[],
): Promise<z.infer<S>[]> {
  const files = await listDataFiles(join(DATA_ROOT, dirName));
  const records: z.infer<S>[] = [];

  for (const file of files) {
    const relative = `data/${dirName}/${basename(file)}`;
    let raw: unknown;

    try {
      raw = parseYaml(await readFile(file, 'utf8'));
    } catch (error) {
      problems.push({
        file: relative,
        message: `could not parse YAML: ${(error as Error).message}`,
      });
      continue;
    }

    if (raw === null || typeof raw !== 'object') {
      problems.push({ file: relative, message: 'file is empty or is not a YAML mapping' });
      continue;
    }

    const result = schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        problems.push({
          file: relative,
          path: issue.path.join('.') || undefined,
          message: issue.message,
        });
      }
      continue;
    }

    // The filename is the id. Enforcing this keeps the URL, the file path and
    // the foreign key identical, which is what makes the repo browsable.
    const expected = basename(file, extname(file));
    if (result.data.id !== expected) {
      problems.push({
        file: relative,
        path: 'id',
        message: `id "${result.data.id}" does not match filename "${expected}" — they must be the same slug`,
      });
      continue;
    }

    records.push(result.data);
  }

  return records;
}

/** Load and schema-validate the whole dataset. */
export async function loadDataset(): Promise<{ dataset: Dataset; problems: Problem[] }> {
  const problems: Problem[] = [];

  const [people, shows, channels, games] = await Promise.all([
    loadCollection('people', Person, problems),
    loadCollection('shows', Show, problems),
    loadCollection('channels', Channel, problems),
    loadCollection('games', Game, problems),
  ]);

  return { dataset: { people, shows, channels, games }, problems };
}
