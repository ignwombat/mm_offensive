export const loadCheckpoint = (path: string) => {
    try {
        const data = Deno.readTextFileSync(path);
        const match = data.match(/\/\/ CONTINUE FROM INDEX (\d+)/);

        if (match) {
            const i = parseInt(match[1], 10);
            const lines = data.split('\n');

            const withoutMarker = lines.filter(l =>
                !l.startsWith('// CONTINUE FROM INDEX')
            );

            return {
                index: i,
                previousData: withoutMarker
            }
        }
    } catch {
        // No file yet
    }

    return {
        index: 0,
        previousData: []
    }
}

export const saveCheckpoint = (path: string, newData: string[]) => {
    if (!newData.length) return;

    // Find longest contiguous filled section from i=0
    let lastFilled = 0;
    for (; lastFilled < newData.length; lastFilled++) {
        if (!newData[lastFilled]) break;
    }

    const output = newData.slice(0, lastFilled)
        .join('\n') +
        `\n// CONTINUE FROM INDEX ${lastFilled}`;

    // Overwrite the file
    Deno.writeTextFileSync(path, output);
}