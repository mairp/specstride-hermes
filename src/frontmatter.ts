/**
 * The frontmatter of a rendered Hermes skill (T013, F150-FR-003, research
 * R2): the fields Hermes's loader reads, inserted into a rendered skill and
 * validated against the closed rules of R2. An unknown top-level field
 * fails, a rule breach fails, and nothing is truncated.
 */

/** The rules of a `name` (R2). */
export const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
export const NAME_MAX_LENGTH = 64;
/** The rules of a `description` (R2). */
export const DESCRIPTION_MAX_LENGTH = 1024;
export const LICENSE = "Apache-2.0";
export const PLATFORMS: readonly string[] = Object.freeze(["linux", "macos"]);
export const HERMES_CATEGORY = "specstride";
export const HERMES_REQUIRES_TOOLSETS: readonly string[] = Object.freeze(["terminal"]);
export const HOST_NAME = "hermes";

/** The top-level fields a skill's frontmatter may carry; anything else fails. */
const KNOWN_TOP_LEVEL_FIELDS: readonly string[] = Object.freeze([
  "name",
  "description",
  "version",
  "license",
  "platforms",
  "metadata",
]);

export type FrontmatterInput = {
  /** The Hermes spelling of the skill, the frontmatter `name`. */
  readonly name: string;
  /** The one-line description of the skill. */
  readonly description: string;
  /** The version of the package the skill ships with. */
  readonly version: string;
  /** The tags of `metadata.hermes.tags`. */
  readonly tags: readonly string[];
};

/** One list value of the YAML subset: `[a, b]` on one line. */
function listValue(values: readonly string[]): string {
  return "[" + values.join(", ") + "]";
}

/** The YAML subset text of the frontmatter block, without the fences. */
export function frontmatterLines(input: FrontmatterInput): readonly string[] {
  return [
    "name: " + input.name,
    "description: " + JSON.stringify(input.description),
    "version: " + input.version,
    "license: " + LICENSE,
    "platforms: " + listValue(PLATFORMS),
    "metadata:",
    "  hermes:",
    "    tags: " + listValue(input.tags),
    "    category: " + HERMES_CATEGORY,
    "    requires_toolsets: " + listValue(HERMES_REQUIRES_TOOLSETS),
    "  specstride:",
    "    version: " + input.version,
    "    host: " + HOST_NAME,
  ];
}

/**
 * `insertFrontmatter` — the rendered text of a skill with the Hermes
 * frontmatter in front of its body. Nothing of the body is changed.
 */
export function insertFrontmatter(
  render: {
    /** The Hermes spelling, the `name` of the frontmatter. */
    readonly spelling: string;
    /** The one-line description of the skill. */
    readonly description: string;
    /** The body of the skill, frontmatter-free. */
    readonly body: string;
  },
  context: {
    /** The version of the package the skill ships with. */
    readonly version: string;
    /** The tags of `metadata.hermes.tags`. */
    readonly tags: readonly string[];
  },
): string {
  return [
    "---",
    ...frontmatterLines({
      name: render.spelling,
      description: render.description,
      version: context.version,
      tags: context.tags,
    }),
    "---",
    "",
    render.body.replace(/\n+$/, ""),
    "",
  ].join("\n");
}

/** One parsed frontmatter document: the fields a rule reads. */
export type ParsedFrontmatter = {
  readonly fields: Readonly<Record<string, string>>;
  readonly lists: Readonly<Record<string, readonly string[]>>;
  readonly metadata: Readonly<Record<string, Readonly<Record<string, string | readonly string[]>>>>;
};

/** Parse the YAML subset the insert writes; anything it cannot read is a breach. */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") throw new Error("no frontmatter fence at the first line");
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) throw new Error("no closing frontmatter fence");
  const fields: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  const metadata: Record<string, Record<string, string | string[]>> = {};
  let section: string | null = null;
  let subsection: string | null = null;
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const indent = line.length - line.trimStart().length;
    const match = /^(\s*)([A-Za-z0-9_.-]+):\s*(.*)$/.exec(line);
    if (!match) throw new Error("unreadable frontmatter line: " + JSON.stringify(line));
    const [, pad, key, raw] = match;
    if (indent === 0) {
      section = null;
      subsection = null;
      if (raw === "") {
        section = key;
        continue;
      }
      const list = /^\[(.*)\]$/.exec(raw);
      if (list) lists[key] = list[1] === "" ? [] : list[1].split(",").map((v) => v.trim());
      else fields[key] = raw;
    } else if (indent === 2 && section !== null) {
      subsection = key;
      metadata[key] = metadata[key] ?? {};
      if (raw !== "") throw new Error("unexpected scalar under " + section);
    } else if (indent === 4 && section !== null && subsection !== null) {
      const list = /^\[(.*)\]$/.exec(raw);
      metadata[subsection][key] = list
        ? list[1] === ""
          ? []
          : list[1].split(",").map((v) => v.trim())
        : raw;
    } else {
      throw new Error("unexpected indentation on: " + JSON.stringify(line));
    }
    void pad;
  }
  return { fields, lists, metadata };
}

/** The verdict of `validateFrontmatter`: one message per breached rule. */
export type FrontmatterVerdict = {
  readonly ok: boolean;
  readonly errors: readonly string[];
};

/**
 * `validateFrontmatter` — the rendered text of a skill against the rules of
 * R2: the `name` pattern and cap, the description cap, a present version,
 * the license, the platforms, the `metadata.hermes` and
 * `metadata.specstride` fields, and no unknown top-level field.
 */
export function validateFrontmatter(text: string): FrontmatterVerdict {
  const errors: string[] = [];
  let parsed: ParsedFrontmatter;
  try {
    parsed = parseFrontmatter(text);
  } catch (error) {
    return { ok: false, errors: [(error as Error).message] };
  }
  const name = parsed.fields["name"] ?? "";
  if (!NAME_PATTERN.test(name)) errors.push(`name ${JSON.stringify(name)} breaks ${NAME_PATTERN}`);
  if (name.length > NAME_MAX_LENGTH)
    errors.push(`name is ${name.length} characters, over the cap of ${NAME_MAX_LENGTH}`);
  const description = parsed.fields["description"] ?? "";
  const unwrapped = /^".*"$/.test(description) ? description.slice(1, -1) : description;
  if (unwrapped.length > DESCRIPTION_MAX_LENGTH)
    errors.push(
      `description is ${unwrapped.length} characters, over the cap of ${DESCRIPTION_MAX_LENGTH}`,
    );
  const version = parsed.fields["version"];
  if (version === undefined || version.trim() === "") errors.push("version is missing");
  if (parsed.fields["license"] !== LICENSE)
    errors.push(`license must be ${LICENSE}, got ${JSON.stringify(parsed.fields["license"] ?? "")}`);
  const platforms = parsed.lists["platforms"];
  if (platforms === undefined || platforms.join(",") !== PLATFORMS.join(","))
    errors.push(`platforms must be ${listValue(PLATFORMS)}`);
  const hermes = parsed.metadata["hermes"];
  if (hermes === undefined) {
    errors.push("metadata.hermes is missing");
  } else {
    if (!Array.isArray(hermes["tags"]) || (hermes["tags"] as string[]).length === 0)
      errors.push("metadata.hermes.tags must be a non-empty list");
    if (hermes["category"] !== HERMES_CATEGORY)
      errors.push(`metadata.hermes.category must be ${HERMES_CATEGORY}`);
    const toolsets = hermes["requires_toolsets"];
    if (
      !Array.isArray(toolsets) ||
      (toolsets as string[]).join(",") !== HERMES_REQUIRES_TOOLSETS.join(",")
    )
      errors.push(`metadata.hermes.requires_toolsets must be ${listValue(HERMES_REQUIRES_TOOLSETS)}`);
  }
  const specstride = parsed.metadata["specstride"];
  if (specstride === undefined) {
    errors.push("metadata.specstride is missing");
  } else {
    if (typeof specstride["version"] !== "string" || specstride["version"] === "")
      errors.push("metadata.specstride.version is missing");
    if (specstride["host"] !== HOST_NAME)
      errors.push(`metadata.specstride.host must be ${HOST_NAME}`);
  }
  for (const field of Object.keys(parsed.fields).concat(Object.keys(parsed.lists))) {
    if (!KNOWN_TOP_LEVEL_FIELDS.includes(field))
      errors.push(`unknown top-level field: ${field}`);
  }
  const metadataKeys = Object.keys(parsed.metadata);
  if (metadataKeys.some((key => key !== "hermes" && key !== "specstride")))
    errors.push("metadata carries a field other than hermes and specstride");
  return { ok: errors.length === 0, errors };
}
