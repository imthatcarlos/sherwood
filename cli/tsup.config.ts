import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  splitting: true,
  clean: true,
  sourcemap: true,
  // Inject PINATA_JWT at build time if available
  define: {
    "process.env.PINATA_JWT_BUILD": JSON.stringify(
      process.env.PINATA_JWT || ""
    ),
  },
});
