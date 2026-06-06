import { defineConfig } from "orval";

export default defineConfig({
  newapi: {
    input:
      process.env.NEW_API_OPENAPI_URL ||
      "https://api.unorouter.ai/openapi.json",
    output: {
      target: "./src/lib/new-api/openapi.ts",
      client: "fetch",
      override: {
        mutator: {
          path: "./src/lib/new-api/custom-fetch.ts",
          name: "customFetch"
        },
        aliasCombinedTypes: true
      }
    },
    hooks: { afterAllFilesWrite: "prettier --write" }
  }
});
