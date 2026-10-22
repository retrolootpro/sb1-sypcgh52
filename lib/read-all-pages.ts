export async function readAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null;
}>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await fetchPage(from, from + 499);
    if (error) throw new Error(error.message);
    if (!data) throw new Error('A required database response was missing.');
    rows.push(...data);
    if (data.length < 500) return rows;
  }
}
