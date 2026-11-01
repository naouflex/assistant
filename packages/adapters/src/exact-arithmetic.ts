type Turn = { role: string; content: string };

export type ExactArithmetic = { expression: string; value: string };

const CUE =
  /\b(compute|calculate|calculation|what(?:'s| is)|how much|times|multiplied|divided|plus|minus|difference|sum|total|product|larger|bigger|greater)\b/i;

const REFERS_BACK = /\b(those|them|these|the two|that difference)\b/i;

/**
 * A figure the reply can use without guessing. Years written as four digits are
 * dates, not quantities, unless they use a thousands separator.
 */
function figuresIn(text: string): number[] {
  const found: number[] = [];
  for (const match of text.matchAll(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\b\d+(?:\.\d+)?\b/g)) {
    const raw = match[0] ?? "";
    const value = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (!raw.includes(",") && !raw.includes(".") && value >= 1900 && value <= 2099) continue;
    found.push(value);
  }
  return found;
}

function latestFigures(history: readonly Turn[]): number[] | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index];
    if (message?.role !== "assistant") continue;
    const figures = figuresIn(message.content);
    if (figures.length >= 2) return figures.slice(0, 6);
  }
  return undefined;
}

function formatResult(value: number): string | undefined {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return undefined;
  const nearest = Math.round(value);
  if (Math.abs(value - nearest) < 1e-9) return String(nearest);
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  const source = expression.replace(/,/g, "").replace(/\s+/g, "");
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === undefined) break;
    if ("+-*/()".includes(char)) {
      tokens.push(char);
      index += 1;
      continue;
    }
    const number = /^\d+(?:\.\d+)?/.exec(source.slice(index));
    if (!number) return [];
    tokens.push(number[0]);
    index += number[0].length;
  }
  return tokens;
}

function evaluate(expression: string): string | undefined {
  const tokens = tokenize(expression);
  if (tokens.length === 0) return undefined;
  let index = 0;
  const peek = () => tokens[index];
  const take = (expected?: string) => {
    const token = tokens[index];
    if (expected && token !== expected) return undefined;
    index += 1;
    return token;
  };
  const parseExpr = (): number | undefined => {
    let value = parseTerm();
    if (value === undefined) return undefined;
    while (peek() === "+" || peek() === "-") {
      const operator = take();
      const right = parseTerm();
      if (right === undefined) return undefined;
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const parseTerm = (): number | undefined => {
    let value = parseFactor();
    if (value === undefined) return undefined;
    while (peek() === "*" || peek() === "/") {
      const operator = take();
      const right = parseFactor();
      if (right === undefined || (operator === "/" && right === 0)) return undefined;
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const parseFactor = (): number | undefined => {
    if (peek() === "(") {
      take("(");
      const value = parseExpr();
      if (take(")") === undefined) return undefined;
      return value;
    }
    const token = take();
    if (!token || "()+-*/".includes(token)) return undefined;
    const value = Number(token);
    return Number.isFinite(value) ? value : undefined;
  };
  const value = parseExpr();
  if (value === undefined || index !== tokens.length) return undefined;
  return formatResult(value);
}

function expressionIn(text: string): string | undefined {
  const normalized = text
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/\bmultiplied by\b/gi, "*")
    .replace(/\btimes\b/gi, "*")
    .replace(/\bdivided by\b/gi, "/")
    .replace(/\bplus\b/gi, "+")
    .replace(/\bminus\b/gi, "-");
  const match = normalized.match(
    /(?:\d[\d,]*(?:\.\d+)?|\([^()]+\))(?:\s*[+\-*/]\s*(?:\d[\d,]*(?:\.\d+)?|\([^()]+\)))+/,
  );
  return match?.[0]?.trim();
}

function fromPair(
  left: number,
  right: number,
  operator: "-" | "+" | "max",
): ExactArithmetic | undefined {
  const value =
    operator === "-"
      ? Math.abs(left - right)
      : operator === "+"
        ? left + right
        : Math.max(left, right);
  const expression =
    operator === "max"
      ? `max(${formatResult(left)}, ${formatResult(right)})`
      : `${formatResult(left)} ${operator} ${formatResult(right)}`;
  const formatted = formatResult(value);
  if (!formatted || expression.includes("undefined")) return undefined;
  return { expression, value: formatted };
}

/**
 * Exact arithmetic for a short question, including a difference of figures already
 * in the conversation. Anything that is not a plain sum, product, or comparison stays
 * with the model.
 */
export function exactArithmetic(
  prompt: string,
  history: readonly Turn[] = [],
): ExactArithmetic | undefined {
  const between = prompt.match(
    /\bdifference between\s+([\d,]+(?:\.\d+)?)\s+and\s+([\d,]+(?:\.\d+)?)/i,
  );
  if (between?.[1] && between[2]) {
    const left = Number(between[1].replace(/,/g, ""));
    const right = Number(between[2].replace(/,/g, ""));
    if (Number.isFinite(left) && Number.isFinite(right)) return fromPair(left, right, "-");
  }
  const comparison = prompt.match(
    /\bwhich is (?:larger|bigger|greater),?\s+([\d,]+(?:\.\d+)?)\s+or\s+([\d,]+(?:\.\d+)?)/i,
  );
  if (comparison?.[1] && comparison[2]) {
    const left = Number(comparison[1].replace(/,/g, ""));
    const right = Number(comparison[2].replace(/,/g, ""));
    if (Number.isFinite(left) && Number.isFinite(right)) return fromPair(left, right, "max");
  }
  const expression = expressionIn(prompt);
  if (expression && CUE.test(prompt)) {
    const value = evaluate(expression);
    if (value !== undefined) return { expression: expression.replace(/\s+/g, " "), value };
  }
  if (!REFERS_BACK.test(prompt)) return undefined;
  const figures = latestFigures(history);
  if (!figures || figures.length < 2) return undefined;
  const [left, right] = figures;
  if (left === undefined || right === undefined) return undefined;
  if (
    /\bdifference\b|\bsubtract\b|\bhow (?:much|many) (?:more|larger|bigger|less|smaller)\b/i.test(
      prompt,
    )
  ) {
    return fromPair(left, right, "-");
  }
  if (/\b(sum|total|add)\b/i.test(prompt)) return fromPair(left, right, "+");
  if (/\b(product|multipl)/i.test(prompt)) {
    const value = formatResult(figures.reduce((product, figure) => product * figure, 1));
    if (!value) return undefined;
    return { expression: figures.map((figure) => formatResult(figure)).join(" * "), value };
  }
  return undefined;
}
