import splitByMiddleWhitespace from "./split.ts";
import { lineLength } from "./n64.ts";

const ollamaAddress = 'http://localhost:11434/api/chat';
const model = 'mistral:instruct';

const instructions = (await Deno.readTextFile('instructions.txt')).replaceAll('{lineLength}', String(lineLength));
const randomInstructions = (await Deno.readTextFile('instructions.random.txt')).split('\n');

const randomInstructionChance = 0.15;

export default async function multiTranslate(blocks: string[], failedAttempts: number = 0): Promise<string[]> {
    const jsonBlock = JSON.stringify(blocks);

    const messages: { role: string; content: string; }[] = [
        {
            role: 'system',
            content: instructions
        }
    ];

    const randomInstruction = Math.random() < randomInstructionChance
        ? randomInstructions[Math.floor(
            Math.random() * (randomInstructions.length - 1) + 0.5
        )] : '';

    randomInstruction.length && messages.push({
        role: 'system',
        content: randomInstruction
    });

    failedAttempts > 0 && messages.push({
        role: 'system',
        content: `You have failed to give proper syntax ${failedAttempts} times. Be extra careful.`
    });

    const maxTokens = Math.max(
        jsonBlock.length + 20,
        64
    );

    let current = '';
    try {
        const res = await fetch(ollamaAddress, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                model,
                max_tokens: maxTokens,
                stream: false,
                messages: [...messages, {
                    role: 'user',
                    content: jsonBlock
                }],
                options: {
                    num_predict: jsonBlock.length
                }
            }),
            signal: AbortSignal.timeout(20_000)
        });

        
        const json: { message: { content: string } } = await res.json();
        current = String(json.message.content);

    } catch(err) {
        console.error('Error when translating:', err);
    }

    // Try to correct syntax errors
    let correctedJson = current
        .replaceAll('—', ' - ')
        .replace(/",\s*"\s*]/, '"]')
        .replaceAll(/"\s*"/g, '","')
        .replace(/([^"])\s*\]/, '$1"]')

    // Missing start quote
    correctedJson.match(/\[\s*[^"]/) && (correctedJson = correctedJson.replace(/\[\s*([^"])/, '["$1'));

    const jsonMatch = correctedJson.match(/(\[[^\[\]]*\])/);
    if (!jsonMatch) return [];

    try {
        const parsed = JSON.parse(jsonMatch[1]) as string[];
        if (!(parsed instanceof Array)) throw new Error('Not an Array');

        if (parsed.length > blocks.length)
            parsed[blocks.length] = parsed.slice(blocks.length - 1).join(' ');
        else {
            let last = parsed[parsed.length - 1];
            
            // Split some words in case we don't get enough strings back
            if (last.length > 32)
                for (let i = 0; i < 5 && parsed.length < blocks.length; i++) {
                    last = parsed[parsed.length - 1];

                    const split = splitByMiddleWhitespace(last);
                    if (split[1].length) {
                        parsed[parsed.length - 1] = split[0];
                        parsed.push(split[1]);
                    }

                    else break;
                }

            while (parsed.length < blocks.length)
                parsed.push('');
        }

        return parsed.slice(0, blocks.length);
    } catch {
        console.error('Error parsing JSON:', jsonMatch[1]);
        return [];
    }
}