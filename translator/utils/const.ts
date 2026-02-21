export const maxWorkers = 3;
export const maxWorkersFallback = 4;
export const maxMarkerAttempts = 4;

export const indexLogInterval = 5; // How often indexes should be logged
export const resultLogInterval = 10; // How often translations should be logged

export const marker = '{N64}';
export const markerRoughMatch = /\{?\s*N\d{2}\s*\}?/gi;

export const quotedStringRegex = /"((?:[^"\\]|\\.)*)"/g;

/** Group 1 = Macro, Group 2 = Arg */
export const argwRegex = /(SFX|DELAY|FADE|BOX_BREAK_DELAYED|FADE_SKIPPABLE)\s*\(\s*([^)\n]+?)\s*\)/;
export const nonFuncRegex = /(?<!\()\b[A-Z][A-Z0-9_]*\b(?!\s*\()/g;

export const lineBreakRegex = /EZTR_CC_(NEWLINE|BOX_BREAK(2)?)/g;

export const ignoredStrings = new Set<string>([
    '!',
    '?',
    '.',
    '..',
    ',',
    '\n',
    '\\n',
    ' ',
    '(',
    ')',
    '"',
    "'",
    '\n!',
    '\\n!',
    '!\n',
    '!\\n',
    '.\n',
    '.\\n',
    ', ',
    '...'
]);

export const wrappedStrings = new Map<string, string>([
    ['[A]', 'BTN_A'],
    ['[B]', 'BTN_B'],
    ['[C]', 'BTN_C'],
    ['[L]', 'BTN_L'],
    ['[R]', 'BTN_R'],
    ['[Z]', 'BTN_Z'],
    ['[C-Up]', 'BTN_CUP'],
    ['[C-Down]', 'BTN_CDOWN'],
    ['[C-Left]', 'BTN_CLEFT'],
    ['[C-Right]', 'BTN_CRIGHT'],
    ['[Control-Pad]', 'CONTROL_PAD']
]);

export const nowrapMacros: string[] = [
    'TWO_CHOICE',
    'THREE_CHOICE',
    'PAUSE_MENU',
    'INPUT_BANK',
    'INPUT_BOMBER_CODE',
    'INPUT_DOGGY_RACETRACK_BET'
];