export const config = { schedule: "*/15 * * * *" };

export default async () => {
  const siteUrl = process.env.URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return new Response("Missing site URL", { status: 500 });

  const response = await fetch(`${siteUrl.replace(/\/$/, "")}/api/clover/auto-sync`, {
    method: "POST",
    headers: {
      "x-retroloot-cron-secret": process.env.CLOVER_AUTO_SYNC_SECRET || "",
    },
  });

  return new Response(await response.text(), { status: response.status });
};
