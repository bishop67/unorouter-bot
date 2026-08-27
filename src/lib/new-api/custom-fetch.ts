const NEW_API_URL = process.env.NEW_API_URL?.replace(/\/$/, "") || "";
// Service token scoped upstream to the handful of routes this bot needs. It is
// not a user account, so it carries no New-Api-User header.
const NEW_API_BOT_TOKEN = process.env.NEW_API_BOT_TOKEN || "";

// Orval mutator for the new-api upstream. Injects the bot credential, returns
// the { status, data, headers } shape the generated fetch client expects.
export const customFetch = async <T>(
  url: string,
  options: RequestInit,
): Promise<T> => {
  const response = await fetch(new URL(url, NEW_API_URL).toString(), {
    ...options,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: NEW_API_BOT_TOKEN,
      ...options.headers,
    },
  });

  const text = await response.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) throw { status: response.status, data };
  return { status: response.status, data, headers: response.headers } as T;
};
