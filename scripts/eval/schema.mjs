/**
 * A minimal JSON Schema validator: the subset the evaluation schemas use, and nothing more.
 *
 * Why not a library: the harness has no dependencies, ever (it is what makes it copyable). Why
 * not hand-written checks: the schema is the contract other people write cases against, and a
 * second, hand-written version of the same contract is the one that drifts.
 *
 * Supported keywords: type, enum, const, properties, required, additionalProperties,
 * propertyNames, items, minItems, minLength, pattern, minimum, maximum, $ref (local `#/$defs/…`),
 * allOf, anyOf, if/then/else. Annotations ($schema, $id, $comment, title, description) are
 * ignored. An unknown keyword is an error: a schema that silently ignores half of itself
 * validates nothing.
 */

const KNOWN = new Set([
  "type", "enum", "const", "properties", "required", "additionalProperties", "propertyNames",
  "items", "minItems", "minLength", "pattern", "minimum", "maximum", "$ref", "allOf", "anyOf",
  "if", "then", "else", "$defs",
  "$schema", "$id", "$comment", "title", "description", "examples",
]);

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const isType = (v, t) => t === typeOf(v) || (t === "number" && typeof v === "number");
const show = (v) => JSON.stringify(v)?.slice(0, 60);

/** Returns the list of errors (`<path>: <message>`); empty means valid. */
export function validate(schema, value, root = schema, at = "") {
  const errors = [];
  const here = at || "/";
  if (schema === true) return errors;
  if (schema === false) return [`${here}: not allowed here`];
  for (const k of Object.keys(schema)) if (!KNOWN.has(k)) errors.push(`${here}: the schema uses an unsupported keyword \`${k}\``);

  if (schema.$ref) {
    const m = /^#\/\$defs\/(.+)$/.exec(schema.$ref);
    const target = m ? root.$defs?.[m[1]] : undefined;
    if (!target) return [...errors, `${here}: unresolved $ref ${schema.$ref}`];
    errors.push(...validate(target, value, root, at));
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(value, t))) return [...errors, `${here}: expected ${types.join(" | ")}, got ${typeOf(value)}`];
  }
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) {
    errors.push(`${here}: ${show(value)} is not one of ${schema.enum.map(show).join(", ")}`);
  }
  if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) errors.push(`${here}: must be ${show(schema.const)}`);
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${here}: shorter than ${schema.minLength}`);
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${here}: ${show(value)} does not match /${schema.pattern}/`);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${here}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${here}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${here}: fewer than ${schema.minItems} item(s)`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items, v, root, `${at}/${i}`)));
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const k of schema.required ?? []) if (!(k in value)) errors.push(`${here}: missing \`${k}\``);
    for (const [k, v] of Object.entries(value)) {
      if (schema.propertyNames) errors.push(...validate(schema.propertyNames, k, root, `${at}/${k}`));
      if (schema.properties && k in schema.properties) errors.push(...validate(schema.properties[k], v, root, `${at}/${k}`));
      else if (schema.additionalProperties !== undefined) {
        if (schema.additionalProperties === false) errors.push(`${here}: unknown key \`${k}\``);
        else errors.push(...validate(schema.additionalProperties, v, root, `${at}/${k}`));
      }
    }
  }
  for (const s of schema.allOf ?? []) errors.push(...validate(s, value, root, at));
  if (schema.anyOf && !schema.anyOf.some((s) => !validate(s, value, root, at).length)) {
    errors.push(`${here}: matches none of the ${schema.anyOf.length} allowed shapes`);
  }
  if (schema.if) {
    const branch = validate(schema.if, value, root, at).length ? schema.else : schema.then;
    if (branch) errors.push(...validate(branch, value, root, at));
  }
  return errors;
}
