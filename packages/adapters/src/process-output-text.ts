import { StringDecoder } from "node:string_decoder";

/**
 * Windows `wsl --list` writes UTF-16 LE to a pipe, including a BOM. Reading that
 * as UTF-8 turns the distro list into spaced replacement characters, so the bot
 * cannot see which machine it is on.
 */
export class ProcessOutputDecoder {
  private pending = Buffer.alloc(0);
  private rest = Buffer.alloc(0);
  private mode: "unknown" | "utf8" | "utf16" = "unknown";
  private readonly utf8 = new StringDecoder("utf8");
  private stripBom = false;

  push(chunk: Buffer): string {
    if (this.mode === "utf8") return this.utf8.write(chunk);
    if (this.mode === "utf16") return this.writeUtf16(chunk);
    this.pending = Buffer.concat([this.pending, chunk]);
    if (this.pending.length < 2) return "";
    if (!hasUtf16Bom(this.pending) && this.pending.length < 4) return "";
    this.mode = looksLikeUtf16(this.pending) ? "utf16" : "utf8";
    const buffered = this.pending;
    this.pending = Buffer.alloc(0);
    return this.mode === "utf16" ? this.writeUtf16(buffered) : this.utf8.write(buffered);
  }

  end(): string {
    if (this.mode === "unknown") {
      this.mode = looksLikeUtf16(this.pending) ? "utf16" : "utf8";
      const buffered = this.pending;
      this.pending = Buffer.alloc(0);
      return this.mode === "utf16" ? this.writeUtf16(buffered) : this.utf8.end(buffered);
    }
    if (this.mode === "utf16") return this.writeUtf16(Buffer.alloc(0));
    return this.utf8.end();
  }

  private writeUtf16(chunk: Buffer): string {
    const data = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    const even = data.length - (data.length % 2);
    this.rest = Buffer.from(data.subarray(even));
    let text = data.subarray(0, even).toString("utf16le");
    if (!this.stripBom) {
      this.stripBom = true;
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    }
    return text;
  }
}

function hasUtf16Bom(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe;
}

function looksLikeUtf16(buffer: Buffer): boolean {
  if (hasUtf16Bom(buffer)) return true;
  const sample = Math.min(buffer.length - (buffer.length % 2), 64);
  if (sample < 4) return false;
  let pairs = 0;
  let ascii = 0;
  for (let i = 0; i + 1 < sample; i += 2) {
    pairs += 1;
    const low = buffer[i] ?? 0;
    if (buffer[i + 1] === 0 && low >= 0x09) ascii += 1;
  }
  return pairs >= 2 && ascii / pairs >= 0.8;
}
