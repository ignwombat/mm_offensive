export default function splitByMiddleWhitespace(input: string): [string, string] {
    const matches = [...input.matchAll(/\s+/g)];
    if (matches.length === 0) return [input, ""];

    // Pick the middle whitespace group
    const middle = matches[Math.floor((matches.length - 1) / 2)];
    const splitIndex = (middle.index ?? 0) + middle[0].length;

    return [
        input.slice(0, splitIndex),
        input.slice(splitIndex)
    ];
}