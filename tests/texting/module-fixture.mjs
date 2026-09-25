import { readFile } from "node:fs/promises";

const urls = new Map();
export async function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name);
  let source = await readFile(
    new URL(
      `../../frontend/src/pages/shared-feed/scripts/${name}.js`,
      import.meta.url,
    ),
    "utf8",
  );
  source = source
    .replace(/^import\s+"[^"\n]+\.css";\r?\n/gm, "")
    .replace(
      /^import guidelinesUrl from "[^"\n]+\.pdf";\r?\n/gm,
      'const guidelinesUrl = "/guidelines.pdf";\n',
    );
  for (const match of [...source.matchAll(/from "\.\/(texting\w+)"/g)])
    source = source.replaceAll(match[0], `from "${await moduleUrl(match[1])}"`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  urls.set(name, url);
  return url;
}
