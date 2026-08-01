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
 * Source reliability tiers, strongest first.
 *
 * Modelled on Wikipedia's source hierarchy, with one deliberate divergence:
 * Wikipedia's No Original Research rule makes unpublished first-hand accounts
 * inadmissible. That rule assumes published sources reliably exist. For the
 * indie long tail they frequently do not — small shows keep no cast lists, and
 * boilerplate show notes cannot register a mid-season cast change. Applying
 * NOR here would delete precisely the data no other index has.
 *
 * The ladder ranks by PROXIMITY to the fact: who was closest to the thing
 * happening. It deliberately does not rank by citability — whether a stranger
 * can go and check is tracked separately, by `needs_verification`. Those two
 * axes come apart constantly, and an earlier version of this list conflated
 * them, which had the effect of ranking a contributor who watched the episode
 * below a stranger's summary of it. That was wrong.
 *
 * Every tier here names something a person observed. An earlier version also
 * carried an `inferred` tier, which was a category error: nobody submits a
 * credit without having seen something, so inference never explains how a
 * credit came to exist. It only ever describes a FIELD that was derived after
 * the fact — see `Credit.inferred_fields`. Inference is an operation performed
 * on data, not a source of it.
 *
 * A tier is a statement about proximity, never about truth.
 */
export const SOURCE_TIERS = [
  /** The production's own record: cast list, title card, official announcement. */
  'official',
  /** The episode itself, cited with a locator someone else could go to. */
  'recording',
  /** A statement by someone who was at the table. */
  'participant',
  /**
   * A named contributor who watched or listened to it themselves, with no
   * citable locator.
   *
   * This ranks above the published tiers on purpose. Someone who saw the
   * episode is observing the primary record directly; a reference work is
   * summarising it at a distance, and summaries of small shows are routinely
   * wrong or silent. Wikipedia's filmography table lists Aabria Iyengar as a
   * player on Pirates of Salt Bay when she ran it — an error no viewer would
   * have made. What firsthand lacks is citability, not proximity, and
   * citability is tracked separately by `needs_verification`.
   */
  'firsthand',
  /** An established reference work: Wikipedia, Wikidata, a published database. */
  'reference',
  /** Fan wiki, forum thread, or third-party social post. */
  'community',
] as const;

export const SourceTier = z.enum(SOURCE_TIERS);

/** 1 = strongest. Used for ranking and for the derived confidence label. */
export function tierRank(tier: (typeof SOURCE_TIERS)[number]): number {
  return SOURCE_TIERS.indexOf(tier) + 1;
}

/**
 * One thing a claim rests on. Credits carry a list of these; git history covers
 * the rest.
 *
 * There is no `needs_verification` flag. Corroboration is not a property of a
 * source — it is what you get when two independent sources agree, so it is
 * derived from the list rather than asserted by whoever happened to file first.
 * See `corroboration()` in derive.ts.
 */
export const Source = z
  .object({
    url: z.string().url().optional(),
    note: z.string().min(1).optional(),
    tier: SourceTier.default('reference'),
    /** Who gave the account. Required for firsthand and participant tiers. */
    attested_by: z.string().min(1).optional(),
    /** Where in the recording, e.g. "01:14:20". Required for the recording tier. */
    locator: z.string().min(1).optional(),
  })
  .strict()
  .refine((s) => s.url || s.note, {
    message: 'a source needs at least a url or a note',
  })
  .refine((s) => !['firsthand', 'participant'].includes(s.tier) || Boolean(s.attested_by), {
    message: 'a firsthand or participant source must record who attested it (attested_by)',
    path: ['attested_by'],
  })
  // `recording` and `firsthand` are the same observation; the locator is the
  // only difference. Without one, say firsthand — it claims no less proximity,
  // just no citation.
  .refine((s) => s.tier !== 'recording' || Boolean(s.locator ?? s.url), {
    message:
      'a recording source needs a locator (timestamp/episode position) or a url — without one this is the `firsthand` tier, which claims the same proximity but no citation',
    path: ['locator'],
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
    /**
     * Foreign key -> Alias.id within this same person: the name credited at the
     * time.
     *
     * Optional on purpose. Knowing someone appeared and not knowing which name
     * was on the title card is an extremely common state, and a required field
     * here does not produce knowledge — it produces guesses. An earlier version
     * made this mandatory, and the result was exactly that: attributions
     * derived from dates and recorded as if they were observed. Leave it out
     * when nobody saw the billing.
     */
    alias: Slug.optional(),
    year: PartialDate.optional(),
    note: z.string().optional(),
    /**
     * Everything this credit rests on. A claim gains strength as independent
     * sources accumulate, so this is a list — two people who each watched the
     * episode corroborate each other without any publisher being involved.
     */
    sources: z.array(Source).min(1, 'a credit needs at least one source'),
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
