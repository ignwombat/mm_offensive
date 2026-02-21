const allowedChars = new Set<string>([
    'abcdefghijklmnopqrstuvwxyz',
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    '0123456789',
    ' .,-_+?!*/()[]{}\r\t\''
]);

export default function sanitizeForN64(str: string) {
    if (!str?.length) return '';
    let validated = '';

    for (const char of str) {
        for (const charset of allowedChars) {
            if (charset.includes(char))
                validated += char;
        }
    }

    // Finally escape all double quotes
    //return validated.replaceAll('"', '\\"');
    return validated;
}

export const lineLength = 26; // Roughly

/** Used to prevent text from overflowing */
export function splitForN64(str: string) {
    if (str.length <= lineLength)
        return str;

    const words = str.split(/\s+/g);
    const lines: string[] = [];

    let current = '';
    while (words.length) {
        const word = words.shift();
        if (word === undefined) break;

        if (
            word.length < 8 &&
            current.length + word.length + 1 > lineLength
        ) {
            lines.push(current);
            current = word;
            continue;
        }

        if (current.length >= 32) {
            lines.push(current);
            current = word;
            continue;
        }

        if (current.length && word) current += ' ';
        current += word;
    }

    if (current.length) lines.push(current);
    return lines.join('" NEWLINE "');
}