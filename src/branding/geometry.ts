/** Coordinates are aligned to the approved 1254px artwork and fixed throughout motion. */
export const BRAND_MASTER = '/branding/solanime-wordmark-sprite.webp';
export const BRAND_SUN = '/branding/solanime-sun.webp';
export const BRAND_FOREGROUND = '/branding/solanime-ribbon.webp';
export const EXTRACTED_PLAY = 'M559 406 C559 392 571 389 582 396 L688 458 C707 470 709 485 695 494 L648 513 L559 478 Z';
export const BRAND_SIZE = 1254;
export const BRAND_VIEWBOX = { full: '150 130 960 850', emblem: '369 163 540 540', compact: '0 0 1100 220' } as const;

// The foreground itself occludes the sunrise. This aperture only stops the
// reconstructed lower sun from showing through the ribbon's open lower loop.
export const SUN_WINDOW = 'M374 432 L374 150 H901 V432 L852 455 L786 461 L727 438 L640 398 L531 379 L474 461 Z';
export const FRONT_TRAVEL = 'M401 337 C369 426 501 446 609 497 C699 538 766 596 709 645 C654 694 463 660 407 537';
export const BACK_TRAVEL = 'M682 291 C791 318 874 422 888 491 M700 304 C788 349 854 496 829 628';

// Letter rectangles partition the original wordmark. There is no replacement font.
export const LETTERS = [
  { glyph: 'S', x: 185, width: 156 }, { glyph: 'o', x: 341, width: 132 },
  { glyph: 'l', x: 475, width: 38 }, { glyph: 'a', x: 516, width: 124 },
  { glyph: 'n', x: 641, width: 107 }, { glyph: 'i', x: 750, width: 36 },
  { glyph: 'm', x: 787, width: 162 }, { glyph: 'e', x: 950, width: 122 },
] as const;
