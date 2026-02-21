import { resolve } from '@std/path';

import { loadCheckpoint, saveCheckpoint } from './utils/checkpoint.ts';
import { runWithConcurrency } from './utils/async.ts';

import extractDefineMessages, {
    getDefineData,
    type MessageChunk
} from './utils/define.ts';

import convertToEZTR from './utils/eztr.ts';
import sanitizeForN64, { splitForN64, lineLength } from './utils/n64.ts';

import {
    maxWorkers,
    quotedStringRegex,
    indexLogInterval,
    resultLogInterval,
    ignoredStrings,
    wrappedStrings,
    nowrapMacros
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

        const originals = quoteMatches.map((match, j) => {
            let str = match[1];
            const originalLength = str.length;

            const ignoredStart = findIgnoredStart(str) || '';
            if (ignoredStart) str = str.slice(ignoredStart.length);

            const ignoredEnd = (originalLength === ignoredStart.length || !str.length)
                ? ''
                : findIgnoredEnd(str) || '';

            if (ignoredEnd) str = str.slice(0, -ignoredEnd.length);

            const parts: StringOrWrap[] = [];
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
                parts: parts.filter(p => {
                    if (typeof p !== 'string' && p.wrap.match(/^\s+$/)) return false;
                    return true;
                }).map(p => typeof p === 'string'
                    ? p.replace(/\\$/, '')
                    : p
                ),
                start: match.index,
                length: totalLength,
                originalLength,
                lengthIncludingIgnored: totalLength + ignoredStart.length + ignoredEnd.length,
                ignoredStart: ignoredStart.replace(/[\\"]$/, ''),
                ignoredEnd: ignoredEnd.replace(/[\\"]$/, ''),
                combineWithPrev: false,
                originalIndex: j
            };
        });

        const firstPart = originals[0];
        const lastPart = originals[originals.length - 1];
        
        const headerLength = defineData.headerMatch[0].length + 1;

        const startMacros = msg.substring(defineData.headerIndex + headerLength, firstPart.start);
        const endMacros = msg.substring(lastPart.start + lastPart.lengthIncludingIgnored + 1)
            // Strip away ending parens
            .replace(/\n?\)\n?\)$/, '')
            .replace(/^"/, '');

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

        // Build the toTranslate array, turning wraps into a "this button" placeholder
        // An original with 3 parts will be the first 3 in the array
        const toTranslate = originals.map(o => {
            return o.parts.map(p => typeof p === 'string'
                ? p
                : 'this button'
            );
        }).flat();

        // Try up to five times
        let translated: string[] = [];
        for (let i = 0; !translated.length && i < 5; i++) {
            translated = await multiTranslate(toTranslate, i);
        }

        if (!translated.length) {
            translations[realIndex] = `// Skipped ${defineData.messageId} (failed 3 times)`;
            translationsDone++;

            if (translationsDone % indexLogInterval === 0)
                console.log(`Skipped ${defineData.messageId} (${realIndex + 1} / ${totalMessages})`);

            return;
        }

        const chunks: (MessageChunk & ({
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

        // For multiple choice dialogs, it is unsafe to split strings
        const hasChoice = [startMacros, ...macros, endMacros].some(m => nowrapMacros.some(n => m.includes(n)));

        // Push the translated parts
        let strIndex = 0;
        originals.forEach((original, i) => {
            let cur = '';

            // Merge if first part is a string
            if (original.ignoredStart.length) {
                if (typeof original.parts[0] === 'string')
                    translated[i] = original.ignoredStart + (translated[i] ?? '');
                else {
                    cur += '"' + original.ignoredStart + '"';
                }
            }

            cur += original.parts.map((p, j) => {
                if (typeof p !== 'string') {
                    strIndex++;
                    return p.wrap;
                }

                let translatedString = sanitizeForN64(translated[strIndex].substring(0, lineLength));
                if (!hasChoice) translatedString = splitForN64(sanitizeForN64(translated[strIndex]));

                const prev = original.parts[j - 1];
                const next = original.parts[j + 1];

                if (j > 0 && typeof prev === 'object')
                    translatedString = prev.right + translatedString;
                if (j < original.parts.length && typeof next === 'object')
                    translatedString += next.left;

                originals[i].parts[j] = translatedString;
                strIndex++;

                return '"' + translatedString + '"';
            }).join(' ');

            // Merge if cur ends with "
            if (original.ignoredEnd.length) {
                if (cur.endsWith('"'))
                    cur = cur.replace(/"$/, original.ignoredEnd + '"');
                else cur += '"' + original.ignoredEnd + '"';
            }

            chunks.push({
                str: cur,
                parts: original.parts,
                macro: false,
                ignoredStart: original.ignoredStart,
                ignoredEnd: original.ignoredEnd
            });

            if (i < originals.length - 1) {
                const macro = macros[i];
                if (macro !== '\n') chunks.push({
                    macro: true,
                    str: macro
                });
            }
        });

        // Push the end macros
        endMacros.length && chunks.push({
            macro: true,
            str: endMacros
        });

        const eztr = convertToEZTR(chunks, defineData);

        translations[realIndex] = eztr;
        translationsDone++;

        if (translationsDone % indexLogInterval === 0)
            console.log(`${defineData.messageId} (${realIndex + 1} / ${totalMessages})`);

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