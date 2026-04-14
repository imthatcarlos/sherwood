/**
 * Emits a JSON-LD <script> tag for rich-result SEO.
 *
 * Server component — `data` is serialized at render time and injected
 * into the HTML. Input comes exclusively from typed server builders in
 * lib/structured-data.ts, so there is no user-supplied content flowing
 * through dangerouslySetInnerHTML here.
 */

interface JsonLdProps {
  data: unknown;
}

export default function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      // Safe: data is always produced by a server builder with typed inputs.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
