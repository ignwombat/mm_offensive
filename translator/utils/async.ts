export async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    fn: (item: T, index: number) => Promise<void>
) {
    let i = 0;
    
    const workers = new Array(limit).fill(0).map(async () => {
        while (i < items.length) {
            const index = i++;
            await fn(items[index], index);
        }
    });

    await Promise.all(workers);
}