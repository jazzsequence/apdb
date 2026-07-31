/**
 * Joins the normalized data into the denormalized views the pages render.
 *
 * Credits live in the person file, so the filmography is the literal source of
 * truth; show cast lists are derived by inverting credits here at build time.
 */
import type { Dataset } from './load.js';
import type { Alias, Channel, Credit, Game, Person, Season, Show } from './schema.js';

export interface ResolvedCredit {
  credit: Credit;
  show: Show;
  season?: Season;
  game?: Game;
  channels: Channel[];
  /** The name this person was credited under at the time. */
  alias: Alias;
  /** True when the credited name differs from the person's canonical name. */
  creditedUnderFormerName: boolean;
}

/** One show's worth of a person's credits — the unit the filmography renders. */
export interface FilmographyGroup {
  show: Show;
  channels: Channel[];
  credits: ResolvedCredit[];
  /** Earliest known year across the group, used for sorting. Undefined sorts last. */
  earliestYear?: string;
  latestYear?: string;
}

export interface CastMember {
  person: Person;
  credit: Credit;
  alias: Alias;
  season?: Season;
}

export class Db {
  readonly people: Person[];
  readonly shows: Show[];
  readonly channels: Channel[];
  readonly games: Game[];

  #showsById: Map<string, Show>;
  #channelsById: Map<string, Channel>;
  #gamesById: Map<string, Game>;
  #peopleById: Map<string, Person>;

  constructor(dataset: Dataset) {
    this.people = [...dataset.people].sort((a, b) => a.sort_name.localeCompare(b.sort_name));
    this.shows = [...dataset.shows].sort((a, b) =>
      (a.sort_title ?? a.title).localeCompare(b.sort_title ?? b.title),
    );
    this.channels = [...dataset.channels].sort((a, b) => a.name.localeCompare(b.name));
    this.games = [...dataset.games].sort((a, b) => a.name.localeCompare(b.name));

    this.#showsById = new Map(this.shows.map((s) => [s.id, s]));
    this.#channelsById = new Map(this.channels.map((c) => [c.id, c]));
    this.#gamesById = new Map(this.games.map((g) => [g.id, g]));
    this.#peopleById = new Map(this.people.map((p) => [p.id, p]));
  }

  show(id: string): Show | undefined {
    return this.#showsById.get(id);
  }

  person(id: string): Person | undefined {
    return this.#peopleById.get(id);
  }

  game(id: string): Game | undefined {
    return this.#gamesById.get(id);
  }

  channelsFor(show: Show): Channel[] {
    return show.channels
      .map((id) => this.#channelsById.get(id))
      .filter((c): c is Channel => Boolean(c));
  }

  resolveCredit(person: Person, credit: Credit): ResolvedCredit | undefined {
    const show = this.#showsById.get(credit.show);
    const alias = person.aliases.find((a) => a.id === credit.alias);
    // Integrity validation guarantees both exist; guard so a rendering bug can
    // never be caused by data the validator already rejects.
    if (!show || !alias) return undefined;

    const season =
      credit.season === undefined
        ? undefined
        : show.seasons.find((s) => s.ordinal === credit.season);

    return {
      credit,
      show,
      season,
      game: season ? this.#gamesById.get(season.game) : undefined,
      channels: this.channelsFor(show),
      alias,
      creditedUnderFormerName: alias.name !== person.canonical_name,
    };
  }

  /**
   * A person's complete filmography, grouped by show and sorted most recent
   * first. This is the headline view: every credit across every show, with the
   * one-off indie guest spots sitting alongside the marquee work.
   */
  filmography(person: Person): FilmographyGroup[] {
    const groups = new Map<string, FilmographyGroup>();

    for (const credit of person.credits) {
      const resolved = this.resolveCredit(person, credit);
      if (!resolved) continue;

      let group = groups.get(resolved.show.id);
      if (!group) {
        group = { show: resolved.show, channels: resolved.channels, credits: [] };
        groups.set(resolved.show.id, group);
      }
      group.credits.push(resolved);
    }

    for (const group of groups.values()) {
      const years = group.credits
        .map((c) => c.credit.year ?? c.season?.started)
        .filter((y): y is string => Boolean(y))
        .sort();
      group.earliestYear = years[0];
      group.latestYear = years[years.length - 1];

      group.credits.sort((a, b) => {
        const seasonDiff = (a.credit.season ?? 0) - (b.credit.season ?? 0);
        if (seasonDiff !== 0) return seasonDiff;
        return (a.credit.episode ?? '').localeCompare(b.credit.episode ?? '');
      });
    }

    return [...groups.values()].sort((a, b) => {
      // Undated groups sort last rather than pretending to be ancient.
      if (!a.latestYear && !b.latestYear) return a.show.title.localeCompare(b.show.title);
      if (!a.latestYear) return 1;
      if (!b.latestYear) return -1;
      return b.latestYear.localeCompare(a.latestYear);
    });
  }

  /** Invert credits to get a show's cast. Never stored — always derived. */
  castFor(show: Show): CastMember[] {
    const cast: CastMember[] = [];

    for (const person of this.people) {
      for (const credit of person.credits) {
        if (credit.show !== show.id) continue;
        const alias = person.aliases.find((a) => a.id === credit.alias);
        if (!alias) continue;
        cast.push({
          person,
          credit,
          alias,
          season: show.seasons.find((s) => s.ordinal === credit.season),
        });
      }
    }

    return cast.sort((a, b) => {
      const seasonDiff = (a.credit.season ?? 0) - (b.credit.season ?? 0);
      if (seasonDiff !== 0) return seasonDiff;
      return a.person.sort_name.localeCompare(b.person.sort_name);
    });
  }

  /** Distinct games played across a show's seasons, for faceting. */
  gamesFor(show: Show): Game[] {
    const ids = new Set(show.seasons.map((s) => s.game));
    return [...ids].map((id) => this.#gamesById.get(id)).filter((g): g is Game => Boolean(g));
  }

  /**
   * Every name a person can be found by. Fed into the search index pointed at
   * the canonical person route, so searching a former name resolves to the
   * one person who used it.
   */
  searchableNames(person: Person): string[] {
    const names = new Set<string>([person.canonical_name, ...person.aliases.map((a) => a.name)]);
    return [...names];
  }
}
