export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: "plain" | "quoted" | "closed" = "plain";
  let line = 1;

  const finishField = () => {
    row.push(field);
    field = "";
    state = "plain";
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let index = input.startsWith("\uFEFF") ? 1 : 0; index < input.length; index++) {
    const character = input[index];
    if (state === "quoted") {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index++;
      } else if (character === '"') {
        state = "closed";
      } else {
        field += character;
        if (character === "\n" || (character === "\r" && input[index + 1] !== "\n")) line++;
      }
      continue;
    }

    if (character === ",") {
      finishField();
    } else if (character === "\r" || character === "\n") {
      finishRow();
      if (character === "\r" && input[index + 1] === "\n") index++;
      line++;
    } else if (character === '"' && state === "plain" && field === "") {
      state = "quoted";
    } else if (character === '"' || state === "closed") {
      throw new Error(`Invalid CSV quoting on line ${line}.`);
    } else {
      field += character;
    }
  }

  if (state === "quoted") throw new Error(`Unclosed CSV quote on line ${line}.`);
  if (row.length || field || state === "closed") finishRow();
  return rows;
}
