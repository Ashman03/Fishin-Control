/**
 * art.js — the species pictures on the "what's biting" cards.
 *
 * Painted illustrations, one per species, made from the source artwork by
 * tools/prepare-species.py: 600 × 320 WebP with transparency, the animal
 * centred with even padding so every card lines up. They sit at the site root
 * because GitHub's web upload can't send folders.
 *
 * Until v4.8 this file also held a 1,900-line SVG drawing kit as a fallback.
 * A species without a picture yet must be listed in ART_PENDING (a test makes
 * sure of it). Its card shows a faint fish silhouette in a frame of the same shape
 * until the painting arrives.
 */

export const SPECIES_IMAGES = {
  Barramundi: 'species-barramundi.webp',
  Blackall: 'species-blackall.webp',
  'Blue salmon': 'species-blue-salmon.webp',
  Bream: 'species-bream.webp',
  'Coral trout': 'species-coral-trout.webp',
  'Estuary cod': 'species-estuary-cod.webp',
  Flathead: 'species-flathead.webp',
  'Grass sweetlip': 'species-grass-sweetlip.webp',
  Grunter: 'species-grunter.webp',
  'Longtail tuna': 'species-longtail-tuna.webp',
  'Mac tuna': 'species-mac-tuna.webp',
  'Mangrove jack': 'species-mangrove-jack.webp',
  'Mud crab': 'species-mud-crab.webp',
  Mulloway: 'species-mulloway.webp',
  Prawns: 'species-prawns.webp',
  Queenfish: 'species-queenfish.webp',
  'Red emperor': 'species-red-emperor.webp',
  'School mackerel': 'species-school-mackerel.webp',
  Snapper: 'species-snapper.webp',
  'Spanish mackerel': 'species-spanish-mackerel.webp',
  'Spotted mackerel': 'species-spotted-mackerel.webp',
  Squid: 'species-squid.webp',
  Threadfin: 'species-threadfin.webp',
  Trevally: 'species-trevally.webp',
  Tuskfish: 'species-tuskfish.webp',
  Whiting: 'species-whiting.webp'
};

/** Species still waiting on a painting (none at the moment). Remove each one as its picture lands. */
export const ART_PENDING = [];

// A plain fish shape, filled faintly, standing in for a missing painting.
const PLACEHOLDER =
  '<svg viewBox="0 0 150 80"><path d="M22 40c14-17 40-24 64-20 13 2 24 9 32 20-8 11-19 18-32 20-24 4-50-3-64-20z' +
  'M118 40l20-16-5 16 5 16z"/><circle cx="40" cy="36" r="3"/></svg>';

const BY_NAME = new Map(Object.entries(SPECIES_IMAGES).map(([k, v]) => [k.toLowerCase(), v]));

/** True if the species has a picture. */
export const hasImage = name => BY_NAME.has(String(name).toLowerCase());

/**
 * The picture for a card. alt is empty because the card prints the name right
 * underneath; width and height reserve the space so nothing jumps as it loads.
 */
export function speciesArt(name) {
  const src = BY_NAME.get(String(name).toLowerCase());
  return src
    ? `<img class="sp" src="${src}" alt="" width="600" height="320" loading="lazy" decoding="async">`
    : `<span class="sp sp-none" aria-hidden="true">${PLACEHOLDER}</span>`;
}
