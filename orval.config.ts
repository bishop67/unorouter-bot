import { defineConfig } from "orval";

const specUrl =
  process.env.NEW_API_OPENAPI_URL || "https://api.unorouter.ai/openapi.json";

export default defineConfig({
  newapi: {
    input: specUrl,
    output: {
      target: "./src/lib/new-api/openapi.ts",
      client: "fetch",
      override: {
        mutator: {
          path: "./src/lib/new-api/custom-fetch.ts",
          name: "customFetch",
        },
        aliasCombinedTypes: true,
      },
    },
    hooks: { afterAllFilesWrite: "prettier --write" },
  },
});
