/**
 * Is this thing an actual play?
 *
 * The gate that keeps a person-first sweep from turning this index into a
 * general filmography. Wikipedia articles about actual-play performers are
 * full of voice roles, hosting gigs, film and TV, and none of it belongs
 * here — the project indexes actual play, and a credit for a video game or a
 * sitcom is out of scope no matter how well sourced it is.
 *
 * The decision is made from the *work's* own article, never from the person's
 * table row. A row saying "Voice" tells you what they did, not what the thing
 * is, and a row saying "Herself" appears on game shows and actual plays alike.
 * Categories are the strongest signal Wikipedia offers: "Actual play web
 * series" is an explicit statement by the people who catalogue this.
 *
 * Three verdicts, on purpose. `unclear` is not a soft `include` — it is the
 * bucket a human looks at, and collapsing it into either of the others is how
 * a sweep either misses shows or pollutes the catalogue.
 */

export type Verdict = 'actual-play' | 'excluded' | 'unclear';

export interface Classification {
  verdict: Verdict;
  /** Why, in the order the rules fired. Goes straight into the report. */
  reasons: string[];
}

/** An explicit statement that the work is an actual play. */
const AP_CATEGORY = /actual[ -]play/i;

/**
 * Categories that put a work in TTRPG territory without saying "actual play".
 * On their own these are suggestive, not sufficient — a Dungeons & Dragons
 * *film* matches too, which is why the exclusions run first.
 */
const TTRPG_CATEGORY =
  /(role-playing game|roleplaying game|tabletop game|dungeons & dragons|dungeons and dragons|pathfinder|call of cthulhu|vampire: the masquerade|world of darkness|tabletop role)/i;

/**
 * Work types that are not actual play, however TTRPG-adjacent the subject.
 * Checked against categories, where the type is stated, rather than prose.
 */
const EXCLUDED_CATEGORY =
  /\b(films?|feature films?|television series|television films?|sitcoms?|soap operas?|video games?|animated (?:series|films?)|anime|comics?|graphic novels?|albums?|songs?|singles?|novels?|books?|video game franchises|board games?|card games?|role-playing game systems?|tabletop role-playing games)\b/i;

/** Prose signals in the work's own lead. Weaker than a category, still real. */
const AP_TEXT =
  /\b(actual[ -]play|live ?play|liveplay|play(?:s|ed|ing)? (?:a|the)? ?(?:campaign|one-shot)|streamed (?:campaign|game)|tabletop role-playing game (?:web series|series|podcast|show)|game master|dungeon master|storyteller)\b/i;

const MEDIUM_TEXT = /\b(web series|webseries|podcast|twitch|youtube|stream(?:ed|ing)?|series)\b/i;

/**
 * Roles that describe non-play work. A person's row can be excluded even on an
 * actual-play show — voicing a character in an animated adaptation of a
 * campaign is not a seat at the table.
 */
const NON_PLAY_ROLE = /\b(voice|voice role|additional voices|narrator only|animated)\b/i;

export interface WorkFacts {
  categories?: string[];
  /** The work article's lead paragraph, plain text. */
  extract?: string;
  /** True when Wikipedia has no article for the link at all. */
  missing?: boolean;
  /** The section of the person's article the candidate came from. */
  section?: string;
  /** The raw role cell / prose role, for the non-play check. */
  role?: string;
}

export function classify(title: string, facts: WorkFacts): Classification {
  const reasons: string[] = [];
  const categories = facts.categories ?? [];
  const extract = facts.extract ?? '';
  const section = facts.section ?? '';

  const apCategory = categories.filter((c) => AP_CATEGORY.test(c));
  if (apCategory.length > 0) {
    reasons.push(`category "${apCategory[0]}"`);
    // An explicit AP category beats everything, but a voice-only role on it is
    // still not a playing credit.
    if (facts.role && NON_PLAY_ROLE.test(facts.role)) {
      return { verdict: 'unclear', reasons: [...reasons, `but role reads "${facts.role}" — not a seat at the table`] };
    }
    return { verdict: 'actual-play', reasons };
  }

  const excluded = categories.filter((c) => EXCLUDED_CATEGORY.test(c) && !AP_CATEGORY.test(c));
  const ttrpg = categories.filter((c) => TTRPG_CATEGORY.test(c));
  if (excluded.length > 0 && ttrpg.every((c) => EXCLUDED_CATEGORY.test(c))) {
    return { verdict: 'excluded', reasons: [`category "${excluded[0]}" — not an actual play`] };
  }

  if (AP_TEXT.test(extract) && MEDIUM_TEXT.test(extract)) {
    reasons.push('lead describes an actual play / live play series');
    return { verdict: 'actual-play', reasons };
  }

  if (ttrpg.length > 0) {
    reasons.push(`category "${ttrpg[0]}" — tabletop, but nothing says actual play`);
    return { verdict: 'unclear', reasons };
  }

  if (/\b(film|television|tv|video game|music|discography|theatre|theater|writing|bibliography)\b/i.test(section)) {
    return { verdict: 'excluded', reasons: [`listed under "${section}" on the person's article`] };
  }

  if (facts.missing) {
    reasons.push('no Wikipedia article for this work — nothing to classify it by');
    return { verdict: 'unclear', reasons };
  }

  reasons.push('no actual-play signal in categories or lead');
  return { verdict: 'unclear', reasons };
}
