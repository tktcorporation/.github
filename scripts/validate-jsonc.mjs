import { readFileSync } from "node:fs";

const text = readFileSync(".ziku/ziku.jsonc", "utf8");

// JSONC → JSON 変換（Node.js ビルトインのみ使用）
// 文字列リテラル内の // や /* を誤除去しないよう状態管理する
let result = "";
let inString = false;
let i = 0;
while (i < text.length) {
  if (inString) {
    if (text[i] === "\\") {
      result += text[i] + text[i + 1];
      i += 2;
      continue;
    }
    if (text[i] === '"') {
      inString = false;
    }
    result += text[i];
    i++;
    continue;
  }
  // 文字列開始
  if (text[i] === '"') {
    inString = true;
    result += text[i];
    i++;
    continue;
  }
  // 行コメント
  if (text[i] === "/" && text[i + 1] === "/") {
    while (i < text.length && text[i] !== "\n") i++;
    continue;
  }
  // ブロックコメント
  if (text[i] === "/" && text[i + 1] === "*") {
    i += 2;
    while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
    i += 2;
    continue;
  }
  result += text[i];
  i++;
}

// trailing comma 除去
result = result.replace(/,\s*([\]}])/g, "$1");

JSON.parse(result);
console.log("ziku.jsonc is valid");
