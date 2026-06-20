export const CONSOLES = [
  'NES',
  'SNES',
  'N64',
  'GameCube',
  'Wii',
  'Wii U',
  'Switch',
  'Switch 2',
  'Game Boy',
  'Game Boy Color',
  'Game Boy Advance',
  'DS',
  '3DS',
  'PlayStation',
  'PlayStation 2',
  'PlayStation 3',
  'PlayStation 4',
  'PlayStation 5',
  'PSP',
  'PS Vita',
  'Xbox',
  'Xbox 360',
  'Xbox One',
  'Xbox Series X/S',
  'Sega Genesis',
  'Sega Dreamcast',
  'Atari 2600',
  'Other',
];

export const MEDIA_PLATFORMS = [
  'Book',
  'Manga',
  'Comic',
  'Graphic Novel',
  'Strategy Guide',
] as const;

export const PLATFORM_OPTIONS = [
  ...MEDIA_PLATFORMS,
  ...CONSOLES,
] as const;

export const CONDITIONS = ['Loose', 'CIB', 'Used', 'New', 'Sealed', 'Graded', 'Damaged', 'Untested'] as const;

export const REGIONS = [
  { value: 'US', label: 'US / NTSC', shortLabel: 'NTSC-US' },
  { value: 'JP', label: 'Japan / NTSC-J', shortLabel: 'NTSC-J' },
  { value: 'PAL', label: 'PAL / EU', shortLabel: 'PAL' },
] as const;

export const SHOW_CATEGORIES = [
  '$5 Start',
  '$10 Start',
  'High Value',
  'Bundles',
] as const;
