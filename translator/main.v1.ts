import { resolve } from 'jsr:@std/path';

import { loadCheckpoint, saveCheckpoint } from './utils/checkpoint.ts';
import { runWithConcurrency } from './utils/async.ts';

import extractDefineMessages, {
    getDefineData,
    convertToEztr,
    type MessageChunk
} from './utils/define.ts';

import sanitizeForN64, { splitForN64 } from './utils/n64.ts';

import {
    maxWorkers,
    quotedStringRegex,
    indexLogInterval,
    resultLogInterval,
    marker,
    markerRoughMatch,
    maxWorkersFallback,
    ignoredStrings,
    wrappedStrings,
    maxMarkerAttempts
} from './utils/const.ts';

import multiTranslate from "./utils/translate.ts";

type StringOrWrap = string|{
    wrap: string;
    left: string;
    right: string;
};

const rawData = Deno.readTextFileSync('message_data.h');

const outputPath = resolve('..', 'src', 'poorly_translated.c');
const checkpointPath = resolve('checkpoint_data.c');

const messages = extractDefineMessages(rawData);
const totalMessages = messages.length;

const { index: startIndex, previousData } = loadCheckpoint(checkpointPath);

const translations: string[] = previousData;
let translationsDone = 0;

// Save progress on SIGINT (ctrl+c)
Deno.addSignalListener('SIGINT', () => {
    console.log('\nSaving progress...');
    saveCheckpoint(checkpointPath, translations);
    Deno.exit();
});

const findIgnoredStart = (str: string) => {
    for (const ignored of ignoredStrings) {
        if (str.startsWith(ignored)) return ignored;
    }
}

const findIgnoredEnd = (str: string) => {
    for (const ignored of ignoredStrings) {
        if (str.endsWith(ignored)) return ignored;
    }
}

await runWithConcurrency(
    messages.slice(startIndex),
    maxWorkers,
    async (msg, i) => {
        const realIndex = startIndex + i;
        const defineData = getDefineData(msg);

        // Get all strings in the message
        const quoteMatches = Array.from(
            msg.matchAll(quotedStringRegex)
        );

        if (quoteMatches.length === 0) {
            translations[realIndex] = `// Skipped ${defineData.messageId}`;
            translationsDone++;

            if (translationsDone % indexLogInterval === 0)
                console.log(`Skipped ${defineData.messageId} (${realIndex + 1} / ${totalMessages})`);

            return;
        }

        const originals = quoteMatches.map(match => {
            let str = match[1];
            const originalLength = str.length;

            const ignoredStart = findIgnoredStart(str) || '';
            if (ignoredStart) str = str.slice(ignoredStart.length);

            const ignoredEnd = (originalLength === ignoredStart.length || !str.length)
                ? ''
                : findIgnoredEnd(str) || '';

            if (ignoredEnd) str = str.slice(0, -ignoredEnd.length);

            const parts: StringOrWrap[] = [];
            let markers = 0;

            let cursor = 0;

            while (cursor < str.length) {
                let found = false;

                for (const [wrapped, replacer] of wrappedStrings) {
                    if (str.startsWith(wrapped, cursor)) {
                        const ignoredEndLeft = findIgnoredEnd(str.slice(0, cursor)) || '';
                        const ignoredStartRight = findIgnoredStart(str.slice(cursor + wrapped.length)) || '';

                        // Push preceding text (if any)
                        const textBefore = str.slice(0, cursor - ignoredEndLeft.length);
                        if (textBefore.length) {
                            parts.push(textBefore);
                        }

                        // Push the wrapped token
                        parts.push({
                            wrap: replacer,
                            left: ignoredEndLeft,
                            right: ignoredStartRight
                        });

                        cursor += wrapped.length + ignoredStartRight.length;
                        str = str.slice(cursor); // Move forward
                        cursor = 0;
                        found = true;
                        markers++;
                        break;
                    }
                }

                if (!found) cursor++;
            }

            // Push any leftover text
            if (str.length) {
                parts.push(str);
            }

            const totalLength = parts.reduce((prev, cur) =>
                prev + (typeof cur === 'string'
                    ? cur.length
                    : cur.left.length + cur.wrap.length + cur.right.length), 0);

            return {
                parts,
                markers,
                start: match.index,
                length: totalLength,
                originalLength,
                lengthIncludingIgnored: totalLength + ignoredStart.length + ignoredEnd.length,
                ignoredStart,
                ignoredEnd,
                combineWithPrev: false
            };
        });

        const firstPart = originals[0];
        const lastPart = originals[originals.length - 1];
        
        const headerLength = defineData.headerMatch[0].length + 1;

        const startMacros = msg.substring(defineData.headerIndex + headerLength, firstPart.start);
        const endMacros = msg.substring(lastPart.start + lastPart.lengthIncludingIgnored + 2)
            // Strip away ending parens
            .replace(/\n?\)\n?\)$/, '');

        // List every string (macro) between the first and last string
        const macros: string[] = [];

        for (let i = 0; i < originals.length - 1; i++) {
            const leftPart = originals[i];
            const rightPart = originals[i + 1];

            macros.push(
                msg.substring(
                    leftPart.start + leftPart.originalLength + 2,
                    rightPart.start
                )
            );
        }

        // Build toTranslate while also remembering how many markers follow each chunk
        let markerCount = 0;
        const toTranslate = originals.reduce((prev: string, cur, i) => {
            if (!cur.length && prev.endsWith(marker)) {
                cur.combineWithPrev = true;
                return prev;
            }
            
            prev += cur.parts.map((p, i) => {
                if (typeof p === 'string') return p;
                if (prev.length && typeof cur.parts[i - 1] !== 'string')
                    return '';

                markerCount++;
                return marker;
            }).join('');

            if (
                i < originals.length - 1 &&
                typeof cur.parts[cur.parts.length - 1] === 'string'
            ) {
                prev += marker;
                markerCount++;
            }

            return prev;
        }, '');

        let chunks: (MessageChunk & ({
            parts: StringOrWrap[];
            macro: false;
            ignoredStart: string;
            ignoredEnd: string;
        }|{ macro: true }))[] = [];

        // Push the start macros
        startMacros.length && chunks.push({
            macro: true,
            str: startMacros
        });

        let translated: string = '';
        let splitParts: string[] = [];

        let correctMarkerCount = false;
        let failedAttempts = 0;

        // Allow up to maxMarkerAttempts to get the marker count right
        for (; !correctMarkerCount && failedAttempts < maxMarkerAttempts - 1; failedAttempts++) {
            translated = await multiTranslate(toTranslate, markerCount);
            splitParts = translated.split(markerRoughMatch).map(sanitizeForN64);

            // Check if the right amount of markers was sent back, 6 parts would mean 5 markers separating them
            correctMarkerCount = splitParts.length === markerCount + 1;
        }

        if (correctMarkerCount) {
            let shift = 0;
            for (let i = 0; i < originals.length; i++) {
                const original = originals[i];

                // Deep copy the original parts
                const newParts = [...original.parts.map(p => typeof p === 'string' ? p : { ...p })];
                const stringsToFetch = newParts.filter(p => typeof p === 'string').length;

                let j = 0;
                for (; j < stringsToFetch; j++) {
                    let str = splitParts[i + j + shift];
                    const pi = newParts.findIndex((p, i) => i >= j && typeof p === 'string');

                    const ignoredStart = findIgnoredStart(str);
                    if (ignoredStart) str = str.slice(ignoredStart.length);

                    const ignoredEnd = findIgnoredEnd(str);
                    if (ignoredEnd) str = str.slice(0, -ignoredEnd.length);

                    newParts[pi] = str;
                }

                shift += stringsToFetch - 1;
                chunks.push({
                    macro: false,
                    parts: newParts,

                    str: '"' + original.ignoredStart +
                    newParts.map(p => typeof p === 'string'
                        ? p//splitForN64(p)
                        : p.left + '" ' + p.wrap + ' "' + p.right
                    ).join('') + original.ignoredEnd + '"',

                    ignoredStart: original.ignoredStart,
                    ignoredEnd: original.ignoredEnd
                })

                if (i < originals.length - 1) {
                    const macro = macros[i];
                    if (macro !== '\n') chunks.push({
                        macro: true,
                        str: macro
                    });
                }
            }
        }

        else {
            // Fallback to a per-string translation
            chunks = [];
            for (let i = 0; i < originals.length; i++) {
                const original = originals[i];
                const translatedParts: StringOrWrap[] = [];

                await runWithConcurrency(original.parts, maxWorkersFallback, async (part, i) => {
                    if (typeof part === 'string') {
                        const translated = await multiTranslate(part, 0);
                        translatedParts[i] = sanitizeForN64(translated);
                    }

                    else translatedParts[i] = part;
                });

                chunks.push({
                    macro: false,
                    parts: translatedParts,

                    str: '"' + original.ignoredStart +
                    translatedParts.map(p => typeof p === 'string'
                        ? p//splitForN64(p)
                        : p.left + '" ' + p.wrap + ' "' + p.right
                    ).join('') + original.ignoredEnd + '"',

                    ignoredStart: original.ignoredStart,
                    ignoredEnd: original.ignoredEnd
                });

                if (i < originals.length - 1) {
                    const macro = macros[i];
                    if (macro && macro !== '\n') chunks.push({
                        macro: true,
                        str: macro
                    });
                }
            }
        }

        // Push the end macros
        endMacros.length && chunks.push({
            macro: true,
            str: endMacros
        });

        const eztr = convertToEztr(chunks, defineData);

        translations[realIndex] = eztr;
        translationsDone++;

        if (translationsDone % indexLogInterval === 0)
            console.log(`${defineData.messageId} (${realIndex + 1} / ${totalMessages})${correctMarkerCount? '': ` (Fallback: ${splitParts.length - 1} from ${markerCount})`}`);

        if (translationsDone % resultLogInterval === 0) {
            console.table(msg.split('\n'));
            console.log('TO:');
            console.log('...' + eztr.substring(
                eztr.indexOf('false') + 'false,'.length
            ));
        }
    }
);

// Remove checkpoint marker after full completion
Deno.writeTextFileSync(outputPath, `#include "eztr_api.h"

EZTR_ON_INIT void replace_msgs() {
${translations.map(t => '    ' + t.split('\n').join('\n    ')).join('\n')}
}`);
console.log('✅ All done, output written to ' + outputPath);