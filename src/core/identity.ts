// Aliases, avatars and safety codes, all derived from public keys.
// Nothing here is ever typed by a person: an alias is a pure function of a key.
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

// 64 x 64 words x 90 numbers = 368,640 aliases. Lists are curated so no pairing reads badly.
export const ADJECTIVES = [
  "amber", "arctic", "autumn", "azure", "bold", "brisk", "bright", "calm",
  "cedar", "clever", "cobalt", "copper", "coral", "crisp", "dawn", "dusky",
  "ember", "fern", "frost", "gentle", "gilded", "golden", "hazel", "honey",
  "indigo", "ivory", "jade", "keen", "lively", "lunar", "maple", "meadow",
  "misty", "mossy", "noble", "ocean", "olive", "onyx", "pale", "pearl",
  "plum", "quiet", "rapid", "rosy", "rustic", "sage", "silver", "solar",
  "spring", "starry", "steady", "stone", "sunny", "swift", "tidal", "topaz",
  "umber", "velvet", "violet", "warm", "willow", "winter", "young", "zesty",
];
export const NOUNS = [
  "badger", "bison", "brook", "canyon", "cedar", "comet", "crane", "cricket",
  "dingo", "dolphin", "eagle", "egret", "falcon", "fern", "finch", "fox",
  "gecko", "glacier", "harbor", "hawk", "heron", "ibis", "island", "kestrel",
  "koala", "lantern", "lark", "lynx", "magpie", "maple", "meadow", "moon",
  "nebula", "orchid", "osprey", "otter", "owl", "panda", "pebble", "pelican",
  "pine", "quokka", "raven", "reef", "river", "robin", "sparrow", "spruce",
  "star", "stork", "summit", "swan", "thistle", "tiger", "tulip", "valley",
  "wallaby", "willet", "wombat", "wren", "yarrow", "zebra", "zephyr", "ibex",
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function digest(pubkeyHex: string): Uint8Array {
  return sha256(hexToBytes(pubkeyHex));
}

/** "Amber Falcon 42": the alias a contact knows this key by. */
export function aliasFor(pubkeyHex: string): string {
  const d = digest(pubkeyHex);
  return `${cap(ADJECTIVES[d[0] % 64])} ${cap(NOUNS[d[1] % 64])} ${10 + (d[2] % 90)}`;
}

/** A 5x5 mirrored pattern and a hue, for the avatar drawn next to an alias. */
export function avatarFor(pubkeyHex: string): { hue: number; cells: boolean[][] } {
  const d = digest(pubkeyHex);
  const hue = Math.round((d[3] * 360) / 256);
  const cells: boolean[][] = [];
  for (let y = 0; y < 5; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < 5; x++) {
      const col = x < 3 ? x : 4 - x;
      row.push(((d[4 + y] >> col) & 1) === 1);
    }
    cells.push(row);
  }
  return { hue, cells };
}

export const SAFETY_SYMBOLS = [
  "🦊", "🌵", "🚀", "🍋", "🐙", "🎈", "🌙", "🔑", "🐝", "🍄", "⚓", "🎲", "🦉", "🌊", "🍇", "🔔",
  "🐢", "🌻", "🧭", "🪁", "🐳", "🍉", "🎸", "🌈", "🦋", "🍒", "🏔️", "🐧", "🌷", "⭐", "🦀", "🎯",
];

/** Four symbols both phones show while pairing. Same inputs in any order give the same code. */
export function safetyCode(pubA: string, pubB: string): string[] {
  const [x, y] = [pubA, pubB].sort();
  const d = sha256(utf8ToBytes(`ashnote-safety:${x}:${y}`));
  return [0, 1, 2, 3].map((i) => SAFETY_SYMBOLS[d[i] % SAFETY_SYMBOLS.length]);
}
