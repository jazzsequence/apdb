/**
 * Entity schemas for the Actual Play Database.
 *
 * Framework-agnostic on purpose: plain Zod, no Astro imports. The build step,
 * the CI validator and any future Next.js port all consume these same schemas.
 */
import { z } from 'zod';

/** Human-readable slug used as a foreign key: lowercase, digits, single hyphens. */
export const Slug = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'must be a lowercase slug: letters, digits and single hyphens (e.g. "monsterhearts-indie-x")',
  );

/** A partial ISO date. Shows and seasons are frequently only known to the year. */
export const PartialDate = z
  .string()
  .regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'must be YYYY, YYYY-MM or YYYY-MM-DD');

const Links = z
  .object({
    website: z.string().url().optional(),
    wikipedia: z.string().url().optional(),
    youtube: z.string().url().optional(),
    podcast: z.string().url().optional(),
    /** Community forum or wiki. Often the only place an indie show's cast is documented. */
    forum: z.string().url().optional(),
    bluesky: z.string().url().optional(),
    mastodon: z.string().url().optional(),
    twitch: z.string().url().optional(),
  })
  .strict()
  .default({});

/**
 * Provenance. Every credit carries one, backed by git history for the rest.
 * `needs_verification` marks a claim a maintainer asserted but could not cite,
 * so unsourced data is visible rather than silently indistinguishable from
 * sourced data.
 */
export const Source = z
  .object({
    url: z.string().url().optional(),
    note: z.string().min(1).optional(),
    needs_verification: z.boolean().default(false),
  })
  .strict()
  .refine((s) => s.url || s.note, {
    message: 'a source needs at least a url or a note',
  });

// ---------------------------------------------------------------------------
// Channel — the producing entity.
// ---------------------------------------------------------------------------

export const ChannelType = z.enum(['network', 'indie studio', 'solo creator']);

export const Channel = z
  .object({
    id: Slug,
    name: z.string().min(1),
    type: ChannelType,
    description: z.string().optional(),
    links: Links,
  })
  .strict();

// ---------------------------------------------------------------------------
// Game — edition is required. PF2e vs PF1e is a real discovery filter.
// ---------------------------------------------------------------------------

export const Game = z
  .object({
    id: Slug,
    name: z.string().min(1),
    edition: z.string().min(1, 'edition is required — use "N/A" only for editionless games'),
    publisher: z.string().min(1),
    links: Links,
  })
  .strict();

// ---------------------------------------------------------------------------
// Show + Season. Seasons are nested: they have no identity outside their show.
// ---------------------------------------------------------------------------

export const ShowFormat = z.enum(['podcast', 'video', 'stream', 'hybrid']);
export const ShowStatus = z.enum(['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown']);

export const Season = z
  .object({
    ordinal: z.number().int().positive(),
    title: z.string().optional(),
    /** Foreign key -> Game.id */
    game: Slug,
    started: PartialDate.optional(),
    ended: PartialDate.optional(),
    episode_count: z.number().int().positive().optional(),
    description: z.string().optional(),
  })
  .strict();

export const Show = z
  .object({
    id: Slug,
    title: z.string().min(1),
    sort_title: z.string().optional(),
    /** Foreign keys -> Channel.id. A show can be co-produced. */
    channels: z.array(Slug).min(1),
    format: ShowFormat,
    status: ShowStatus,
    description: z.string().optional(),
    links: Links,
    seasons: z.array(Season).min(1),
  })
  .strict()
  .superRefine((show, ctx) => {
    const seen = new Set<number>();
    for (const season of show.seasons) {
      if (seen.has(season.ordinal)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['seasons'],
          message: `duplicate season ordinal ${season.ordinal}`,
        });
      }
      seen.add(season.ordinal);
    }
  });

// ---------------------------------------------------------------------------
// Person, Alias, Credit — the point of the project.
// ---------------------------------------------------------------------------

export const AliasType = z.enum(['birth', 'maiden', 'stage', 'handle', 'legal']);

export const Alias = z
  .object({
    /** Local id, unique within the person. Credits reference this. */
    id: Slug,
    name: z.string().min(1),
    alias_type: AliasType,
    active_from: PartialDate.optional(),
    active_to: PartialDate.optional(),
    note: z.string().optional(),
  })
  .strict();

export const CreditRole = z.enum([
  'GM/DM',
  'player',
  'guest GM',
  'guest player',
  'host',
  'producer',
  'editor',
  'composer',
  'writer',
]);

/**
 * The polymorphic join, and the reason this project exists.
 *
 * Main-cast credits reference the season. One-off guest spots additionally
 * carry a free-text `episode` locator ("S2E14"), which is what surfaces a
 * single indie guest appearance on a performer's page without forcing anyone
 * to catalogue every episode as its own entity.
 */
export const Credit = z
  .object({
    /** Foreign key -> Show.id */
    show: Slug,
    /** Foreign key -> Season.ordinal within that show. Omit for show-level credits. */
    season: z.number().int().positive().optional(),
    /** Free-text episode locator, e.g. "S2E14" or "Ep. 12: The Hollow". */
    episode: z.string().min(1).optional(),
    role: CreditRole,
    character: z.string().min(1).optional(),
    /** Foreign key -> Alias.id within this same person. The name credited at the time. */
    alias: Slug,
    year: PartialDate.optional(),
    note: z.string().optional(),
    source: Source,
  })
  .strict()
  .superRefine((credit, ctx) => {
    if (credit.episode && credit.season === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['season'],
        message: 'an episode-level credit must also name its season',
      });
    }
    const isGuest = credit.role === 'guest GM' || credit.role === 'guest player';
    if (isGuest && !credit.episode && !credit.note) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['episode'],
        message:
          'a guest credit should carry an episode locator (or a note explaining why it spans a season)',
      });
    }
  });

export const Person = z
  .object({
    id: Slug,
    canonical_name: z.string().min(1),
    /** "Iyengar, Aabria" — used for indexing and A-Z listing. */
    sort_name: z.string().min(1),
    pronouns: z.string().optional(),
    bio: z.string().optional(),
    wikidata_qid: z
      .string()
      .regex(/^Q\d+$/, 'must be a Wikidata QID like Q117600290')
      .optional(),
    links: Links,
    aliases: z.array(Alias).min(1, 'every person needs at least one alias — the name they are credited under'),
    credits: z.array(Credit).default([]),
  })
  .strict()
  .superRefine((person, ctx) => {
    const seen = new Set<string>();
    for (const alias of person.aliases) {
      if (seen.has(alias.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['aliases'],
          message: `duplicate alias id "${alias.id}"`,
        });
      }
      seen.add(alias.id);
    }
    if (!person.aliases.some((a) => a.name === person.canonical_name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['aliases'],
        message: `canonical_name "${person.canonical_name}" must also appear as one of the aliases`,
      });
    }
  });

export type Channel = z.infer<typeof Channel>;
export type Game = z.infer<typeof Game>;
export type Season = z.infer<typeof Season>;
export type Show = z.infer<typeof Show>;
export type Alias = z.infer<typeof Alias>;
export type Credit = z.infer<typeof Credit>;
export type Person = z.infer<typeof Person>;
export type CreditRole = z.infer<typeof CreditRole>;
