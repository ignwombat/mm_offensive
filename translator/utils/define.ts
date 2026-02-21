import { argwRegex, nonFuncRegex } from './const.ts';

export interface DefineData {
    defineMatch: RegExpMatchArray,
    defineArgs: string[],

    headerMatch: RegExpMatchArray,
    headerArgs: string[],
    headerIndex: number,

    msgContentMatch: RegExpMatchArray | null,
    msgContentRaw?: string,
    msgBlock: string,

    messageId: string,
    textBoxType: string,
    textBoxYPos: string,
    displayIcon: string,
    nextMsgId: string,
    firstItemRupees: string,
    secondItemRupees: string
}

export interface MessageChunk {
    str: string;
    macro: boolean;
}

export default function extractDefineMessages(input: string): string[] {
    const messages: string[] = [];
    let i = 0;

    while (i < input.length) {
        const start = input.indexOf('DEFINE_MESSAGE(', i);
        if (start === -1) break;

        let openParens = 0;
        let end = start;
        let started = false;

        while (end < input.length) {
            if (input[end] === '(') {
                openParens++;
                started = true;
            } else if (input[end] === ')') {
                openParens--;
                if (openParens === 0 && started) {
                    end++;
                    break;
                }
            }
            end++;
        }

        const block = input.slice(start, end);
        messages.push(block);
        i = end;
    }

    return messages;
}

const splitTopLevelComma = (str: string) => {
    const parts = [];
    
    let level = 0;
    let start = 0;

    for (let i = 0; i < str.length; i++) {
        if (str[i] === '(') level++;
        else if (str[i] === ')') level--;
        else if (str[i] === ',' && level === 0) {
            parts.push(str.slice(start, i).trim())
            start = i + 1;
        }
    }

    parts.push(str.slice(start).trim());
    return parts;
}

const eztrNoValue = (str: string) => str.trim() === '0xFFFF'
    ? 'EZTR_NO_VALUE'
    : str.trim();

export function getDefineData(define: string): DefineData {
    const defineMatch = define.match(/DEFINE_MESSAGE\s*\(([\s\S]*)\)\s*$/);
    if (!defineMatch) throw new Error('Invalid DEFINE_MESSAGE() format');

    const defineArgs = splitTopLevelComma(defineMatch[1]);
    if (defineArgs.length < 4) throw new Error('DEFINE_MESSAGE() missing arguments');

    const messageId = defineArgs[0];
    const msgBlock = defineArgs.slice(3).join(',');

    const headerMatch = msgBlock.match(/HEADER\s*\(([^)]+)\)/);
    if (!headerMatch) throw new Error('Missing HEADER()');

    const headerArgs = splitTopLevelComma(headerMatch[1]);
    if (headerArgs.length < 6) throw new Error('HEADER() missing arguments');

    const textBoxType = headerArgs[0].trim().substring(0, 4);
    const textBoxYPos = defineArgs[2].trim();
    const displayIcon = headerArgs[1].trim();
    
    const nextMsgId = eztrNoValue(headerArgs[2]);
    const firstItemRupees = eztrNoValue(headerArgs[3]);
    const secondItemRupees = eztrNoValue(headerArgs[4]);

    // Extract message content inside MSG(...)
    const msgContentMatch = msgBlock.match(/MSG\s*\(([\s\S]*)\)\s*$/);
    let msgContentRaw = msgContentMatch?.[1];

    if (msgContentRaw)
        msgContentRaw = msgContentRaw.replace(/HEADER\s*\([^)]*\)/, '').trim();

    return {
        defineMatch,
        defineArgs,

        headerMatch,
        headerArgs,
        headerIndex: define.indexOf('HEADER'),

        msgContentMatch,
        msgContentRaw,
        msgBlock,

        messageId,
        textBoxType,
        textBoxYPos,
        displayIcon,
        nextMsgId,
        firstItemRupees,
        secondItemRupees
    }
}

function prependToMacros(text: string, prefix: string) {
    let insideQuotes = false;
    let prevChar = '';
    let result = '';
    let token = '';

    // Regex for macro-like names
    const macroRegex = /^[A-Z0-9_]+$/;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        // Toggle insideQuotes (ignore escaped quotes)
        if (char === '"' && prevChar !== '\\') {
            insideQuotes = !insideQuotes;
            result += token; // flush token before quote
            token = '';
            result += char;
            prevChar = char;
            continue;
        }

        if (!insideQuotes) {
            if (/\w/.test(char)) {
                token += char;
            } else {
                // End of token, process if it's a macro
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
                result += char;
            }
        } else {
            result += char; // inside quotes, just add char
        }

        prevChar = char;
    }

    // Flush last token at the end
    if (
        token.length &&
        macroRegex.test(token) &&
        !token.startsWith(prefix) &&
        !insideQuotes
    ) {
        result += prefix + token;
    } else {
        result += token;
    }

    return result;
}

export function convertToEztr(chunks: MessageChunk[], d: DefineData): string {
    const restArgs: string[] = [];

    let contentArg = chunks.map(chunk => {
        if (chunk.macro) {
            chunk.str = chunk.str.replaceAll(
                nonFuncRegex,
                macro => 'EZTR_CC_' + macro
            );

            const argwMatch = chunk.str.matchAll(argwRegex);

            argwMatch.forEach(match => {
                const [fullString, macro, arg] = match;
                restArgs.push(arg);

                chunk.str = chunk.str.replace(
                    fullString,
                    `EZTR_CC_${macro}_ARGW`
                );
            });
        }

        const str = chunk.str
            .replaceAll('\\n', '" NEWLINE "')
            .replaceAll('"" ', '')
            .replaceAll(' ""', '');

        return prependToMacros(str, 'EZTR_CC_')
            .replaceAll('\n', ' ');
    }).join('');

    // There must be a BOX_BREAK every 4th NEWLINE, as only 4 lines can be rendered at once
    let i = 0;
    contentArg = contentArg.replaceAll('NEWLINE', () => {
        i++;
        return (i % 4 === 0)
            ? 'BOX_BREAK'
            : 'NEWLINE'
    });

    return 'EZTR_Basic_ReplaceText('
            + d.messageId + ','
            + d.textBoxType + ','
            + d.textBoxYPos + ','
            + d.displayIcon + ','
            + d.nextMsgId + ','
            + d.firstItemRupees + ','
            + d.secondItemRupees + ','
            + 'false,'
            + (contentArg || '0xffff') + ' EZTR_CC_END,'
            + 'NULL'
            + (restArgs.length
                ? ',' + restArgs.join(',')
                : ''
            )
        + ');';
}