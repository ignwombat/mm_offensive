import { argwRegex, lineBreakRegex, nowrapMacros } from "./const.ts";
import {
    type DefineData,
    type MessageChunk
} from './define.ts';
import { lineLength } from "./n64.ts";

function prependToMacros(text: string, prefix: string) {
    let insideQuotes = false;
    let prevChar = '';
    let result = '';
    let token = '';

    // Regex for macro-like names
    const macroRegex = /^[A-Z0-9_]+$/;

    const flushToken = () => {
        if (
            token.length &&
            macroRegex.test(token) &&
            !token.startsWith(prefix)
        ) {
            result += prefix + token;
        } else {
            result += token;
        }
        token = '';
    };

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        // If we're about to toggle quotes, flush token first
        if (char === '"' && prevChar !== '\\') {
            if (!insideQuotes) {
                flushToken();
            }
            insideQuotes = !insideQuotes;
            result += char;
            prevChar = char;
            continue;
        }

        if (!insideQuotes) {
            if (/\w/.test(char)) {
                token += char;
            } else {
                flushToken();
                result += char;
            }
        } else {
            result += char;
        }

        prevChar = char;
    }

    if (!insideQuotes) {
        flushToken();
    } else {
        result += token;
    }

    return result;
}

function splitPairedStrings(text: string) {
    let insideQuotes = false;
    let prevChar = '';
    let result = '';
    let token = '';
    let prevToken = '';

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        // If we're about to toggle quotes, flush token first
        if (char === '"' && prevChar !== '\\') {
            insideQuotes = !insideQuotes;
            prevChar = char;

            if (!insideQuotes) {
                if (token.length + prevToken.length > (lineLength + 1)) {
                    token = '" EZTR_CC_NEWLINE "' + token;
                }

                prevToken = token;
                result += token;

                token = '';
            }

            result += char;
            continue;
        }

        if (insideQuotes) {
            token += char;
        } else
            result += char;

        prevChar = char;
    }

    return result;
}

export default function convertToEZTR(chunks: MessageChunk[], d: DefineData) {
    let contentArg: string = '';
    const restArgs: string[] = [];

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];

        if (chunk.macro) {
            // Get a list of all the macros in the chunk
            const chunkMacros = chunk.str
                .replaceAll('\n', ' ')
                .replaceAll(/\s+/g, ' ')
                .trim()
                .split(/\s+/g)
                .filter(m => m?.length > 3);

            // Handle each macro accordingly
            contentArg += ' ' + chunkMacros.map(macro => {
                const argwMatch = macro.match(argwRegex);

                if (argwMatch) {
                    const [fullString, macroName, arg] = argwMatch;
                    restArgs.push(arg);

                    return fullString.replace(
                        fullString,
                        `EZTR_CC_${macroName}_ARGW`
                    );
                }

                return `EZTR_CC_${macro}`;
            }).join(' ') + ' ';
        }

        // Regular string handling
        else contentArg += prependToMacros(
            chunk.str
                .replaceAll('\\n"', '" EZTR_CC_NEWLINE ')
                .replaceAll('\\n', '" EZTR_CC_NEWLINE "'),
            'EZTR_CC_'
        );
    }

    let msgContent = (contentArg?.replaceAll(/ +/g, ' ') || '0xffff');
    
    // Add more newlines by checking combined strings
    // If the message contains a TWO_CHOICE or THREE_CHOICE, we can't split strings
    if (!nowrapMacros.some(m => msgContent.includes(m))) {
        msgContent = splitPairedStrings(msgContent);

        // Cleanup
        msgContent = msgContent
            .replaceAll(/(\s*)EZTR_CC_NEWLINE "" EZTR_CC_BOX_BREAK(\s*)/g, '$1EZTR_CC_BOX_BREAK$2')
            .replaceAll(/(\s*)EZTR_CC_NEWLINE "" EZTR_CC_NEWLINE(\s*)/g, '$1EZTR_CC_NEWLINE$2')
            .replaceAll(/(\s*)""(\s*)EZTR_CC_NEWLINE(\s*)/g, '$1$2EZTR_CC_NEWLINE$3')
            .replaceAll(/(\s*)EZTR_CC_NEWLINE([^"]+)EZTR_CC_NEWLINE(\s*)/g, '$1$2 EZTR_CC_NEWLINE$3')
            .replaceAll(/(\s*)EZTR_CC_(NEWLINE|BOX_BREAK(2)?)([^"]+)EZTR_CC_NEWLINE(\s*)/g, '$1EZTR_CC_$2$4$5')
            .replaceAll(/(\s*)EZTR_CC_NEWLINE(\s*)("\w")(\s*)/g, '$1$2$3$4')
            .replaceAll(/(\s*)EZTR_CC_(NEWLINE|BOX_BREAK(2)?)(\s*)("\w")(\s*)EZTR_CC_END/g, '$1EZTR_CC_$2$5$6EZTR_CC_END');

        // More than three newlines breaks dialogs. When 4 in a row, replace last one with break
        let chainedNewLines = 0;
        msgContent = msgContent.replace(lineBreakRegex, (match, t: string) => {
            if (t.includes('BOX_BREAK')) {
                chainedNewLines = 0;
                return match;
            }

            chainedNewLines++;

            if (chainedNewLines >= 4) {
                chainedNewLines = 0;
                return 'EZTR_CC_BOX_BREAK';
            }

            return match;
        });

        const newMatches = msgContent.matchAll(lineBreakRegex).toArray();

        // Strip double box breaks
        if (newMatches) {
            let i = 0;
            msgContent = msgContent.replace(lineBreakRegex, (match, t: string) => {
                i++;
                const next = i < newMatches.length
                    ? newMatches[i]
                    : undefined;

                if (t.includes('BOX_BREAK') && next?.groups?.[1].includes('BOX_BREAK'))
                    return '';

                return match;
            });
        }
    }

    // Cleanup
    msgContent = msgContent
        .replace(/^\s*EZTR_CC_NEWLINE\s*/, '')
        .replaceAll(/(EZTR_CC_NEWLINE\s*"\s+"\s*EZTR_CC_NEWLINE)/, 'EZTR_CC_NEWLINE')

    return 'EZTR_Basic_ReplaceText('
        + d.messageId + ','
        + d.textBoxType + ','
        + d.textBoxYPos + ','
        + d.displayIcon + ','
        + d.nextMsgId + ','
        + d.firstItemRupees + ','
        + d.secondItemRupees + ','
        + 'false,'
        + msgContent + `${msgContent.endsWith(' ') ? '' : ' '}EZTR_CC_END,`
        + 'NULL'
        + (restArgs.length
            ? ',' + restArgs.join(',')
            : ''
        )
    + ');';
}