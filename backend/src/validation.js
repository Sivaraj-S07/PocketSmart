// Tiny request-validation toolkit.  Error objects follow FastAPI/Pydantic's shape
// ({ type, loc, msg }) so the frontend can keep formatting `detail` the same way.

const missing = (loc) => ({ type: 'missing', loc, msg: 'Field required' });

function isNumeric(str) {
  return typeof str === 'string' && /^\s*[-+]?(\d+(\.\d*)?|\.\d+)\s*$/.test(str);
}

/** Field builders. Each returns { parse(value, loc) -> {value} | {error} , required?, default? } */
export const f = {
  string({ min = 0, max = Infinity, trim = false, pattern, maxBytes, required = false, default: def = '' } = {}) {
    return {
      required,
      default: def,
      parse(v, loc) {
        if (typeof v !== 'string') return { error: { type: 'string_type', loc, msg: 'Input should be a valid string' } };
        const s = trim ? v.trim() : v;
        if ([...s].length < min)
          return { error: { type: 'string_too_short', loc, msg: `String should have at least ${min} character${min === 1 ? '' : 's'}` } };
        if ([...s].length > max)
          return { error: { type: 'string_too_long', loc, msg: `String should have at most ${max} characters` } };
        if (pattern && !pattern.test(s))
          return { error: { type: 'string_pattern_mismatch', loc, msg: `String should match pattern '${pattern.source}'` } };
        if (maxBytes && Buffer.byteLength(s, 'utf8') > maxBytes)
          return { error: { type: 'value_error', loc, msg: `Value error, Password must not exceed bcrypt's ${maxBytes}-byte limit` } };
        return { value: s };
      },
    };
  },
  nullableString({ max = Infinity, trim = false } = {}) {
    const inner = f.string({ max, trim });
    return { required: false, default: null, parse: (v, loc) => (v === null ? { value: null } : inner.parse(v, loc)) };
  },
  number({ min = -Infinity, max = Infinity, gt, required = false, default: def } = {}) {
    return {
      required,
      default: def,
      parse(v, loc) {
        let n;
        if (typeof v === 'number') n = v;
        else if (isNumeric(v)) n = Number(v);
        else return { error: { type: 'float_parsing', loc, msg: 'Input should be a valid number' } };
        if (!Number.isFinite(n)) return { error: { type: 'finite_number', loc, msg: 'Input should be a finite number' } };
        if (gt !== undefined && !(n > gt)) return { error: { type: 'greater_than', loc, msg: `Input should be greater than ${gt}` } };
        if (n < min) return { error: { type: 'greater_than_equal', loc, msg: `Input should be greater than or equal to ${min}` } };
        if (n > max) return { error: { type: 'less_than_equal', loc, msg: `Input should be less than or equal to ${max}` } };
        return { value: n };
      },
    };
  },
  integer(opts = {}) {
    const base = f.number(opts);
    return {
      ...base,
      parse(v, loc) {
        const r = base.parse(v, loc);
        if (r.error) return r.error.type === 'float_parsing' ? { error: { ...r.error, type: 'int_parsing', msg: 'Input should be a valid integer' } } : r;
        if (!Number.isInteger(r.value))
          return { error: { type: 'int_from_float', loc, msg: 'Input should be a valid integer, got a number with a fractional part' } };
        return r;
      },
    };
  },
  stringList({ max = Infinity, default: def = () => [] } = {}) {
    return {
      required: false,
      default: def,
      parse(v, loc) {
        if (!Array.isArray(v)) return { error: { type: 'list_type', loc, msg: 'Input should be a valid list' } };
        for (let i = 0; i < v.length; i++)
          if (typeof v[i] !== 'string') return { error: { type: 'string_type', loc: [...loc, i], msg: 'Input should be a valid string' } };
        if (v.length > max)
          return { error: { type: 'too_long', loc, msg: `List should have at most ${max} items after validation, not ${v.length}` } };
        return { value: v };
      },
    };
  },
  record({ required = false } = {}) {
    return {
      required,
      default: () => ({}),
      parse(v, loc) {
        if (v === null || typeof v !== 'object' || Array.isArray(v))
          return { error: { type: 'dict_type', loc, msg: 'Input should be a valid dictionary' } };
        return { value: v };
      },
    };
  },
  oneOf(values, { default: def } = {}) {
    return {
      required: false,
      default: def,
      parse: (v, loc) =>
        values.includes(v)
          ? { value: v }
          : { error: { type: 'literal_error', loc, msg: `Input should be ${values.map((x) => `'${x}'`).join(', ')}` } },
    };
  },
};

/**
 * validate(schema, body) -> { value } | { issues }
 * Unknown fields are ignored (like Pydantic's default).
 * `normalize` pre-processes raw string input (e.g. trimming) per field via schema options.
 */
export function validate(schema, body, where = 'body') {
  const issues = [];
  const value = {};
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { issues: [{ type: 'model_attributes_type', loc: [where], msg: 'Input should be a valid dictionary or object' }] };
  }
  for (const [key, spec] of Object.entries(schema)) {
    const loc = [where, key];
    if (!(key in body) || body[key] === undefined) {
      if (spec.required) issues.push(missing(loc));
      else value[key] = typeof spec.default === 'function' ? spec.default() : spec.default;
      continue;
    }
    const r = spec.parse(body[key], loc);
    if (r.error) issues.push(r.error);
    else value[key] = r.value;
  }
  return issues.length ? { issues } : { value };
}
