export const DECOR_SEATS = ['top', 'left', 'right', 'bottom'] as const;
export type DecorSeat = (typeof DECOR_SEATS)[number];

export type DecorVisual =
  | 'coffee'
  | 'drink'
  | 'ashtray'
  | 'dish'
  | 'phone'
  | 'fruit'
  | 'candle'
  | 'plant'
  | 'keys'
  | 'book';

export type TableProp = {
  readonly id: string;
  readonly label: string;
  readonly visual: DecorVisual;
  readonly motion?: 'steam' | 'smoke' | 'glint' | 'flicker' | 'sway';
};

export type DecorCombo = {
  readonly id: string;
  readonly items: readonly string[];
};

/** The pool is intentionally data-only: it cannot affect game state or actions. */
export const TABLE_PROPS: readonly TableProp[] = [
  ['tea-glass', 'Tea in a glass', 'drink', 'steam'],
  ['tea-mug', 'Tea in a mug', 'coffee', 'steam'],
  ['teapot', 'Teapot', 'drink', 'steam'],
  ['coffee', 'Coffee', 'coffee', 'steam'],
  ['espresso', 'Espresso', 'coffee', 'steam'],
  ['cappuccino', 'Cappuccino', 'coffee', 'steam'],
  ['turkish-coffee', 'Turkish coffee', 'coffee', 'steam'],
  ['water', 'Water', 'drink'],
  ['mineral-water', 'Mineral water', 'drink', 'glint'],
  ['juice', 'Juice', 'drink'],
  ['lemonade', 'Lemonade', 'drink', 'glint'],
  ['iced-glass', 'Glass with ice', 'drink', 'glint'],
  ['whisky', 'Whisky', 'drink', 'glint'],
  ['cognac', 'Cognac', 'drink', 'glint'],
  ['wine', 'Wine', 'drink', 'glint'],
  ['beer', 'Beer', 'drink', 'glint'],
  ['grapes', 'Grapes', 'fruit'],
  ['apple', 'Apple', 'fruit'],
  ['pear', 'Pear', 'fruit'],
  ['mandarin', 'Mandarin', 'fruit'],
  ['orange', 'Orange', 'fruit'],
  ['banana', 'Banana', 'fruit'],
  ['strawberries', 'Strawberries', 'fruit'],
  ['fruit-plate', 'Small fruit plate', 'dish'],
  ['nuts', 'Nuts', 'dish'],
  ['pistachios', 'Pistachios', 'dish'],
  ['seeds', 'Seeds', 'dish'],
  ['dried-fruit', 'Dried fruit', 'dish'],
  ['chocolate', 'Chocolate', 'dish'],
  ['sweets', 'Sweets', 'dish'],
  ['cookies', 'Cookies', 'dish'],
  ['baklava', 'Baklava', 'dish'],
  ['halva', 'Halva', 'dish'],
  ['cake', 'Cake', 'dish'],
  ['cheese', 'Cheese', 'dish'],
  ['olives', 'Olives', 'dish'],
  ['phone', 'Phone', 'phone'],
  ['keys', 'Keys', 'keys'],
  ['wallet', 'Wallet', 'book'],
  ['glasses', 'Glasses', 'keys'],
  ['watch', 'Watch', 'keys'],
  ['pen', 'Pen', 'keys'],
  ['notebook', 'Notebook', 'book'],
  ['napkin', 'Napkin', 'dish'],
  ['spoon', 'Spoon', 'keys'],
  ['coaster', 'Coaster', 'dish'],
  ['small-plate', 'Small plate', 'dish'],
  ['candy-box', 'Candy box', 'book'],
  ['book', 'Book', 'book'],
  ['newspaper', 'Newspaper', 'book'],
  ['remote', 'Remote control', 'phone'],
  ['prayer-beads', 'Prayer beads', 'keys'],
  ['cigarette', 'Cigarette in ashtray', 'ashtray', 'smoke'],
  ['cigar', 'Cigar', 'ashtray', 'smoke'],
  ['ashtray', 'Ashtray', 'ashtray'],
  ['lighter', 'Lighter', 'keys'],
  ['matches', 'Matches', 'book'],
  ['candle', 'Candle', 'candle', 'flicker'],
  ['plant', 'Small plant', 'plant', 'sway'],
  ['saucer', 'Saucer', 'dish'],
  ['coffee-beans', 'Coffee beans', 'dish'],
].map(([id, label, visual, motion]) => ({
  id,
  label,
  visual,
  ...(motion ? { motion } : {}),
})) as readonly TableProp[];

export const DECOR_COMBOS: readonly DecorCombo[] = [
  { id: 'tea-cookies', items: ['tea-glass', 'cookies'] },
  { id: 'coffee-phone', items: ['coffee', 'phone'] },
  { id: 'espresso-chocolate', items: ['espresso', 'chocolate'] },
  { id: 'whisky-ice', items: ['whisky', 'iced-glass'] },
  { id: 'cigar-set', items: ['cigar', 'ashtray', 'lighter'] },
  { id: 'grapes-nuts', items: ['grapes', 'nuts'] },
  { id: 'tea-baklava', items: ['tea-mug', 'baklava'] },
  { id: 'water-pistachios', items: ['mineral-water', 'pistachios'] },
  { id: 'coffee-notebook', items: ['cappuccino', 'notebook'] },
  { id: 'apple-tea', items: ['tea-glass', 'apple'] },
  { id: 'juice-cookies', items: ['juice', 'cookies'] },
  { id: 'cognac-chocolate', items: ['cognac', 'chocolate'] },
  { id: 'wine-cheese', items: ['wine', 'cheese'] },
  { id: 'lemonade-fruit', items: ['lemonade', 'fruit-plate'] },
  { id: 'turkish-coffee-beads', items: ['turkish-coffee', 'prayer-beads'] },
  { id: 'candle-book', items: ['candle', 'book'] },
  { id: 'beer-olives', items: ['beer', 'olives'] },
  { id: 'plant-water', items: ['plant', 'water'] },
] as const;

const byId = new Map(TABLE_PROPS.map((prop) => [prop.id, prop]));

function hashSeed(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function random(seed: number): () => number {
  let value = seed || 1;
  return () => {
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export type SeatDecor = {
  readonly seat: DecorSeat;
  readonly combo: DecorCombo;
  readonly props: readonly TableProp[];
};

/** Stable for a room/round/seat and independent of render order or client. */
export function selectTableDecor(seed: string): readonly SeatDecor[] {
  const used = new Set<number>();
  return DECOR_SEATS.map((seat, seatIndex) => {
    const next = random(hashSeed(`${seed}|${seat}|${seatIndex}`));
    let index = Math.floor(next() * DECOR_COMBOS.length);
    for (
      let attempt = 0;
      used.has(index) && attempt < DECOR_COMBOS.length;
      attempt++
    )
      index = (index + 1) % DECOR_COMBOS.length;
    used.add(index);
    const combo = DECOR_COMBOS[index]!;
    return {
      seat,
      combo,
      props: combo.items.flatMap((id) => {
        const prop = byId.get(id);
        return prop ? [prop] : [];
      }),
    };
  });
}

export function tableDecorSeed(
  roomId: string,
  matchId?: string,
  roundNumber?: number,
): string {
  return `${roomId}|${matchId ?? 'lobby'}|${roundNumber ?? 0}`;
}
