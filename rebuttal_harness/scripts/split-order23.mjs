import fs from "node:fs";

const source = JSON.parse(fs.readFileSync("experiments/content-factorial-ego-haiku-v1-order23.json", "utf8"));

for (const condition of source.conditions) {
  const name = condition.split("/").at(-1).replace(/\.yaml$/, "");
  const manifest = {
    ...source,
    title: `${source.title} (${name})`,
    conditions: [condition],
  };
  fs.writeFileSync(
    `experiments/content-factorial-ego-haiku-v1-order23-${name}.json`,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}
