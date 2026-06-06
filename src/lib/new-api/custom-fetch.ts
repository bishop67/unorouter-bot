const NEW_API_URL = process.env.NEW_API_URL?.replace(/\/$/, "") || "";
const NEW_API_ADMIN_TOKEN = process.env.NEW_API_ADMIN_TOKEN || "";
// new-api admin auth needs BOTH the access token and its user id. System token
// belongs to user id 1.
const NEW_API_USER_ID = process.env.NEW_API_USER_ID?.trim() || "1";

// Orval mutator for the new-api upstream. Injects admin auth, returns the
// { status, data, headers } shape the generated fetch client expects.
export const customFetch = async <T>(
  url: string,
  options: RequestInit,
): Promise<T> => {
  const response = await fetch(new URL(url, NEW_API_URL).toString(), {
    ...options,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: NEW_API_ADMIN_TOKEN,
      "New-Api-User": NEW_API_USER_ID,
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
