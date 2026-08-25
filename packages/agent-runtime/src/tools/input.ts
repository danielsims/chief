import { z } from "zod";

export function boundedText(maximum: number) {
  return z
    .string()
    .transform((text) => text.trim().slice(0, maximum))
    .pipe(z.string().min(1));
}

export function optionalBoundedText(maximum: number) {
  return z
    .string()
    .optional()
    .transform((input) => {
      const value = input?.trim().slice(0, maximum);
      return value === "" ? undefined : value;
    });
}

export function value<Input>(
  input: Input,
  name: string,
  maximum: number,
  required = true,
) {
  const result = boundedText(maximum).safeParse(input);
  if (result.success) return result.data;
  if (!required) return undefined;
  throw new Error(`${name} is required.`);
}

export function requiredValue<Input>(
  input: Input,
  name: string,
  maximum: number,
) {
  const result = value(input, name, maximum);
  if (!result) throw new Error(`${name} is required.`);
  return result;
}

export function choice<Input, Choice extends string>(
  input: Input,
  name: string,
  options: readonly Choice[],
  fallback: Choice,
) {
  if (input === undefined) return fallback;
  const parsed = z.string().safeParse(input);
  const match = parsed.success
    ? options.find((option) => option === parsed.data)
    : undefined;
  if (match) return match;
  throw new Error(`${name} must be one of: ${options.join(", ")}.`);
}

export function time<Input>(input: Input, fallback = Date.now()) {
  const numeric = z.number().finite().safeParse(input);
  if (numeric.success) return numeric.data;
  const text = z.string().safeParse(input);
  if (text.success) {
    const parsed = Date.parse(text.data);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function amount<Input>(input: Input, name: string) {
  if (input === undefined || input === null || input === "") return undefined;
  const source = z.union([z.number(), z.string()]).safeParse(input);
  const parsed = source.success ? Number(source.data) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

export function stringList<Input>(input: Input, name: string, maximum = 30) {
  const result = z.array(boundedText(300)).safeParse(input);
  if (!result.success) throw new Error(`${name} must be a list.`);
  return result.data.slice(0, maximum);
}
