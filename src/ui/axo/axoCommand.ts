/**
 * `~axo` — the hidden switch for Axo, Autohand's axolotl.
 *
 * Deliberately not a slash command: it never appears in the palette, `/help`, or the
 * docs, and it is handled entirely in the terminal UI, so it never reaches the model.
 */

export type AxoCommand =
  | { readonly kind: 'summon' }
  | { readonly kind: 'feed' }
  | { readonly kind: 'pet' }
  | { readonly kind: 'dance' }
  | { readonly kind: 'sleep' }
  | { readonly kind: 'wake' }
  | { readonly kind: 'home' }
  | { readonly kind: 'help' }
  | { readonly kind: 'say'; readonly text: string };

export const AXO_HELP_TEXT = '~axo feed · pet · dance · sleep · wake · home · or ask me anything';

const AXO_INPUT_PATTERN = /^~axo(?:\s+([\s\S]*))?$/i;

/** True when the composer text is an Axo command rather than a prompt. */
export function isAxoInput(input: string): boolean {
  return AXO_INPUT_PATTERN.test(input.trim());
}

/**
 * Parses `~axo [verb] [words]`. Bare `~axo` summons (or greets); unknown words are a
 * message for Axo to read, so nothing typed after `~axo` is ever lost to the model.
 */
export function parseAxoInput(input: string): AxoCommand | null {
  const match = AXO_INPUT_PATTERN.exec(input.trim());
  if (!match) return null;
  const args = (match[1] ?? '').trim();
  if (args.length === 0) return { kind: 'summon' };
  const word = args.split(/\s+/)[0] ?? '';
  const rest = args.slice(word.length).trim();
  switch (word.toLowerCase()) {
    case 'feed':
    case 'eat':
    case 'snack':
      return { kind: 'feed' };
    case 'pet':
      return { kind: 'pet' };
    case 'dance':
    case 'party':
      return { kind: 'dance' };
    case 'sleep':
    case 'nap':
      return { kind: 'sleep' };
    case 'wake':
      return { kind: 'wake' };
    case 'home':
    case 'bye':
    case 'off':
      return { kind: 'home' };
    case 'help':
    case '?':
      return { kind: 'help' };
    case 'say':
      return rest.length > 0 ? { kind: 'say', text: rest } : { kind: 'help' };
    default:
      return { kind: 'say', text: args };
  }
}
